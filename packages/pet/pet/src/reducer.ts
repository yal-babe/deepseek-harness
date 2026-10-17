/**
 * Pure fold from durable Session events to the Studio Pet snapshot. The fold
 * owns no timers and reads no clock: callers pass event times and the
 * snapshot time, so replaying the same events yields the same snapshot.
 */

import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { JobId } from '@deepseek-ai/dsh-jobs/brand'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-tool-todo/types'
import type {} from '@deepseek-ai/dsh-user-approval/types'
import type {} from '@deepseek-ai/dsh-session-title'
import type {
  PetAgentState,
  PetApprovalRequestId,
  PetJobView,
  PetPendingApproval,
  PetProgress,
  PetSessionView,
  PetSnapshot,
  PetWorkActivity,
} from './types.ts'

/** Session facts the fold reads besides the event itself. */
export interface PetSessionMeta {
  /** Session identity. */
  readonly sessionId: SessionId
  /** Absolute working directory from the Session header. */
  readonly cwd?: string
  /** Whether the Session header marks a subagent child. */
  readonly subagent: boolean
}

/** Resolved fold options; the Host plugin derives them from its validated `Config`. */
export interface PetReducerOptions {
  /** Track subagent Sessions as their own entries. Pending approvals are tracked regardless. */
  readonly includeSubagents: boolean
  /** Milliseconds a `SUCCESS` result stays the Session state before it reads as `IDLE`. */
  readonly successHoldMs: number
  /** Milliseconds an `ERROR` result stays the Session state before it reads as `IDLE`. */
  readonly errorHoldMs: number
  /** Maximum Session entries published in one snapshot. */
  readonly maxSessions: number
  /** Whether a `WAITING` Session takes focus away from a pinned Session. */
  readonly waitingPreempts: boolean
}

/** Host-owned values the snapshot carries besides folded events. */
export interface PetSnapshotInputs {
  /** Frame counter assigned by the caller. */
  readonly revision: number
  /** "Show desktop pet" setting. */
  readonly visible: boolean
  /** Pinned Session, when one is set. */
  readonly pinnedSessionId: SessionId | undefined
}

type TurnState = 'IDLE' | 'THINKING' | 'WORKING' | 'SUCCESS' | 'ERROR'

interface SessionRecord {
  readonly sessionId: SessionId
  cwd: string | undefined
  subagent: boolean
  title: string | undefined
  turnActive: boolean
  state: TurnState
  readonly openTools: Map<ToolCallId, string>
  progress: PetProgress | undefined
  unseenResult: boolean
  settledAt: number
  updatedAt: number
}

/** Display priority of aggregated states; higher wins the character. */
export const PET_STATE_PRIORITY: Readonly<Record<PetAgentState, number>> = {
  WAITING: 60,
  ERROR: 50,
  SUCCESS: 40,
  WORKING: 30,
  THINKING: 20,
  IDLE: 0,
  DISCONNECTED: -1,
}

/**
 * Classify a tool name into the working animation it selects. Matching uses
 * name tokens, so `code_review` does not read as a search.
 * @param name - tool name recorded by `tool/call`.
 * @returns the working activity for that tool.
 */
export function classifyTool(name: string): PetWorkActivity {
  const tokens = new Set(name.toLowerCase().split(/[^a-z0-9]+/u).filter(token => token.length > 0))
  const has = (...candidates: string[]): boolean => candidates.some(candidate => tokens.has(candidate))
  if (has('test', 'tests', 'check', 'lint', 'build', 'verify', 'typecheck')) return 'test'
  if (has('bash', 'shell', 'pwsh', 'powershell', 'exec', 'command', 'terminal', 'run')) return 'command'
  if (has('write', 'edit', 'patch', 'replace', 'create', 'move', 'delete', 'rename', 'apply')) return 'edit'
  if (has('search', 'grep', 'glob', 'find', 'read', 'fetch', 'web', 'open', 'list', 'ls')) return 'search'
  return 'tool'
}

function progressOf(todos: readonly { readonly status: string }[]): PetProgress | undefined {
  if (todos.length === 0) return undefined
  const completed = todos.filter(todo => todo.status === 'completed').length
  const current = todos.findIndex(todo => todo.status === 'in_progress')
  return current < 0 ? { completed, total: todos.length } : { completed, total: todos.length, current: current + 1 }
}

function projectOf(cwd: string | undefined): string | undefined {
  if (cwd === undefined) return undefined
  return cwd.split(/[\\/]/u).filter(part => part.length > 0).at(-1)
}

/** Incremental Studio Pet state over all live Sessions. */
export class PetReducer {
  private readonly records = new Map<SessionId, SessionRecord>()
  private readonly approvals = new Map<PetApprovalRequestId, PetPendingApproval>()
  private readonly jobs = new Map<JobId, PetJobView>()

