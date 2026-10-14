/**
 * Host service that runs `ctx.authorization` attempts for a UI: one attempt per
 * credential key, with notices and prompts buffered into a safe view the Remote
 * layer can stream.
 * @module @deepseek-ai/dsh-llm-oauth-bridge
 */

import { Context, Service } from '@deepseek-ai/cordis'
import {
  AuthorizationDeclinedError,
  type AuthorizationNotice,
  type AuthorizationPrompt,
} from '@deepseek-ai/dsh-authorization'
import { parseCredentialKey, type CredentialKey } from '@deepseek-ai/dsh-credentials'
import type { OAuthAttemptStatus, OAuthAttemptView, OAuthPromptView } from './types.ts'

export type {
  OAuthAttemptStatus, OAuthAttemptView, OAuthPromptOptionView, OAuthPromptView,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    oauthBridge: OAuthBridge
  }
}

interface PendingPrompt {
  readonly resolve: (value: string) => void
  readonly reject: (error: unknown) => void
}

interface Attempt {
  status: OAuthAttemptStatus
  authorizeUrl?: string
  message?: string
  error?: string
  code?: string
  prompt?: OAuthPromptView
  pendingPrompt?: PendingPrompt
  done?: Promise<void>
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Hold `start` until the attempt is no longer a blank in-flight idle.
 * @param attempt - the claimed attempt.
 * @param done - settlement promise; completing it always releases the wait.
 * @param subscribe - register a change listener; returns its disposer.
 */
function waitUntilVisible(
  attempt: Attempt,
  done: Promise<void>,
  subscribe: (listener: () => void) => () => void,
): Promise<void> {
  if (attempt.status !== 'idle') return Promise.resolve()
  return new Promise<void>((resolve) => {
    let finished = false
    const complete = (): void => {
      if (finished) return
      finished = true
      stop()
      resolve()
    }
    const stop = subscribe(() => {
      if (attempt.status !== 'idle') complete()
    })
    void done.finally(complete)
    if (attempt.status !== 'idle') complete()
  })
}

function promptView(prompt: AuthorizationPrompt): OAuthPromptView {
  if (prompt.kind === 'select') {
    return {
      kind: 'select',
      message: prompt.message,
      options: prompt.options.map(option => ({
        id: option.id,
        label: option.label,
        ...option.description === undefined ? {} : { description: option.description },
      })),
    }
  }
  return {
    kind: prompt.kind,
    message: prompt.message,
    ...prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder },
  }
}

/**
 * `ctx.oauthBridge`: UI-driven browser OAuth over `ctx.authorization`.
 */
export class OAuthBridge extends Service {
  static inject = ['authorization', 'credentials']

  private readonly attempts = new Map<CredentialKey, Attempt>()
  private readonly listeners = new Map<CredentialKey, Set<() => void>>()

  /** @param ctx - Host with authorization and credentials mounted. */
  constructor(ctx: Context) {
    super(ctx, 'oauthBridge')
    ctx.effect(() => {
      const stopRecords = ctx.on('credentials/record-updated', (key: CredentialKey) => { this.emit(key) })
      const stopSettled = ctx.on('authorization/settled', (key: CredentialKey) => { this.emit(key) })
      return () => {
        stopRecords()
        stopSettled()
        for (const key of this.attempts.keys()) ctx.authorization.cancel(key)
      }
    }, 'oauthBridge.watchers')
  }

