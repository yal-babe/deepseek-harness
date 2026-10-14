/** Authenticated Remote operations for UI-driven browser OAuth. */
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm-oauth-bridge'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { OAuthAttemptView } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    oauthController: OAuthController
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function rejected(key: string, error: unknown): RemoteError {
  if (error instanceof RemoteError) return error
  return new RemoteError('oauth/rejected', messageOf(error), { key }, { cause: error })
}

/** OAuth commands and reconnect-safe state stream, keyed by credential record. */
export class OAuthController extends TypertRemoteService {
  static inject = ['oauthBridge']
  /** @param ctx - Host with the OAuth bridge mounted. */
  constructor(ctx: Context) { super(ctx, 'oauthController', { namespace: 'oauth' }) }
  /**
   * Read the safe OAuth projection for one credential.
   * @param key - credential record address (`<scope>/<id>`).
   * @returns current attempt and credential presence.
   */
  @Remote
  async getState(key: string): Promise<OAuthAttemptView> {
    try {
      return await this.ctx.oauthBridge.getState(key)
    } catch (error: unknown) {
      throw rejected(key, error)
    }
  }
  /**
   * Begin browser sign-in for one credential.
   * @param key - credential record address (`<scope>/<id>`).
   * @param method - flow method to run; omitted uses the flow's first method.
   * @returns snapshot after the attempt is claimed.
   */
  @Remote
  async start(key: string, method?: string): Promise<OAuthAttemptView> {
    try {
      return await this.ctx.oauthBridge.start(key, method)
    } catch (error: unknown) {
      throw rejected(key, error)
    }
  }
  /**
   * Withdraw the attempt running for one credential.
   * @param key - credential record address (`<scope>/<id>`).
   * @returns snapshot after cancellation is requested.
   */
  @Remote
  async cancel(key: string): Promise<OAuthAttemptView> {
    try {
      return await this.ctx.oauthBridge.cancel(key)
    } catch (error: unknown) {
      throw rejected(key, error)
    }
  }
  /**
   * Remove the local credential record after withdrawing any running attempt.
   * @param key - credential record address (`<scope>/<id>`).
   * @returns snapshot after the record is removed.
   */
  @Remote
  async signOut(key: string): Promise<OAuthAttemptView> {
    try {
      return await this.ctx.oauthBridge.signOut(key)
    } catch (error: unknown) {
      throw rejected(key, error)
    }
  }
  /**
   * Answer the pending prompt for one credential.
   * @param key - credential record address (`<scope>/<id>`).
   * @param value - typed text or chosen option id.
   * @returns snapshot after the prompt is handed to the flow.
   */
  @Remote
  async answerPrompt(key: string, value: string): Promise<OAuthAttemptView> {
    try {
      return await this.ctx.oauthBridge.answerPrompt(key, value)
    } catch (error: unknown) {
      throw rejected(key, error)
    }
  }
  /**
   * Decline the pending prompt for one credential.
   * @param key - credential record address (`<scope>/<id>`).
   * @returns snapshot after the decline is handed to the flow.
   */
  @Remote
  async declinePrompt(key: string): Promise<OAuthAttemptView> {
    try {
      return await this.ctx.oauthBridge.declinePrompt(key)
    } catch (error: unknown) {
      throw rejected(key, error)
    }
  }
  /**
   * Stream the safe OAuth projection for one credential.
   * @param key - credential record address (`<scope>/<id>`).
   * @param signal - stream lifetime.
   * @returns initial snapshot and subsequent changes.
   */
  @Remote({ mode: 'stream' })
  async *watch(key: string, signal: AbortSignal): AsyncIterable<OAuthAttemptView> {
    try {
      yield* this.ctx.oauthBridge.watch(key, signal)
    } catch (error: unknown) {
      throw rejected(key, error)
    }
  }
}
export default OAuthController
