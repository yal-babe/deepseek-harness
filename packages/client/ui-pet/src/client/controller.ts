/** Pet actions shared by the in-page overlay and the Desktop pet window. */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ApprovalDecision } from '@deepseek-ai/dsh-client-ui-approval/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { collectApprovals, PetApprovalBridge, type AnswerableApproval, type PendingInteractionLike, type PetDecisionResult } from './approvals.ts'
import { collectQuestions, PetQuestionBridge, type AnswerableQuestion, type PetAnswerResult } from './questions.ts'
import { sendQuickAsk, type QuickAskDeps, type QuickAskOutcome, type QuickAskTarget } from './quick-ask.ts'
import type { PetViewState } from './store.ts'
import type { DesktopPetBridge } from './surface.ts'

/** Session status source slice: `uiSession.sessionStatus`. */
export type SessionStatusSource = ObservableSnapshot<
  ReadonlyMap<SessionId, { readonly pendingInteraction: PendingInteractionLike | undefined }>
>

/** Collaborators of the pet controller. */
export interface PetControllerDeps {
  /** Mirror of the Host pet snapshot. */
  readonly view: ObservableSnapshot<PetViewState>
  /** Session status with ui-approval pending interactions. */
  readonly sessionStatus: SessionStatusSource
  /** Bound quick-ask Remote operations. */
  readonly quickAsk: QuickAskDeps
  /**
   * Update the Host "show desktop pet" value.
   * @param visible - new value.
   */
  readonly setVisible: (visible: boolean) => Promise<void>
  /**
   * Mark a Session result as seen.
   * @param sessionId - acknowledged Session.
   */
  readonly acknowledge: (sessionId: SessionId) => Promise<void>
  /** Desktop pet-window bridge, when present. */
  readonly bridge: DesktopPetBridge | undefined
}

/** Where the quick ask goes, as chosen in the pet. */
export type QuickAskChoice = 'last' | 'new'

/** Actions and derived sources used by the pet components. */
export class PetController {
  /** Answerable approvals of this Client, derived from Session status. */
  readonly approvals: ObservableSnapshot<readonly AnswerableApproval[]>
  /** Unanswered questions of this Client, derived from Session status. */
  readonly questions: ObservableSnapshot<readonly AnswerableQuestion[]>
  private readonly decisions = new PetApprovalBridge()
  private readonly replies = new PetQuestionBridge()
  private lastStatus: unknown
  private lastApprovals: readonly AnswerableApproval[] = []
  private lastQuestions: readonly AnswerableQuestion[] = []

  /** @param deps - collaborators bound by the plugin. */
  constructor(private readonly deps: PetControllerDeps) {
    this.approvals = {
      getSnapshot: () => {
        const status = deps.sessionStatus.getSnapshot()
        if (status !== this.lastStatus) {
          this.lastStatus = status
          this.lastApprovals = collectApprovals(status.values())
          this.lastQuestions = collectQuestions(status.values())
        }
        return this.lastApprovals
      },
      subscribe: listener => deps.sessionStatus.subscribe(listener),
    }
    this.questions = {
      getSnapshot: () => {
        this.approvals.getSnapshot()
        return this.lastQuestions
      },
      subscribe: listener => deps.sessionStatus.subscribe(listener),
    }
  }

  /**
   * Answer one question request at most once from this surface.
   * @param question - local presentation to settle.
   * @param selections - chosen option label per question id.
   * @returns the answer result.
   */
  answerQuestion(question: AnswerableQuestion, selections: Readonly<Record<string, string>>): Promise<PetAnswerResult> {
    return this.replies.answer(question, selections)
  }

  /**
   * Answer one approval at most once from this surface.
   * @param approval - local presentation to settle.
   * @param outcome - interactive decision.
   * @returns the decision result.
   */
  decide(approval: AnswerableApproval, outcome: ApprovalDecision): Promise<PetDecisionResult> {
    return this.decisions.decide(approval, outcome)
  }

  /**
   * Resolve the quick-ask destination from the current snapshot.
   * @param choice - `last` follows the focused Session; `new` starts one in its directory.
   * @returns the concrete target.
   */
  target(choice: QuickAskChoice): QuickAskTarget {
    const snapshot = this.deps.view.getSnapshot().snapshot
    const focus = snapshot?.sessions.find(view => view.sessionId === snapshot.focusSessionId)
    if (choice === 'last' && focus !== undefined) return { kind: 'session', sessionId: focus.sessionId }
    return { kind: 'new', cwd: focus?.cwd }
  }

  /**
   * Send a quick ask.
   * @param text - prompt text.
   * @param files - attachments.
   * @param choice - destination choice.
   * @param signal - cancellation.
   * @returns the outcome.
   */
  ask(text: string, files: readonly File[], choice: QuickAskChoice, signal: AbortSignal): Promise<QuickAskOutcome> {
    return sendQuickAsk(this.deps.quickAsk, { text, files, target: this.target(choice), signal })
  }

  /** Hide the pet on every surface through the Host setting. */
  hide(): Promise<void> {
    return this.deps.setVisible(false)
  }

  /** Show the pet again on every surface (the Desktop quick-ask shortcut uses it). */
  show(): Promise<void> {
    return this.deps.setVisible(true)
  }

  /**
   * Mark a Session result as seen.
   * @param sessionId - Session the user looked at.
   */
  acknowledge(sessionId: SessionId): Promise<void> {
    return this.deps.acknowledge(sessionId)
  }

  /** Bring the Desktop main window forward; no-op on Web. */
  openMain(): void {
    this.deps.bridge?.openMain()
  }

  /**
   * Toggle pointer input of the Desktop pet window; no-op elsewhere.
   * @param interactive - whether the window takes pointer input.
   */
  setInteractive(interactive: boolean): void {
    this.deps.bridge?.setInteractive(interactive)
  }
}