  /**
   * Begin an authorization attempt for `key`. A second start while one is
   * running returns the current view instead of joining the in-flight flow.
   * A new start waits until the flow has prompted, published an authorize URL,
   * or settled. Notices without a URL leave status idle and do not complete it.
   * @param key - credential record address (`<scope>/<id>`).
   * @param method - flow method to run; omitted uses the flow's first method.
   * @returns snapshot after the attempt is visible to the UI, or has settled.
   */
  async start(key: string, method?: string): Promise<OAuthAttemptView> {
    const parsed = parseCredentialKey(key)
    const current = this.attempts.get(parsed)
    if (current?.done !== undefined || this.ctx.authorization.describe(parsed)?.inFlight === true) {
      return await this.snapshot(parsed)
    }
    const attempt: Attempt = { status: 'idle' }
    this.attempts.set(parsed, attempt)
    const done = this.ctx.authorization.begin({
      key: parsed,
      ...method === undefined ? {} : { method },
      interaction: {
        notify: (notice) => { this.acceptNotice(parsed, notice) },
        prompt: prompt => this.acceptPrompt(parsed, prompt),
      },
    }).then((outcome) => {
      this.settle(parsed, outcome.status === 'authorized' ? 'authorized' : 'cancelled')
    }).catch((error: unknown) => {
      this.settle(parsed, 'failed', messageOf(error))
    })
    attempt.done = done
    this.emit(parsed)
    await waitUntilVisible(attempt, done, listener => this.subscribe(parsed, listener))
    return await this.snapshot(parsed)
  }

  /**
   * Withdraw the attempt running for `key`, if any.
   * @param key - credential record address (`<scope>/<id>`).
   * @returns snapshot after cancellation is requested.
   */
  async cancel(key: string): Promise<OAuthAttemptView> {
    const parsed = parseCredentialKey(key)
    this.ctx.authorization.cancel(parsed)
    const attempt = this.attempts.get(parsed)
    if (attempt?.done !== undefined) await attempt.done
    return await this.snapshot(parsed)
  }

  /**
   * Forget the stored credential for `key` after withdrawing any running attempt.
   * @param key - credential record address (`<scope>/<id>`).
   * @returns snapshot after the record is removed.
   */
  async signOut(key: string): Promise<OAuthAttemptView> {
    const parsed = parseCredentialKey(key)
    this.ctx.authorization.cancel(parsed)
    const attempt = this.attempts.get(parsed)
    if (attempt?.done !== undefined) await attempt.done
    await this.ctx.credentials.deleteRecord(parsed)
    this.attempts.delete(parsed)
    this.emit(parsed)
    return await this.snapshot(parsed)
  }

  /**
   * Read the safe projection for `key`.
   * @param key - credential record address (`<scope>/<id>`).
   * @returns current attempt and credential presence.
   */
  async getState(key: string): Promise<OAuthAttemptView> {
    return await this.snapshot(parseCredentialKey(key))
  }

  /**
   * Stream the safe projection for `key`.
   * @param key - credential record address (`<scope>/<id>`).
   * @param signal - stream lifetime.
   * @returns initial snapshot and subsequent changes.
   */
  async *watch(key: string, signal: AbortSignal): AsyncIterable<OAuthAttemptView> {
    const parsed = parseCredentialKey(key)
    yield await this.snapshot(parsed)
    if (signal.aborted) return
    const queue: OAuthAttemptView[] = []
    let wake: (() => void) | undefined
    const stop = this.subscribe(parsed, () => {
      void this.snapshot(parsed).then((view) => {
        queue.push(view)
        wake?.()
      })
    })
    const abort = (): void => { wake?.() }
    signal.addEventListener('abort', abort, { once: true })
    try {
      while (!signal.aborted) {
        const next = queue.shift()
        if (next !== undefined) {
          yield next
          continue
        }
        await new Promise<void>((resolve) => { wake = resolve })
        wake = undefined
      }
    } finally {
      stop()
      signal.removeEventListener('abort', abort)
    }
  }

  /**
   * Answer the pending prompt for `key`.
   * @param key - credential record address (`<scope>/<id>`).
   * @param value - typed text or chosen option id.
   * @returns snapshot after the prompt is handed to the flow.
   */
  async answerPrompt(key: string, value: string): Promise<OAuthAttemptView> {
    const parsed = parseCredentialKey(key)
    const pending = this.attempts.get(parsed)?.pendingPrompt
    if (pending === undefined) {
      throw new Error(`no authorization prompt is waiting for "${key}"`)
    }
    pending.resolve(value)
    return await this.snapshot(parsed)
  }

