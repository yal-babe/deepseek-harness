/**
 * Studio Pet Host module: folds live Session events into one pet snapshot and
 * serves it on the Typert Remote namespace `pet`. The module never answers
 * approvals itself; Clients answer the existing `approval/request` waterfall
 * (see the package README).
 */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { PET_COMPLETION_QUIET_MS, PetReducer } from './reducer.ts'
import type { PetSessionMeta } from './reducer.ts'
import { loadPetDevPacks } from './dev-packs.ts'
import { builtinAssets, PET_MEDIA_PATH } from './builtin-assets.ts'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { PetPackState, PetSettingsView, PetSnapshot } from './types.ts'
// Type-only: the `settings` service (`settings.update`) and the Loader's `loader/volatile-update` event.
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'

export type * from './types.ts'
export { PetReducer, PET_COMPLETION_QUIET_MS, PET_STATE_PRIORITY, classifyTool, isRestrictedInPet } from './reducer.ts'
export type { PetReducerOptions, PetSessionMeta, PetSnapshotInputs } from './reducer.ts'

/**
 * Resolved options of the Studio Pet Host module. `Volatile` fields are the
 * shared pet settings: the Settings page and `pet.setVisible()` write them
 * through the `settings` service into the profile patch, and the module reads
 * them live without remounting.
 */
export interface Config {
  /** "Show desktop pet"; hiding never stops the Host module. */
  visible: Volatile<boolean>
  /** Whether tools listed in `restrictedTools` must be approved in the main window. Off by default: the pet may approve every tool. */
  restrictTools: Volatile<boolean>
  /** Tool names routed to the main window while `restrictTools` is on. */
  restrictedTools: Volatile<string[]>
  /** System notification for a new approval request. */
  notifyWaiting: Volatile<boolean>
  /** System notification when a turn finishes. */
  notifySuccess: Volatile<boolean>
  /** System notification when a turn fails. */
  notifyError: Volatile<boolean>
  /** Track subagent Sessions as their own entries. */
  includeSubagents: boolean
  /** Milliseconds a completed turn shows `SUCCESS` before reading as `IDLE`. */
  successHoldMs: number
  /** Milliseconds a failed turn shows `ERROR` before reading as `IDLE`. */
  errorHoldMs: number
  /** Maximum Session entries per snapshot. */
  maxSessions: number
  /** Minimum milliseconds between two `watch()` frames. */
  snapshotDebounceMs: number
  /** Whether a `WAITING` Session takes focus from a pinned Session. */
  waitingPreempts: boolean
  /** Hold a successful result (and its notification) while subagent descendants still work. */
  holdCompletionsWhileBusy: boolean
  /** Milliseconds descendants must stay quiet before a held result settles. */
  completionQuietMs: number
}

/** Validated at plugin load. */
export const Config = Schema.object({
  visible: Schema.boolean().default(true).volatile(),
  restrictTools: Schema.boolean().default(false).volatile(),
  restrictedTools: Schema.array(Schema.string().min(1)).default([]).volatile(),
  notifyWaiting: Schema.boolean().default(true).volatile(),
  notifySuccess: Schema.boolean().default(true).volatile(),
  notifyError: Schema.boolean().default(true).volatile(),
  includeSubagents: Schema.boolean().default(false),
  successHoldMs: Schema.number().min(0).max(600000).step(1).default(8000),
  errorHoldMs: Schema.number().min(0).max(3600000).step(1).default(60000),
  maxSessions: Schema.number().min(1).max(256).step(1).default(32),
  snapshotDebounceMs: Schema.number().min(0).max(5000).step(1).default(100),
  waitingPreempts: Schema.boolean().default(true),
  holdCompletionsWhileBusy: Schema.boolean().default(true),
  completionQuietMs: Schema.number().min(0).max(60000).step(1).default(PET_COMPLETION_QUIET_MS),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    pet: PetService
  }
}

