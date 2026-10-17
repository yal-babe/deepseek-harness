/**
 * Pet-side answering of approvals. Each Client already answers the forwarded
 * `approval/request` waterfall through ui-approval's `PendingApproval`; the pet
 * answers that same object, so the Gateway's first-result-wins settlement
 * resolves the main window and the pet window together.
 */
import type { PetPendingApproval } from '@deepseek-ai/dsh-pet/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ApprovalDecision } from '@deepseek-ai/dsh-client-ui-approval/client'

/** The answerable face of one ui-approval `PendingApproval`. */
export interface AnswerableApproval {
  /** Opaque presentation identity. */
  readonly key: string
  /** Session owning the request. */
  readonly sessionId: SessionId
  /** Tool requesting the decision. */
  readonly toolName: string
  /** Correlated tool call, when supplied. */
  readonly callId?: string | undefined
  /** Whether the request still accepts a decision. */
  readonly answerable: boolean
  /**
   * Settle the request.
   * @param outcome - interactive decision.
   */
  answer(outcome: ApprovalDecision): Promise<void>
}

/** Minimal pending-interaction shape read from the Session status snapshot. */
export interface PendingInteractionLike {
  readonly kind: string
}

/**
 * Collect answerable approvals from the Session status snapshot.
 * @param status - Session status entries from `uiSession.sessionStatus`.
 * @returns approvals still accepting a decision, in snapshot order.
 */
export function collectApprovals(
  status: Iterable<{ readonly pendingInteraction: PendingInteractionLike | undefined }>,
): AnswerableApproval[] {
  const approvals: AnswerableApproval[] = []
  for (const entry of status) {
    const pending = entry.pendingInteraction
    if (pending?.kind !== 'approval' || !isAnswerable(pending)) continue
    if (pending.answerable) approvals.push(pending)
  }
  return approvals
}

function isAnswerable(value: PendingInteractionLike): value is PendingInteractionLike & AnswerableApproval {
  return 'answer' in value && typeof value.answer === 'function' && 'sessionId' in value && 'answerable' in value
}

/**
 * Find the local answerable presentation of one Host-tracked approval.
 * Matching uses the Session and tool call; without a call id it falls back to the tool name.
 * @param pending - approval from the Host pet snapshot.
 * @param local - answerable approvals of this Client.
 * @returns the matching presentation, or `undefined` when this Client cannot answer it.
 */
export function matchApproval(
  pending: PetPendingApproval,
  local: readonly AnswerableApproval[],
): AnswerableApproval | undefined {
  return local.find(candidate => candidate.sessionId === pending.sessionId && (
    pending.callId !== undefined && candidate.callId !== undefined
      ? candidate.callId === pending.callId
      : candidate.toolName === pending.toolName))
}

/**
 * Read `answerable` without the narrowing of an earlier check.
 * @param approval - request to read.
 * @returns whether it still accepts an answer.
 */
function stillAnswerable(approval: AnswerableApproval): boolean {
  return approval.answerable
}

/** Result of one pet decision attempt. */
export type PetDecisionResult = 'decided' | 'already-settled' | 'in-flight' | 'failed'

/** Guards against double submission from the pet surface. */
export class PetApprovalBridge {
  private readonly inFlight = new Set<string>()

  /**
   * Answer one approval at most once from this surface.
   * @param approval - local presentation to settle.
   * @param outcome - interactive decision.
   * @returns `decided` when this call settled it, `already-settled` when another
   * window or the Host finished it first, `in-flight` while an earlier call from
   * this surface is still settling, `failed` otherwise.
   */
  async decide(approval: AnswerableApproval, outcome: ApprovalDecision): Promise<PetDecisionResult> {
    if (this.inFlight.has(approval.key)) return 'in-flight'
    if (!approval.answerable) return 'already-settled'
    this.inFlight.add(approval.key)
    try {
      await approval.answer(outcome)
      return 'decided'
    } catch {
      // Re-read after the await: a lost race withdraws the request meanwhile.
      return stillAnswerable(approval) ? 'failed' : 'already-settled'
    } finally {
      this.inFlight.delete(approval.key)
    }
  }
}