  /**
   * Decline the pending prompt for `key`.
   * @param key - credential record address (`<scope>/<id>`).
   * @returns snapshot after the decline is handed to the flow.
   */
  async declinePrompt(key: string): Promise<OAuthAttemptView> {
    const parsed = parseCredentialKey(key)
    const pending = this.attempts.get(parsed)?.pendingPrompt
    if (pending === undefined) {
      throw new Error(`no authorization prompt is waiting for "${key}"`)
    }
    pending.reject(new AuthorizationDeclinedError())
    return await this.snapshot(parsed)
  }

  private requireAttempt(key: CredentialKey): Attempt {
    const attempt = this.attempts.get(key)
    if (attempt === undefined) {
      /* v8 ignore next -- start inserts the attempt before interaction callbacks. */
      throw new Error(`no authorization attempt for "${key}"`)
    }
    return attempt
  }

  /** Buffer one flow notice into the attempt view. */
  private acceptNotice(key: CredentialKey, notice: AuthorizationNotice): void {
    const attempt = this.requireAttempt(key)
    attempt.message = notice.message
    if (notice.url !== undefined) {
      attempt.authorizeUrl = notice.url
      attempt.status = 'waiting-browser'
    }
    if (notice.code !== undefined) attempt.code = notice.code
    this.emit(key)
  }

  /** Hold one flow prompt until the UI answers or declines it. */
  private acceptPrompt(key: CredentialKey, prompt: AuthorizationPrompt): Promise<string> {
    const attempt = this.requireAttempt(key)
    attempt.status = 'prompting'
    attempt.message = prompt.message
    attempt.prompt = promptView(prompt)
    const pending = Promise.withResolvers<string>()
    attempt.pendingPrompt = { resolve: pending.resolve, reject: pending.reject }
    this.emit(key)
    const withdrawn = prompt.signal
    const onWithdraw = (): void => {
      pending.reject(new Error('the authorization prompt was withdrawn'))
    }
    withdrawn?.addEventListener('abort', onWithdraw, { once: true })
    return pending.promise.finally(() => {
      withdrawn?.removeEventListener('abort', onWithdraw)
      delete attempt.pendingPrompt
      delete attempt.prompt
      if (attempt.status === 'prompting') {
        attempt.status = attempt.authorizeUrl === undefined ? 'idle' : 'waiting-browser'
      }
      this.emit(key)
    })
  }

  /** Apply a terminal outcome and release the in-flight handle. */
  private settle(key: CredentialKey, status: 'authorized' | 'cancelled' | 'failed', error?: string): void {
    const attempt = this.requireAttempt(key)
    const pending = attempt.pendingPrompt
    attempt.status = status
    delete attempt.done
    delete attempt.pendingPrompt
    delete attempt.prompt
    delete attempt.authorizeUrl
    pending?.reject(new AuthorizationDeclinedError())
    if (error === undefined) delete attempt.error
    else attempt.error = error
    this.attempts.set(key, attempt)
    this.emit(key)
  }

  /** Read credential presence and the buffered attempt into one view. */
  private async snapshot(key: CredentialKey): Promise<OAuthAttemptView> {
    const attempt = this.attempts.get(key)
    const record = await this.ctx.credentials.describeRecord(key)
    const inFlight = attempt?.done !== undefined || this.ctx.authorization.describe(key)?.inFlight === true
    return {
      status: attempt?.status ?? 'idle',
      ...attempt?.authorizeUrl === undefined ? {} : { authorizeUrl: attempt.authorizeUrl },
      ...attempt?.message === undefined ? {} : { message: attempt.message },
      ...attempt?.error === undefined ? {} : { error: attempt.error },
      ...attempt?.code === undefined ? {} : { code: attempt.code },
      ...attempt?.prompt === undefined ? {} : { prompt: attempt.prompt },
      inFlight,
      credentialConfigured: record.configured,
    }
  }

  private subscribe(key: CredentialKey, listener: () => void): () => void {
    const set = this.listeners.get(key) ?? new Set<() => void>()
    set.add(listener)
    this.listeners.set(key, set)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.listeners.delete(key)
    }
  }

  private emit(key: CredentialKey): void {
    const set = this.listeners.get(key)
    if (set === undefined) return
    for (const listener of set) listener()
  }
}

export default OAuthBridge