function metaOf(session: Session): PetSessionMeta {
  const subagent = session.header.origin === 'subagent' || (session.header.delegationDepth ?? 0) > 0
  // Forks also record `parentSession`; only a subagent child counts as working for its parent.
  const parent = subagent ? session.header.parentSession : undefined
  return {
    sessionId: session.id,
    ...(session.header.cwd === undefined ? {} : { cwd: session.header.cwd }),
    subagent,
    ...(parent === undefined ? {} : { parentSessionId: parent }),
  }
}

/** Host owner of the pet snapshot; Remote namespace and Cordis key `pet`. */
export class PetService extends TypertRemoteService {
  static Config = Config
  private readonly reducer: PetReducer
  private readonly listeners = new Set<() => void>()
  private readonly debounceMs: number
  private readonly entryId: string | undefined
  private packState: Promise<PetPackState> | undefined
  private builtin: PetPackState | undefined
  private builtinReady: Promise<void> | undefined
  /** Visibility set through `setVisible()` in a composition without Settings or a profile entry. */
  private visibleOverride: boolean | undefined
  private pinned: SessionId | undefined
  private revision = 0
  private expiryTimer: ReturnType<typeof setTimeout> | undefined
  private closed = false

  /**
   * @param ctx - Host root Context; listeners receive events from every Session.
   * @param config - options resolved by the Loader against {@link Config}.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'pet')
    this.reducer = new PetReducer({
      includeSubagents: config.includeSubagents,
      successHoldMs: config.successHoldMs,
      errorHoldMs: config.errorHoldMs,
      maxSessions: config.maxSessions,
      waitingPreempts: config.waitingPreempts,
      holdCompletions: config.holdCompletionsWhileBusy,
      completionQuietMs: config.completionQuietMs,
    })
    ctx.inject(['webServer'], (scope) => {
      scope.effect(() => {
        let live = true
        let remove: (() => void) | undefined
        this.builtinReady = builtinAssets().then((assets) => {
          if (!live) return
          remove = scope.webServer.register({ kind: 'prefix', path: PET_MEDIA_PATH, handler: assets.handler })
          this.builtin = assets.pack
        }).catch((error) => { scope.logger.warn('pet: built-in media unavailable: %s', error) })
        return () => { live = false; remove?.(); this.builtin = undefined }
      }, 'pet: built-in media route')
    })
    this.debounceMs = config.snapshotDebounceMs
    this.entryId = ctx.fiber.entry?.options.id
    ctx.on('loader/volatile-update', () => {
      this.visibleOverride = undefined
      this.changed()
    })
    ctx.on('session/event', (session: Session, event: SessionEvent) => {
      // A fold failure must not reach the Session append path; the pet degrades alone.
      try {
        if (this.reducer.apply(metaOf(session), event)) this.changed()
      } catch (error) {
        ctx.logger.warn('pet: dropped Session event %s: %s', event.type, error)
      }
    })
    ctx.on('session/disposed', (session: Session) => {
      if (this.pinned === session.id) this.pinned = undefined
      if (this.reducer.remove(session.id, Date.now())) this.changed()
    })
    ctx.effect(() => () => {
      this.closed = true
      if (this.expiryTimer !== undefined) clearTimeout(this.expiryTimer)
      this.changed()
    }, 'pet: close watchers')
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
  }

  private armExpiry(now: number): void {
    if (this.expiryTimer !== undefined) clearTimeout(this.expiryTimer)
    this.expiryTimer = undefined
    const expiry = this.reducer.nextExpiry(now)
    if (expiry === undefined || this.closed) return
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = undefined
      this.changed()
    }, expiry - now)
  }

  /**
   * Read the current snapshot once.
   * @returns the complete pet state at call time.
   */
  @Remote
  getSnapshot(): PetSnapshot {
    const now = Date.now()
    this.revision += 1
    this.armExpiry(now)
    return this.reducer.snapshot(now, {
      revision: this.revision,
      visible: this.visibleOverride ?? this.config.visible.get(),
      pinnedSessionId: this.pinned,
      settings: this.settings(),
    })
  }

