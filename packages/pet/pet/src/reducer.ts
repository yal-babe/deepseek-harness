/**
 * Pure fold from durable Session events to the Studio Pet snapshot. The fold
 * owns no timers and reads no clock: callers pass event times and the
 * snapshot time, so replaying the same events yields the same snapshot.
 *
 * Goal awareness reads `goal/change` and goal-attributed `user/message`
 * events structurally, without importing the goal domain: only the final
 * round of a goal announces a result, as in PC2005-cloud/dsh-pet.
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
  PetSettingsView,
  PetSnapshot,
  PetWorkActivity,
} from './types.ts'
import type { PetMoment } from './time-context.ts'

/** Session facts the fold reads besides the event itself. */
export interface PetSessionMeta {
  /** Session identity. */
  readonly sessionId: SessionId
  /** Absolute working directory from the Session header. */
  readonly cwd?: string
  /** Whether the Session header marks a subagent child. */
  readonly subagent: boolean
  /** Parent Session of a subagent child (header `parentSession`); absent for top-level and forked Sessions. */
  readonly parentSessionId?: SessionId
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
  /**
   * Hold a successful result while subagent descendants of the Session still
   * run a turn or own an unsettled job; the Session reads `WORKING` until they
   * are quiet. Off when omitted.
   */
  readonly holdCompletions?: boolean
  /** Milliseconds descendants must stay quiet before a held result settles. Defaults to 1500. */
  readonly completionQuietMs?: number
}

/** Default quiet window of a held result, the notification delay of PC2005-cloud/dsh-pet. */
export const PET_COMPLETION_QUIET_MS = 1500

/** Host-owned values the snapshot carries besides folded events. */
export interface PetSnapshotInputs {
  /** Frame counter assigned by the caller. */
  readonly revision: number
  /** "Show desktop pet" setting. */
  readonly visible: boolean
  /** Pinned Session, when one is set. */
  readonly pinnedSessionId: SessionId | undefined
  /** Shared pet settings; they also decide `restrictedInPet` of each pending approval. */
  readonly settings: PetSettingsView
  /** Host-local time context, computed by the caller from its clock. */
  readonly moment?: PetMoment
}

/**
 * Whether the settings route one tool to the main window instead of the pet approval card.
 * @param settings - shared pet settings.
 * @param toolName - tool that asked for approval.
 * @returns true only while the restriction is on and lists the tool.
 */
export function isRestrictedInPet(settings: PetSettingsView, toolName: string): boolean {
  return settings.restrictTools && settings.restrictedTools.includes(toolName)
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
  /** The current turn is a goal round, or created, edited, or resumed a goal. */
  goalTurn: boolean
  /** Whether the latest `goal/change` left a goal that expects further rounds. */
  goalActive: boolean
  /** How the goal closed during the current turn, if it did. */
  goalClosing: 'complete' | 'blocked' | undefined
  /** An intermediate goal round ended; the next round has not started yet. */
  goalAwaitingRound: boolean
  /** A successful result held while descendants work; `quietSince` is set once they are quiet. */
  held: { quietSince: number | undefined } | undefined
}

