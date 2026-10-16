import { describe, expect, it } from 'vitest'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { assembleSnapshot, dayKey, foldSessionUsage } from '../src/fold.ts'

const seq = (value: number) => SessionSeq(value)

function event(type: SessionEvent['type'], time: number, data: unknown): SessionEvent {
  return { type, seq: seq(time), time, data } as unknown as SessionEvent
}

describe('foldSessionUsage', () => {
  it('buckets tokens by local day and records tools and models', () => {
    const offset = 8 * 3600
    const morning = Date.parse('2026-10-15T01:00:00.000Z')
    const folded = foldSessionUsage('s1', 'Demo', [
      event('request/context', morning, { provider: 'deepseek-official', model: 'deepseek-v4-flash' }),
      event('assistant/message', morning, {
        turn: 1, step: 1, message: { role: 'assistant', content: [] }, stream: [],
        usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 2, cacheWriteTokens: 1 },
      }),
      event('tool/call', morning, { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{}' }),
    ], offset)
    expect(dayKey(morning, offset)).toBe('2026-10-15')
    expect(folded.tokens).toEqual({
      uncachedInputTokens: 10, cacheReadTokens: 2, cacheWriteTokens: 1, outputTokens: 4,
    })
    expect(folded.toolCalls.get('bash')).toBe(1)
    expect(folded.models.get('deepseek-v4-flash')?.outputTokens).toBe(4)
  })

  it('ignores assistant messages without usage and still counts later tools', () => {
    const folded = foldSessionUsage('s1', 'Demo', [
      event('assistant/message', 1, {
        turn: 1, step: 1, message: { role: 'assistant', content: [] }, stream: [],
      }),
      event('tool/call', 2, { turn: 1, step: 1, callId: 'c1', name: 'grep', arguments: '{}' }),
    ], 0)
    expect(folded.tokens.outputTokens).toBe(0)
    expect(folded.toolCalls.get('grep')).toBe(1)
  })
})

describe('assembleSnapshot', () => {
  it('omits nothing that was not passed in, so archived sessions stay out', () => {
    const kept = foldSessionUsage('live', 'Live', [
      event('assistant/message', 1, {
        turn: 1, step: 1, message: { role: 'assistant', content: [] }, stream: [],
        usage: { inputTokens: 1, outputTokens: 0 },
      }),
    ], 0)
    const snapshot = assembleSnapshot(0, 1, [kept])
    expect(snapshot.sessions.map(row => row.sessionId)).toEqual(['live'])
    expect(snapshot.sessionCount).toBe(1)
  })

  it('keeps empty sessions out of recents while counting them', () => {
    const empty = foldSessionUsage('empty', 'Empty', [], 0)
    const snapshot = assembleSnapshot(0, 1, [empty])
    expect(snapshot.sessions).toEqual([])
    expect(snapshot.sessionCount).toBe(1)
  })

  it('merges two sessions on the same day and sorts models and tools', () => {
    const morning = Date.parse('2026-10-15T01:00:00.000Z')
    const later = Date.parse('2026-10-16T01:00:00.000Z')
    const first = foldSessionUsage('older', 'Older', [
      event('request/context', morning, { provider: 'deepseek-official', model: 'b-model' }),
      event('assistant/message', morning, {
        turn: 1, step: 1, message: { role: 'assistant', content: [] }, stream: [],
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 1 },
      }),
      event('tool/call', morning, { turn: 1, step: 1, callId: 'c1', name: 'grep', arguments: '{}' }),
    ], 0)
    const sameDay = foldSessionUsage('peer', 'Peer', [
      event('request/context', morning, { provider: 'deepseek-official', model: 'b-model' }),
      event('assistant/message', morning, {
        turn: 1, step: 1, message: { role: 'assistant', content: [] }, stream: [],
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
      event('tool/call', morning, { turn: 1, step: 1, callId: 'c4', name: 'read', arguments: '{}' }),
    ], 0)
    const second = foldSessionUsage('newer', 'Newer', [
      event('request/context', later, { provider: 'deepseek-official', model: 'a-model' }),
      event('assistant/message', later, {
        turn: 1, step: 1, message: { role: 'assistant', content: [] }, stream: [],
        usage: { inputTokens: 8, outputTokens: 2 },
      }),
      event('tool/call', later, { turn: 1, step: 1, callId: 'c2', name: 'bash', arguments: '{}' }),
      event('tool/call', later, { turn: 1, step: 2, callId: 'c3', name: 'grep', arguments: '{}' }),
    ], 0)
    const snapshot = assembleSnapshot(0, 2, [first, sameDay, second])
    expect(snapshot.sessions.map(row => row.sessionId)).toEqual(['newer', 'older', 'peer'])
    expect(snapshot.models.map(row => row.model)).toEqual(['a-model', 'b-model'])
    expect(snapshot.tools.map(row => row.name)).toEqual(['grep', 'bash', 'read'])
    expect(snapshot.days).toHaveLength(2)
    expect(snapshot.days[0]?.sessionCount).toBe(2)
  })
})