  /** @param options - resolved fold options. */
  constructor(private readonly options: PetReducerOptions) {}

  /**
   * Fold one committed Session event.
   * @param meta - header facts of the Session that appended the event.
   * @param event - the appended event, exactly as recorded.
   * @returns whether the published snapshot can differ after this event.
   */
  apply(meta: PetSessionMeta, event: SessionEvent): boolean {
    switch (event.type) {
      case 'approval/asked':
        this.approvals.set(event.data.id, {
          id: event.data.id,
          sessionId: meta.sessionId,
          toolName: event.data.toolName,
          ...(event.data.callId === undefined ? {} : { callId: event.data.callId }),
          ...(event.data.reason === undefined ? {} : { reason: event.data.reason }),
          askedAt: event.time,
        })
        this.touch(meta, event.time)
        return true
      case 'approval/decided':
        this.touch(meta, event.time)
        return this.approvals.delete(event.data.id)
      case 'job/registered':
        this.jobs.set(event.data.jobId, {
          jobId: event.data.jobId,
          owner: event.data.owner,
          label: event.data.label,
          kind: event.data.kind,
          startedAt: event.data.startedAt,
        })
        return true
      case 'job/settled':
        return this.jobs.delete(event.data.jobId)
      default:
        return this.applyTurnEvent(meta, event)
    }
  }

  /**
   * Forget a Session that left the store, including its pending approvals and jobs.
   * @param sessionId - disposed Session.
   * @returns whether anything was removed.
   */
  remove(sessionId: SessionId): boolean {
    let changed = this.records.delete(sessionId)
    for (const [id, approval] of this.approvals) {
      if (approval.sessionId !== sessionId) continue
      this.approvals.delete(id)
      changed = true
    }
    for (const [id, job] of this.jobs) {
      if (job.owner !== sessionId) continue
      this.jobs.delete(id)
      changed = true
    }
    return changed
  }

  /**
   * Clear the unseen-result marker of one Session and end its result hold.
   * @param sessionId - Session the user acknowledged.
   * @returns whether the Session had an unseen result.
   */
  acknowledge(sessionId: SessionId): boolean {
    const record = this.records.get(sessionId)
    if (record?.unseenResult !== true) return false
    // Only a settled turn sets the marker, so the record still holds its SUCCESS or ERROR result.
    record.unseenResult = false
    record.state = 'IDLE'
    return true
  }

  /**
   * Whether a Session is currently tracked.
   * @param sessionId - Session to look up.
   * @returns true when the fold holds an entry for it.
   */
  has(sessionId: SessionId): boolean {
    return this.records.has(sessionId)
  }

  /**
   * Earliest time after `now` at which a hold window ends and the snapshot changes without an event.
   * @param now - Unix epoch milliseconds.
   * @returns the expiry time, or `undefined` when no hold is running.
   */
  nextExpiry(now: number): number | undefined {
    let earliest: number | undefined
    for (const record of this.records.values()) {
      const hold = this.holdOf(record.state)
      if (hold === undefined) continue
      const end = record.settledAt + hold
      if (end > now && (earliest === undefined || end < earliest)) earliest = end
    }
    return earliest
  }

  /**
   * Build the complete snapshot at `now`.
   * @param now - Unix epoch milliseconds used for hold windows.
   * @param inputs - Host-owned values carried by the frame.
   * @returns a frame that replaces any earlier one.
   */
  snapshot(now: number, inputs: PetSnapshotInputs): PetSnapshot {
    const waiting = new Set([...this.approvals.values()].map(approval => approval.sessionId))
    const views = [...this.records.values()].map(record => this.view(record, now, waiting.has(record.sessionId)))
    views.sort((left, right) =>
      PET_STATE_PRIORITY[right.state] - PET_STATE_PRIORITY[left.state]
      || right.updatedAt - left.updatedAt
      || left.sessionId.localeCompare(right.sessionId))
    const pending = [...this.approvals.values()].sort((left, right) => left.askedAt - right.askedAt)
    const pinned = inputs.pinnedSessionId === undefined
      ? undefined
      : views.find(view => view.sessionId === inputs.pinnedSessionId)
    const preempting = this.options.waitingPreempts ? views.find(view => view.state === 'WAITING') : undefined
    const focus = pinned === undefined ? views[0] : preempting ?? pinned
    // Approvals of untracked subagent Sessions have no view, yet still need a human.
    const primary: PetAgentState = pending.length > 0 && (pinned === undefined || this.options.waitingPreempts)
      ? 'WAITING'
      : focus?.state ?? 'IDLE'
    return {
      revision: inputs.revision,
      primary,
      ...(focus === undefined ? {} : { focusSessionId: focus.sessionId }),
      ...(inputs.pinnedSessionId === undefined ? {} : { pinnedSessionId: inputs.pinnedSessionId }),
      sessions: views.slice(0, this.options.maxSessions),
      pending,
      jobs: [...this.jobs.values()].sort((left, right) => left.startedAt - right.startedAt),
      visible: inputs.visible,
    }
  }

