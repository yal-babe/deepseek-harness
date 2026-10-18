/** Pet actions shared by the in-page overlay and the Desktop pet window. */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ApprovalDecision } from '@deepseek-ai/dsh-client-ui-approval/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { collectApprovals, PetApprovalBridge, type AnswerableApproval, type PendingInteractionLike, type PetDecisionResult } from './approvals.ts'
import { collectQuestions, PetQuestionBridge, type AnswerableQuestion, type PetAnswerResult } from './questions.ts'
import { sendQuickAsk, type QuickAskDeps, type QuickAskOutcome, type QuickAskTarget } from './quick-ask.ts'
import { setDeviceNotify, type NotificationSink } from './notifier.ts'
import { PET_SNOOZE_MS, type PetPreferences, type PetPreferenceStore } from './preferences.ts'
import type { PetViewState } from './store.ts'
import { petDesktopGeometry, type DesktopPetBridge, type PetDesktopGeometry, type PetDesktopRect, type PetDragPhase } from './surface.ts'

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
  /**
   * Show one Session in this document's main view (Web, where the pet shares the page).
   * @param sessionId - Session to show.
   */
  readonly openSession: (sessionId: SessionId) => void
  /** Device-local preferences. */
  readonly preferences: PetPreferenceStore
  /** System notifications, when the platform has them. */
  readonly notifications: NotificationSink | undefined
  /** Current epoch milliseconds. */
  readonly now: () => number
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

  /** Device-local preferences. */
  get preferences(): ObservableSnapshot<PetPreferences> {
    return this.deps.preferences.snapshot
  }

  /** Whether this platform can show system notifications. */
  get canNotify(): boolean {
    return this.deps.notifications !== undefined
  }

  /**
   * Turn system notifications on or off. Turning them on asks for permission
   * first (call from a user gesture) and stays off when it is refused.
   * @param on - requested value.
   * @returns the resulting value.
   */
  setNotify(on: boolean): Promise<boolean> {
    return setDeviceNotify(this.deps.notifications, this.deps.preferences, on)
  }

  /** Snooze notifications for one hour. */
  snooze(): void {
    this.deps.preferences.update({ snoozeUntil: this.deps.now() + PET_SNOOZE_MS })
  }

  /** Change device-local movement and visual preferences without changing Host configuration.
   * @param patch - requested preference fields.
   */
  setPreferences(patch: Partial<PetPreferences>): void {
    this.deps.preferences.update(patch)
  }

  /** End a snooze early. */
  resume(): void {
    this.deps.preferences.update({ snoozeUntil: undefined })
  }

  /**
   * Bring the Desktop main window forward and show a Session there. On Web the
   * pet shares the page, so only the Session navigation happens.
   * @param sessionId - Session to show; defaults to the focused Session of the snapshot.
   */
  openMain(sessionId: SessionId | undefined = this.deps.view.getSnapshot().snapshot?.focusSessionId): void {
    const bridge = this.deps.bridge
    if (bridge !== undefined) bridge.openMain(sessionId)
    else if (sessionId !== undefined) this.deps.openSession(sessionId)
  }

  /**
   * Toggle pointer input of the Desktop pet window; no-op elsewhere.
   * @param interactive - whether the window takes pointer input.
   */
  setInteractive(interactive: boolean): void {
    this.deps.bridge?.setInteractive(interactive)
  }

  /** Enable Desktop wandering only while the current surface is idle and unobstructed.
   * @param active - whether autonomous movement is allowed.
   * @param activity - movement frequency preset.
   */
  wander(active: boolean, activity: 'quiet' | 'normal' | 'lively' = 'normal'): void { this.deps.bridge?.wander?.(active, activity) }

  /**
   * Move the Desktop pet window with a character drag; no-op elsewhere.
   * @param phase - drag phase.
   * @param thrown - on `end`: the renderer throws the character and reports the flight through {@link place}.
   */
  drag(phase: PetDragPhase, thrown = false): void {
    if (phase === 'end' && thrown) this.deps.bridge?.drag(phase, { thrown })
    else this.deps.bridge?.drag(phase)
  }

  /** Whether this Desktop bridge lets the renderer throw the window. */
  get canThrow(): boolean {
    const bridge = this.deps.bridge
    return bridge?.place !== undefined && bridge.onGeometry !== undefined
  }

  /**
   * Ask for a Desktop window origin during a throw.
   * @param point - window origin in DIP.
   * @param final - whether the flight ended.
   */
  place(point: { readonly x: number; readonly y: number }, final: boolean): void {
    this.deps.bridge?.place?.(point, final)
  }

  /** Whether this Desktop bridge can move the window with a walking clip. */
  get canWalk(): boolean {
    const bridge = this.deps.bridge
    return bridge?.travel !== undefined && bridge.onGeometry !== undefined
  }

  /**
   * Move the Desktop pet window with a walking clip.
   * @param dx - DIP since the last call, negative to the left.
   * @param final - the walk ended.
   */
  travel(dx: number, final: boolean): void {
    this.deps.bridge?.travel?.(dx, final)
  }

  /**
   * Report the character body inside the Desktop pet window.
   * @param rect - body in window DIP.
   */
  reportBody(rect: PetDesktopRect): void {
    this.deps.bridge?.body?.(rect)
  }

  /**
   * Report that a panel or menu opened or closed in the Desktop pet window.
   * @param open - whether one is open.
   */
  reveal(open: boolean): void {
    this.deps.bridge?.reveal?.(open)
  }

  /**
   * Observe Desktop window and display geometry; malformed reports are dropped.
   * @param listener - called with each valid report.
   * @returns unsubscribe.
   */
  onGeometry(listener: (geometry: PetDesktopGeometry) => void): () => void {
    return this.deps.bridge?.onGeometry?.((value) => {
      const geometry = petDesktopGeometry(value)
      if (geometry !== undefined) listener(geometry)
    }) ?? (() => {})
  }
}
