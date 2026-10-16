import { describe, expect, it } from 'vitest'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { calculateTokenActivity } from '../src/token-usage.ts'

function createTurn(
  startSeq: number,
  time: number,
  usage?: { inputTokens: number; outputTokens: number; totalTokens?: number; cacheReadTokens?: number; reasoningTokens?: number },
): SessionEvent[] {
  const events: SessionEvent[] = [
    { type: 'turn/start', seq: SessionSeq(startSeq), time, data: { turn: 1 } },
    {
      type: 'assistant/message',
      seq: SessionSeq(startSeq + 1),
      time: time + 10,
      surfaceOp: 'append',
      data: {
        turn: 1,
        step: 0,
        message: createAssistantMessage({ source: { provider: 'mock', model: 'mock' }, content: [{ type: 'text', text: 'hello' }] }),
        stream: [],
        ...(usage ? { usage } : {}),
      },
    },
    { type: 'turn/end', seq: SessionSeq(startSeq + 2), time: time + 20, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  return events
}

describe('calculateTokenActivity', () => {
  it('aggregates tokens and counts across turns in a session', () => {
    const turn1 = createTurn(0, 1000, { inputTokens: 50, outputTokens: 20, totalTokens: 70, cacheReadTokens: 10, reasoningTokens: 5 })
    const turn2 = createTurn(3, 2000, { inputTokens: 100, outputTokens: 40, totalTokens: 140, cacheReadTokens: 20, reasoningTokens: 10 })

    const result = calculateTokenActivity([[...turn1, ...turn2]])
    expect(result).toEqual({
      totalTokens: 210,
      inputTokens: 150,
      outputTokens: 60,
      cacheReadTokens: 30,
      reasoningTokens: 15,
      turnsCount: 2,
      sessionsCount: 1,
    })
  })

  it('deduplicates inherited turns across parent and child sessions', () => {
    const turn1 = createTurn(0, 1000, { inputTokens: 50, outputTokens: 20, totalTokens: 70, cacheReadTokens: 10, reasoningTokens: 5 })
    const parentSession = [...turn1]

    const turn2 = createTurn(3, 2000, { inputTokens: 100, outputTokens: 40, totalTokens: 140, cacheReadTokens: 20, reasoningTokens: 10 })
    const childSession = [...turn1, ...turn2]

    const result = calculateTokenActivity([parentSession, childSession])
    expect(result).toEqual({
      totalTokens: 210,
      inputTokens: 150,
      outputTokens: 60,
      cacheReadTokens: 30,
      reasoningTokens: 15,
      turnsCount: 2,
      sessionsCount: 2,
    })
  })

  it('counts turns accurately when ancestor session is absent', () => {
    const turn1 = createTurn(0, 1000, { inputTokens: 50, outputTokens: 20, totalTokens: 70, cacheReadTokens: 10, reasoningTokens: 5 })
    const turn2 = createTurn(3, 2000, { inputTokens: 100, outputTokens: 40, totalTokens: 140, cacheReadTokens: 20, reasoningTokens: 10 })
    const childSessionOnly = [...turn1, ...turn2]

    const result = calculateTokenActivity([childSessionOnly])
    expect(result.turnsCount).toBe(2)
    expect(result.totalTokens).toBe(210)
    expect(result.sessionsCount).toBe(1)
  })

  it('ignores turns without usage data', () => {
    const turnWithoutUsage = createTurn(0, 1000)
    const turnWithUsage = createTurn(3, 2000, { inputTokens: 30, outputTokens: 10 })

    const result = calculateTokenActivity([[...turnWithoutUsage, ...turnWithUsage]])
    expect(result.turnsCount).toBe(1)
    expect(result.totalTokens).toBe(40)
  })
})
