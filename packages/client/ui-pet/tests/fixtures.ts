/** Shared builders for ui-pet tests. */
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PetSessionView, PetSnapshot } from '@deepseek-ai/dsh-pet/types'
import { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval/types'
import type { PetPendingApproval } from '@deepseek-ai/dsh-pet/types'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'

export const S1 = SessionId('s1')
export const S2 = SessionId('s2')

/** One Session view. */
export function sessionView(sessionId: SessionId, extra: Partial<PetSessionView> = {}): PetSessionView {
  return { sessionId, state: 'IDLE', subagent: false, unseenResult: false, updatedAt: 1, ...extra }
}

/** One Host pending approval. */
export function hostPending(id: string, sessionId: SessionId, toolName: string, callId?: string): PetPendingApproval {
  return {
    id: ApprovalRequestId(id), sessionId, toolName, askedAt: 1,
    ...(callId === undefined ? {} : { callId: ToolCallId(callId) }),
  }
}

/** One Host snapshot. */
export function snapshot(extra: Partial<PetSnapshot> = {}): PetSnapshot {
  return { revision: 1, primary: 'IDLE', sessions: [], pending: [], jobs: [], visible: true, ...extra }
}
