/**
 * Studio Pet Host module: folds live Session events into one pet snapshot and
 * serves it on the Typert Remote namespace `pet`. The module never answers
 * approvals itself; Clients answer the existing `approval/request` waterfall
 * (see the package README).
 */
import { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { PetReducer } from './reducer.ts'
import type { PetSessionMeta } from './reducer.ts'
import type { PetSnapshot } from './types.ts'

export type * from './types.ts'
export { PetReducer, PET_STATE_PRIORITY, classifyTool } from './reducer.ts'
export type { PetReducerOptions, PetSessionMeta, PetSnapshotInputs } from './reducer.ts'

/** Deployment options of the Studio Pet Host module. */
export interface Config {
  /** Initial "show desktop pet" value; hiding never stops the Host module. */
  visible?: boolean
  /** Track subagent Sessions as their own entries. */
  includeSubagents?: boolean
  /** Milliseconds a completed turn shows `SUCCESS` before reading as `IDLE`. */
  successHoldMs?: number
  /** Milliseconds a failed turn shows `ERROR` before reading as `IDLE`. */
  errorHoldMs?: number
  /** Maximum Session entries per snapshot. */
  maxSessions?: number
  /** Minimum milliseconds between two `watch()` frames. */
  snapshotDebounceMs?: number
  /** Whether a `WAITING` Session takes focus from a pinned Session. */
  waitingPreempts?: boolean
}

/** Validated at plugin load. */
export const Config = Schema.object({
  visible: Schema.boolean().default(true),
  includeSubagents: Schema.boolean().default(false),
  successHoldMs: Schema.number().min(0).max(600000).step(1).default(8000),
  errorHoldMs: Schema.number().min(0).max(3600000).step(1).default(60000),
  maxSessions: Schema.number().min(1).max(256).step(1).default(32),
  snapshotDebounceMs: Schema.number().min(0).max(5000).step(1).default(100),
  waitingPreempts: Schema.boolean().default(true),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    pet: PetService
  }
}

function metaOf(session: Session): PetSessionMeta {
  return {
    sessionId: session.id,
    ...(session.header.cwd === undefined ? {} : { cwd: session.header.cwd }),
    subagent: session.header.origin === 'subagent' || (session.header.delegationDepth ?? 0) > 0,
  }
}

/** Host owner of the pet snapshot; Remote namespace and Cordis key `pet`. */
export class PetService extends TypertRemoteService {
  static Config = Config
  private readonly reducer: PetReducer
  private readonly listeners = new Set<() => void>()
  private readonly debounceMs: number
  private visible: boolean
  private pinned: SessionId | undefined
  private revision = 0
  private expiryTimer: ReturnType<typeof setTimeout> | undefined
  private closed = false

  /**
   * @param ctx - Host root Context; listeners receive events from every Session.
   * @param config - validated deployment options.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'pet')
    const resolved = Config(config)
    this.reducer = new PetReducer({
      includeSubagents: resolved.includeSubagents,
      successHoldMs: resolved.successHoldMs,
      errorHoldMs: resolved.errorHoldMs,
      maxSessions: resolved.maxSessions,
      waitingPreempts: resolved.waitingPreempts,
    })
    this.debounceMs = resolved.snapshotDebounceMs
    this.visible = resolved.visible
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
      if (this.reducer.remove(session.id)) this.changed()
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
    return this.reducer.snapshot(now, { revision: this.revision, visible: this.visible, pinnedSessionId: this.pinned })
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
   * @param visible - new "show desktop pet" value.
   */
  @Remote
  setVisible(visible: boolean): void {
    if (typeof visible !== 'boolean') throw new RemoteError('gateway/bad-request', 'visible must be a boolean', {})
    if (this.visible === visible) return
    this.visible = visible
    this.changed()
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
}

export default PetService