  private settings(): PetSettingsView {
    return {
      restrictTools: this.config.restrictTools.get(),
      restrictedTools: this.config.restrictedTools.get(),
      notify: { waiting: this.config.notifyWaiting.get(), success: this.config.notifySuccess.get(), error: this.config.notifyError.get() },
    }
  }

  /**
   * Observe the pet state. Changes inside one debounce window share one frame.
   * @param signal - subscriber lifetime.
   * @returns complete snapshots, starting with the current state.
   */
  @Remote({ mode: 'stream' })
  async *watch(signal: AbortSignal): AsyncIterable<PetSnapshot> {
    let dirty = true
    let wake: (() => void) | undefined
    const changed = (): void => {
      dirty = true
      wake?.()
    }
    this.listeners.add(changed)
    signal.addEventListener('abort', changed, { once: true })
    try {
      while (!this.closed && !signal.aborted) {
        if (dirty) {
          dirty = false
          yield this.getSnapshot()
          if (this.debounceMs > 0) await new Promise<void>((resolve) => { setTimeout(resolve, this.debounceMs) })
          continue
        }
        await new Promise<void>((resolve) => { wake = resolve })
        wake = undefined
      }
    } finally {
      this.listeners.delete(changed)
      signal.removeEventListener('abort', changed)
    }
  }

  /**
   * Show or hide the pet on every surface. Hiding keeps event folding and this stream running.
   * The value is written to the `visible` field of this module's profile entry through the
   * `settings` service, so it survives Host restarts; the next frame follows the Loader's
   * `loader/volatile-update`. Without Settings or a profile entry the value lasts for this
   * Host lifetime only.
   * @param visible - new "show desktop pet" value.
   * @returns completion after the write is accepted.
   * @throws RemoteError `gateway/bad-request` for a non-boolean; the Settings refusal when the write is rejected.
   */
  @Remote
  async setVisible(visible: boolean): Promise<void> {
    if (typeof visible !== 'boolean') throw new RemoteError('gateway/bad-request', 'visible must be a boolean', {})
    if ((this.visibleOverride ?? this.config.visible.get()) === visible) return
    const settings = this.ctx.get('settings')
    if (settings === undefined || this.entryId === undefined) {
      this.visibleOverride = visible
      this.changed()
      return
    }
    await settings.update(this.entryId, { visible })
  }

  /**
   * Pin the Session the bubble follows, or return to automatic focus.
   * @param sessionId - tracked Session to follow, or `null` for automatic focus.
   */
  @Remote
  pin(sessionId: SessionId | null): void {
    if (sessionId !== null && !this.reducer.has(sessionId)) {
      throw new RemoteError('pet/session-not-tracked', 'The pet does not track this Session', { sessionId })
    }
    const next = sessionId ?? undefined
    if (this.pinned === next) return
    this.pinned = next
    this.changed()
  }

  /**
   * Mark the last result of one Session as seen, ending its `SUCCESS` or `ERROR` hold.
   * @param sessionId - Session whose result the user viewed.
   */
  @Remote
  acknowledge(sessionId: SessionId): void {
    if (this.reducer.acknowledge(sessionId)) this.changed()
  }

  /**
   * Character pack and optional built-in media. A valid development pack takes precedence;
   * otherwise the built-in media is offered when the webServer route is ready. Without
   * webServer the Client keeps its embedded fallback. Development directories are read once.
   * @returns the offered pack, if any, and the skipped candidates with their reasons.
   */
  @Remote
  async pack(): Promise<PetPackState> {
    this.packState ??= loadPetDevPacks(process.env)
    const offered = await this.packState
    if (offered.pack !== null) return offered
    await this.builtinReady
    return this.builtin === undefined ? offered : { ...this.builtin, problems: offered.problems }
  }
}

export default PetService
