/** Typed Session event builders for the pet fold tests. */
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session/types'
import { MessageId, ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { JobId } from '@deepseek-ai/dsh-jobs/brand'
import { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval/types'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-tool-todo/types'
import type {} from '@deepseek-ai/dsh-session-title'
import type { PetApprovalRequestId } from '../src/types.ts'
import type { PetSessionMeta } from '../src/reducer.ts'

export const S1 = SessionId('s1')
export const S2 = SessionId('s2')
export const SUB = SessionId('sub')

/** Header facts of a top-level Session. */
export const top = (sessionId: SessionId, cwd = '/work/dsh-studio'): PetSessionMeta => ({ sessionId, cwd, subagent: false })
/** Header facts of a subagent child. */
export const child = (sessionId: SessionId): PetSessionMeta => ({ sessionId, cwd: '/work/dsh-studio', subagent: true })

type NonSurface = Exclude<keyof SessionEventMap, 'system/message' | 'developer/message' | 'user/message' | 'assistant/message' | 'tool/result'>

/**
 * Build one non-surface event.
 * @param type - event type.
 * @param time - event time and sequence.
 * @param data - typed payload.
 * @returns the recorded envelope.
 */
export function ev<K extends NonSurface>(type: K, time: number, data: SessionEventMap[K]): SessionEvent {
  const event: { type: K; seq: SessionSeq; time: number; data: SessionEventMap[K] } = { type, seq: SessionSeq(time), time, data }
  return event as SessionEvent
}

/**
 * Build one `tool/result` event.
 * @param time - event time and sequence.
 * @param callId - answered tool call.
 * @param isError - tool failure marker.
 * @returns the recorded envelope.
 */
export function toolResult(time: number, callId: string, isError = false): SessionEvent {
  return {
    type: 'tool/result',
    seq: SessionSeq(time),
    time,
    surfaceOp: 'append',
    data: {
      turn: 1,
      step: 1,
      message: {
        id: MessageId(`m-${callId}`),
        role: 'tool',
        content: [],
        source: { kind: 'tool', callId: ToolCallId(callId) },
        toolCallId: ToolCallId(callId),
        isError,
      },
    },
  }
}

export const turnStart = (time: number): SessionEvent => ev('turn/start', time, { turn: 1 })
export const stepStart = (time: number): SessionEvent => ev('step/start', time, { turn: 1, step: 1 })
export const turnEnd = (time: number, reason: SessionEventMap['turn/end']['reason']): SessionEvent =>
  ev('turn/end', time, { turn: 1, reason })
export const toolCall = (time: number, callId: string, name: string): SessionEvent =>
  ev('tool/call', time, { turn: 1, step: 1, callId: ToolCallId(callId), name, arguments: '{}' })
export const approvalId = (id: string): PetApprovalRequestId => ApprovalRequestId(id)
export const asked = (time: number, id: string, toolName: string, callId?: string): SessionEvent =>
  ev('approval/asked', time, { id: approvalId(id), toolName, ...(callId === undefined ? {} : { callId: ToolCallId(callId) }) })
export const decided = (time: number, id: string): SessionEvent =>
  ev('approval/decided', time, { id: approvalId(id), outcome: 'allowed-once' })
export const jobRegistered = (time: number, id: string, owner: SessionId): SessionEvent =>
  ev('job/registered', time, { jobId: JobId(id), owner, kind: 'shell', label: 'pnpm test', startedAt: time })
export const jobSettled = (time: number, id: string, owner: SessionId): SessionEvent =>
  ev('job/settled', time, {
    jobId: JobId(id), owner, kind: 'shell', label: 'pnpm test', startedAt: 1, finishedAt: time,
    status: 'completed', cause: 'producer', producerReported: true,
  })

/**
 * Build one `goal/change` event as dsh-goal records it. The pet does not
 * import the goal domain, so the payload is built structurally.
 * @param time - event time and sequence.
 * @param operation - goal operation.
 * @returns the recorded envelope.
 */
export function goalChange(time: number, operation: string): SessionEvent {
  const data = operation === 'clear'
    ? { kind: 'goal/change', version: 1, operation, cleared: { id: 'g1', revision: 1 }, clearedAt: time }
    : { kind: 'goal/change', version: 1, operation, goal: { id: 'g1' }, roundsStarted: 0, createdAt: 1, updatedAt: time }
  return { type: 'goal/change', seq: SessionSeq(time), time, data } as unknown as SessionEvent
}

/**
 * Build the `user/message` that opens one goal round.
 * @param time - event time and sequence.
 * @param round - admitted round.
 * @returns the recorded envelope.
 */
export function goalRound(time: number, round: number): SessionEvent {
  return {
    type: 'user/message',
    seq: SessionSeq(time),
    time,
    surfaceOp: 'append',
    data: { id: MessageId(`goal-${String(round)}`), role: 'user', content: [], source: { kind: 'goal', goalId: 'g1', revision: 1, round } },
  } as unknown as SessionEvent
}
