import { describe, expect, it, vi } from 'vitest'
import type { PendingInteractionLike } from '../src/client/approvals.ts'
import { collectQuestions, petAnswerable, PetQuestionBridge, type AnswerableQuestion, type PetQuestionItem } from '../src/client/questions.ts'
import { S1 } from './fixtures.ts'

const pick: PetQuestionItem = { id: 'q1', question: 'Which branch?', options: [{ label: 'main' }, { label: 'dev', description: 'unstable' }] }

function question(items: readonly PetQuestionItem[] = [pick], extra: Partial<AnswerableQuestion> = {}): AnswerableQuestion {
  return { kind: 'question', key: 'k', sessionId: S1, questions: items, review: undefined, answer: vi.fn(async () => {}), ...extra }
}

describe('collectQuestions', () => {
  it('keeps live questions and skips approvals, plan reviews, settled reviews, and foreign shapes', () => {
    const live = question()
    const entries: { pendingInteraction: PendingInteractionLike | undefined }[] = [
      { pendingInteraction: undefined },
      { pendingInteraction: { kind: 'approval' } },
      { pendingInteraction: { kind: 'plan-review' } },
      { pendingInteraction: { kind: 'question' } },
      { pendingInteraction: question(undefined, { review: [] }) },
      { pendingInteraction: live },
    ]
    expect(collectQuestions(entries)).toEqual([live])
  })
})

describe('petAnswerable', () => {
  it('accepts only single-choice option questions', () => {
    expect(petAnswerable(question())).toBe(true)
    expect(petAnswerable(question([]))).toBe(false)
    expect(petAnswerable(question([{ id: 'q', question: 'Why?' }]))).toBe(false)
    expect(petAnswerable(question([{ ...pick, options: [] }]))).toBe(false)
    expect(petAnswerable(question([{ ...pick, multiSelect: true }]))).toBe(false)
  })
})

describe('PetQuestionBridge', () => {
  it('submits one choice per question and rejects incomplete or invalid selections', async () => {
    const bridge = new PetQuestionBridge()
    const target = question([pick, { id: 'q2', question: 'Run tests?', options: [{ label: 'yes' }] }])
    expect(await bridge.answer(target, { q1: 'main' })).toBe('incomplete')
    expect(await bridge.answer(target, { q1: 'main', q2: 'maybe' })).toBe('incomplete')
    expect(await bridge.answer(question([{ id: 'q', question: 'free' }]), { q: 'x' })).toBe('incomplete')
    expect(await bridge.answer(target, { q1: 'dev', q2: 'yes' })).toBe('answered')
    expect(target.answer).toHaveBeenCalledWith({ answers: [{ id: 'q1', selected: ['dev'] }, { id: 'q2', selected: ['yes'] }] })
  })

  it('reports in-flight for a double click and failure when another window answered first', async () => {
    const bridge = new PetQuestionBridge()
    let release!: () => void
    const slow = question(undefined, { answer: vi.fn(() => new Promise<void>((resolve) => { release = resolve })) })
    const first = bridge.answer(slow, { q1: 'main' })
    expect(await bridge.answer(slow, { q1: 'main' })).toBe('in-flight')
    release()
    expect(await first).toBe('answered')
    const lost = question(undefined, { answer: vi.fn(async () => { throw new Error('no channel accepts an answer yet') }) })
    expect(await bridge.answer(lost, { q1: 'main' })).toBe('failed')
  })
})
