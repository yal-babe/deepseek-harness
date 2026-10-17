/**
 * Pet-side answering of `ask_user_question` requests. ui-user-questions
 * publishes each request as a `PendingQuestion` in `uiSession.sessionStatus`;
 * the pet answers that same object, so the Gateway's first-result-wins
 * settlement resolves the main window and the pet window together.
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PendingInteractionLike } from './approvals.ts'

/** One offered option. */
export interface PetQuestionOption {
  /** Option label, also the submitted value. */
  readonly label: string
  /** Optional explanation. */
  readonly description?: string | undefined
}

/** One question of a request. */
export interface PetQuestionItem {
  /** Question id echoed in the answer. */
  readonly id: string
  /** Question text. */
  readonly question: string
  /** Short header, when supplied. */
  readonly header?: string | undefined
  /** Offered options; absent for free text. */
  readonly options?: readonly PetQuestionOption[] | undefined
  /** Whether several options may be chosen. */
  readonly multiSelect?: boolean | undefined
}

/** Answer batch accepted by `PendingQuestion.answer`. */
export interface PetQuestionAnswer {
  answers: { id: string; selected: string[] }[]
}

/** The answerable face of one ui-user-questions `PendingQuestion`. */
export interface AnswerableQuestion {
  /** Presentation discriminator; plan reviews stay in the main window. */
  readonly kind: 'question'
  /** Opaque presentation identity. */
  readonly key: string
  /** Session owning the request. */
  readonly sessionId: SessionId
  /** The request's questions. */
  readonly questions: readonly PetQuestionItem[]
  /** Recorded answers of a settled call; such a card is read-only. */
  readonly review: unknown
  /**
   * Submit the whole answer batch.
   * @param answer - one selection per question.
   */
  readonly answer: (answer: PetQuestionAnswer) => Promise<void>
}

/**
 * Collect live questions from the Session status snapshot.
 * @param status - Session status entries from `uiSession.sessionStatus`.
 * @returns unanswered questions, in snapshot order.
 */
export function collectQuestions(
  status: Iterable<{ readonly pendingInteraction: PendingInteractionLike | undefined }>,
): AnswerableQuestion[] {
  const questions: AnswerableQuestion[] = []
  for (const entry of status) {
    const pending = entry.pendingInteraction
    if (pending?.kind !== 'question' || !isQuestion(pending) || pending.review !== undefined) continue
    questions.push(pending)
  }
  return questions
}

function isQuestion(value: PendingInteractionLike): value is PendingInteractionLike & AnswerableQuestion {
  return 'answer' in value && typeof value.answer === 'function' && 'sessionId' in value
    && 'questions' in value && Array.isArray(value.questions)
}

/**
 * Whether the pet can answer the request with option buttons alone: every
 * question offers options and allows one choice. Anything else (free text,
 * multi-select) is answered in the main window.
 * @param question - request to inspect.
 * @returns whether the pet card can answer it.
 */
export function petAnswerable(question: AnswerableQuestion): boolean {
  return question.questions.length > 0 && question.questions.every(item =>
    item.multiSelect !== true && item.options !== undefined && item.options.length > 0)
}

/** Result of one pet answer attempt. */
export type PetAnswerResult = 'answered' | 'in-flight' | 'incomplete' | 'failed'

/** Guards against double submission of a question from the pet surface. */
export class PetQuestionBridge {
  private readonly inFlight = new Set<string>()

  /**
   * Answer one question request at most once from this surface.
   * @param question - local presentation to settle.
   * @param selections - chosen option label per question id.
   * @returns `answered` when submitted, `incomplete` when a question has no
   * valid choice, `in-flight` while an earlier call is settling, `failed` when
   * the request no longer accepts an answer (for example another window answered it).
   */
  async answer(question: AnswerableQuestion, selections: Readonly<Record<string, string>>): Promise<PetAnswerResult> {
    if (this.inFlight.has(question.key)) return 'in-flight'
    const answers: { id: string; selected: string[] }[] = []
    for (const item of question.questions) {
      const choice = selections[item.id]
      if (choice === undefined || item.options?.some(option => option.label === choice) !== true) return 'incomplete'
      answers.push({ id: item.id, selected: [choice] })
    }
    this.inFlight.add(question.key)
    try {
      await question.answer({ answers })
      return 'answered'
    } catch {
      return 'failed'
    } finally {
      this.inFlight.delete(question.key)
    }
  }
}