  private applyTurnEvent(meta: PetSessionMeta, event: SessionEvent): boolean {
    if (meta.subagent && !this.options.includeSubagents) return false
    switch (event.type) {
      case 'turn/start': {
        const record = this.touch(meta, event.time)
        record.turnActive = true
        record.openTools.clear()
        record.progress = undefined
        record.unseenResult = false
        record.state = 'THINKING'
        return true
      }
      case 'tool/call': {
        const record = this.touch(meta, event.time)
        record.openTools.set(event.data.callId, event.data.name)
        record.state = 'WORKING'
        return true
      }
      case 'tool/result': {
        const record = this.touch(meta, event.time)
        record.openTools.delete(event.data.message.toolCallId)
        record.state = record.openTools.size > 0 ? 'WORKING' : record.turnActive ? 'THINKING' : record.state
        return true
      }
      case 'todo/write': {
        const record = this.touch(meta, event.time)
        record.progress = progressOf(event.data.todos)
        return true
      }
      case 'session/title': {
        const record = this.touch(meta, event.time)
        record.title = event.data.title
        return true
      }
      case 'turn/end': {
        const record = this.touch(meta, event.time)
        record.turnActive = false
        record.openTools.clear()
        record.settledAt = event.time
        record.state = this.turnOutcome(event.data.reason.kind)
        record.unseenResult = record.state === 'SUCCESS' || record.state === 'ERROR'
        return true
      }
      default:
        return false
    }
  }

  private turnOutcome(kind: string): TurnState {
    switch (kind) {
      case 'completed':
      case 'max-tokens':
        return 'SUCCESS'
      case 'error':
        return 'ERROR'
      // `TurnEndReasonMap` is merge-extensible: aborted, blocked, interrupted,
      // forked, and plugin-added reasons carry no result to announce.
      default:
        return 'IDLE'
    }
  }

  private touch(meta: PetSessionMeta, time: number): SessionRecord {
    let record = this.records.get(meta.sessionId)
    if (record === undefined) {
      if (meta.subagent && !this.options.includeSubagents) {
        return this.detachedRecord(meta, time)
      }
      record = {
        sessionId: meta.sessionId,
        cwd: meta.cwd,
        subagent: meta.subagent,
        title: undefined,
        turnActive: false,
        state: 'IDLE',
        openTools: new Map(),
        progress: undefined,
        unseenResult: false,
        settledAt: 0,
        updatedAt: time,
      }
      this.records.set(meta.sessionId, record)
    }
    record.cwd = meta.cwd ?? record.cwd
    record.updatedAt = Math.max(record.updatedAt, time)
    return record
  }

  /** Untracked subagent Sessions still record approvals; their turn facts stay out of the snapshot. */
  private detachedRecord(meta: PetSessionMeta, time: number): SessionRecord {
    return {
      sessionId: meta.sessionId,
      cwd: meta.cwd,
      subagent: true,
      title: undefined,
      turnActive: false,
      state: 'IDLE',
      openTools: new Map(),
      progress: undefined,
      unseenResult: false,
      settledAt: 0,
      updatedAt: time,
    }
  }

  private holdOf(state: TurnState): number | undefined {
    if (state === 'SUCCESS') return this.options.successHoldMs
    if (state === 'ERROR') return this.options.errorHoldMs
    return undefined
  }

  private view(record: SessionRecord, now: number, waiting: boolean): PetSessionView {
    const hold = this.holdOf(record.state)
    const expired = hold !== undefined && now >= record.settledAt + hold
    const state: PetAgentState = waiting ? 'WAITING' : expired ? 'IDLE' : record.state
    const tool = [...record.openTools.values()].at(-1)
    const project = projectOf(record.cwd)
    return {
      sessionId: record.sessionId,
      ...(record.title === undefined ? {} : { title: record.title }),
      ...(project === undefined ? {} : { project }),
      ...(record.cwd === undefined ? {} : { cwd: record.cwd }),
      state,
      ...(state === 'WORKING' && tool !== undefined ? { activity: classifyTool(tool) } : {}),
      ...(tool === undefined ? {} : { tool }),
      ...(record.progress === undefined ? {} : { progress: record.progress }),
      subagent: record.subagent,
      unseenResult: record.unseenResult,
      updatedAt: record.updatedAt,
    }
  }
}