/** `goal/change` operations that leave a goal expecting further rounds. */
const GOAL_CONTINUING = new Set(['create', 'edit', 'resume'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Operation of a `goal/change` payload, read structurally.
 * @param data - event payload.
 * @returns the operation, or `undefined` for a payload that is not a goal change.
 */
function goalOperationOf(data: unknown): string | undefined {
  if (!isRecord(data) || data['kind'] !== 'goal/change') return undefined
  const operation = data['operation']
  return typeof operation === 'string' ? operation : undefined
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
  // The last in-progress item: models often mark the next item before closing the previous one.
  const current = todos.findLastIndex(todo => todo.status === 'in_progress')
  return current < 0 ? { completed, total: todos.length } : { completed, total: todos.length, current: current + 1 }
}

function projectOf(cwd: string | undefined): string | undefined {
  if (cwd === undefined) return undefined
  return cwd.split(/[\\/]/u).filter(part => part.length > 0).at(-1)
}

/** Incremental Studio Pet state over all live Sessions. */
export class PetReducer {
  private readonly records = new Map<SessionId, SessionRecord>()
  private readonly approvals = new Map<PetApprovalRequestId, Omit<PetPendingApproval, 'restrictedInPet'>>()
  private readonly jobs = new Map<JobId, PetJobView>()
  /** Parent of every subagent child seen, tracked even when subagents are not shown. */
  private readonly parents = new Map<SessionId, SessionId>()
  /** Subagent children with an open turn, tracked even when subagents are not shown. */
  private readonly busyChildren = new Set<SessionId>()

  /** @param options - resolved fold options. */
  constructor(private readonly options: PetReducerOptions) {}

  /**
   * Fold one committed Session event.
   * @param meta - header facts of the Session that appended the event.
   * @param event - the appended event, exactly as recorded.
   * @returns whether the published snapshot can differ after this event.
   */
  apply(meta: PetSessionMeta, event: SessionEvent): boolean {
    const settled = this.settleHeld(event.time)
    if (meta.subagent && meta.parentSessionId !== undefined) this.parents.set(meta.sessionId, meta.parentSessionId)
    const changed = this.applyEvent(meta, event)
    return this.recheckHeld(meta, event, event.time) || changed || settled
  }

  private applyEvent(meta: PetSessionMeta, event: SessionEvent): boolean {
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
   * @param now - Unix epoch milliseconds of the disposal; it starts the quiet window of results the Session held.
   * @returns whether anything was removed.
   */
  remove(sessionId: SessionId, now = 0): boolean {
    let changed = this.settleHeld(now)
    changed = this.records.delete(sessionId) || changed
    this.busyChildren.delete(sessionId)
    this.parents.delete(sessionId)
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
    return this.recheckAllHeld(now) || changed
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
    this.settleHeld(now)
    let earliest: number | undefined
    for (const record of this.records.values()) {
      const quietSince = record.held?.quietSince
      if (quietSince !== undefined) {
        const end = quietSince + this.quietMs()
        if (end > now && (earliest === undefined || end < earliest)) earliest = end
        continue
      }
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
    this.settleHeld(now)
    const waiting = new Set([...this.approvals.values()].map(approval => approval.sessionId))
    const views = [...this.records.values()].map(record => this.view(record, now, waiting.has(record.sessionId)))
    views.sort((left, right) =>
      PET_STATE_PRIORITY[right.state] - PET_STATE_PRIORITY[left.state]
      || right.updatedAt - left.updatedAt
      || left.sessionId.localeCompare(right.sessionId))
    const pending: PetPendingApproval[] = [...this.approvals.values()]
      .sort((left, right) => left.askedAt - right.askedAt)
      .map(approval => ({ ...approval, restrictedInPet: isRestrictedInPet(inputs.settings, approval.toolName) }))
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
      settings: inputs.settings,
      ...(inputs.moment === undefined ? {} : { moment: inputs.moment }),
    }
  }

  private applyTurnEvent(meta: PetSessionMeta, event: SessionEvent): boolean {
    if (meta.subagent && !this.options.includeSubagents) return false
    // `goal/change` belongs to the optional goal domain, which this package does not import.
    const type: string = event.type
    if (type === 'goal/change') {
      const data: unknown = event.data
      return this.applyGoalChange(meta, event.time, goalOperationOf(data))
    }
    switch (event.type) {
      case 'turn/start': {
        const record = this.touch(meta, event.time)
        record.turnActive = true
        record.openTools.clear()
        record.progress = undefined
        record.unseenResult = false
        record.state = 'THINKING'
        record.held = undefined
        record.goalTurn = false
        record.goalClosing = undefined
        record.goalAwaitingRound = false
        return true
      }
      case 'user/message': {
        const kind: string = event.data.source.kind
        const record = this.records.get(meta.sessionId)
        if (kind === 'goal' && record?.turnActive === true) record.goalTurn = true
        return false
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
        record.state = this.goalOutcome(record, this.turnOutcome(event.data.reason.kind))
        if (record.state === 'SUCCESS' && this.options.holdCompletions === true && !record.subagent
          && this.descendantsBusy(record.sessionId)) {
          record.held = { quietSince: undefined }
          record.state = 'WORKING'
        }
        record.unseenResult = record.state === 'SUCCESS' || record.state === 'ERROR'
        record.goalTurn = false
        record.goalClosing = undefined
        return true
      }
      default:
        return false
    }
  }

  /**
   * Fold one goal lifecycle change. Inside a turn it only records how the goal
   * stands; between turns a `block` after an intermediate round (the round
   * limit) is the goal's final result and announces `ERROR`.
   */
  private applyGoalChange(meta: PetSessionMeta, time: number, operation: string | undefined): boolean {
    if (operation === undefined) return false
    const record = this.touch(meta, time)
    record.goalActive = GOAL_CONTINUING.has(operation)
    if (record.turnActive) {
      if (record.goalActive) record.goalTurn = true
      if (operation === 'complete') record.goalClosing = 'complete'
      if (operation === 'block') record.goalClosing = 'blocked'
      return false
    }
    const awaiting = record.goalAwaitingRound
    record.goalAwaitingRound = false
    if (!awaiting || operation !== 'block') return false
    record.state = 'ERROR'
    record.settledAt = time
    record.unseenResult = true
    return true
  }

  /**
   * Final turn state once goal rounds are taken into account: a goal blocked
   * during the turn reads as `ERROR`, and a successful round of a goal that
   * still expects rounds reads as `IDLE` without an unseen result.
   */
  private goalOutcome(record: SessionRecord, outcome: TurnState): TurnState {
    if (outcome !== 'SUCCESS') return outcome
    if (record.goalClosing === 'blocked') return 'ERROR'
    if (record.goalClosing === undefined && record.goalTurn && record.goalActive) {
      record.goalAwaitingRound = true
      return 'IDLE'
    }
    return outcome
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
        goalTurn: false,
        goalActive: false,
        goalClosing: undefined,
        goalAwaitingRound: false,
        held: undefined,
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
      goalTurn: false,
      goalActive: false,
      goalClosing: undefined,
      goalAwaitingRound: false,
      held: undefined,
    }
  }

  private quietMs(): number {
    return this.options.completionQuietMs ?? PET_COMPLETION_QUIET_MS
  }

  /** Whether `sessionId` is a strict ancestor of `candidate` through subagent parent links. */
  private isAncestor(sessionId: SessionId, candidate: SessionId): boolean {
    const seen = new Set<SessionId>()
    let current = this.parents.get(candidate)
    while (current !== undefined && !seen.has(current)) {
      if (current === sessionId) return true
      seen.add(current)
      current = this.parents.get(current)
    }
    return false
  }

  /**
   * Whether subagent descendants of a Session still work: an open turn, or an
   * unsettled job they own. Jobs of the Session itself, such as a dev server,
   * do not hold its result.
   */
  private descendantsBusy(sessionId: SessionId): boolean {
    for (const child of this.busyChildren) if (this.isAncestor(sessionId, child)) return true
    for (const job of this.jobs.values()) if (this.isAncestor(sessionId, job.owner)) return true
    return false
  }

  /** Track subagent turns, then refresh held results the event may concern. */
  private recheckHeld(meta: PetSessionMeta, event: SessionEvent, time: number): boolean {
    if (meta.subagent && event.type === 'turn/start') this.busyChildren.add(meta.sessionId)
    else if (meta.subagent && event.type === 'turn/end') this.busyChildren.delete(meta.sessionId)
    else if (event.type !== 'job/registered' && event.type !== 'job/settled') return false
    return this.recheckAllHeld(time)
  }

  /** Start or stop the quiet window of every held result. */
  private recheckAllHeld(time: number): boolean {
    let changed = false
    for (const record of this.records.values()) {
      const held = record.held
      if (held === undefined) continue
      const busy = this.descendantsBusy(record.sessionId)
      if (busy && held.quietSince !== undefined) held.quietSince = undefined
      else if (!busy && held.quietSince === undefined) held.quietSince = time
      else continue
      changed = true
    }
    return changed
  }

  /** Settle held results whose quiet window ended by `now`; the result counts from the window's end. */
  private settleHeld(now: number): boolean {
    let settled = false
    for (const record of this.records.values()) {
      const quietSince = record.held?.quietSince
      if (quietSince === undefined || now < quietSince + this.quietMs()) continue
      record.held = undefined
      record.state = 'SUCCESS'
      record.settledAt = quietSince + this.quietMs()
      record.unseenResult = true
      settled = true
    }
    return settled
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
