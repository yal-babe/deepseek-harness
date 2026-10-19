import { describe, expect, it } from 'vitest'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { attributeRecordedUsage, resolveUsageSources, type UsageSourceLog } from '../src/usage-sources.ts'

function message(seq: number, inputTokens = 10): SessionEvent<'assistant/message'> {
  return {
    type: 'assistant/message', seq: SessionSeq(seq), time: seq, surfaceOp: 'append',
    data: {
      turn: seq + 1, step: 1, stream: [],
      message: createAssistantMessage({ source: { provider: 'mock', model: 'same' }, content: [] }),
      usage: { inputTokens, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
    },
  }
}

function log(
  sessionId: string, events: readonly SessionEvent[], parentSessionId: string | null = null, inheritedEventCount = 0,
): UsageSourceLog {
  return { sessionId, events, parentSessionId, inheritedEventCount }
}

const seed = (seq: number): SessionEvent<'session/end-seed'> => ({
  type: 'session/end-seed', seq: SessionSeq(seq), time: seq, data: { inherited: true },
})

const total = (logs: readonly UsageSourceLog[]) => attributeRecordedUsage(logs).attempts
  .reduce((sum, record) => sum + (record.attempt.usage?.totalTokens ?? 0), 0)

describe('source-position usage attribution', () => {
  it('counts identical independent calls in separate sessions', () => {
    const events = [message(0)]
    expect(total([log('first', events), log('second', events)])).toBe(22)
  })

  it('counts parent and copied child usage once regardless of input order', () => {
    const parent = log('parent', [message(0)])
    const child = log('child', [...parent.events, seed(1), message(2, 20)], 'parent', 1)
    expect(total([parent, child])).toBe(32)
    expect(total([child, parent])).toBe(32)
    expect(total([child])).toBe(21)
    expect(attributeRecordedUsage([child]).incomplete).toBe(true)
  })

  it('resolves multiple fork generations with the ancestors present', () => {
    const parent = log('parent', [message(0)])
    const child = log('child', [...parent.events, seed(1), message(2, 20)], 'parent', 1)
    const grandchild = log('grandchild', [...child.events, seed(3), message(4, 30)], 'child', 3)
    expect(total([grandchild, child, parent])).toBe(63)
    expect(attributeRecordedUsage([grandchild, child, parent]).incomplete).toBe(false)
  })

  it('retains exact original identities when only descendants carry persisted ranges', () => {
    const events = [message(0), seed(1), message(2, 20), seed(3), message(4, 30)]
    const descendant: UsageSourceLog = {
      ...log('grandchild', events, 'child', 3),
      sourceRanges: [{ end: 1, sessionId: 'parent' }, { end: 3, sessionId: 'child' }, { end: 5, sessionId: 'grandchild' }],
    }
    expect(total([descendant])).toBe(63)
    expect(total([descendant, log('parent', [events[0]!])])).toBe(63)
  })

  it('labels unavailable legacy multi-generation ancestry instead of inventing a source', () => {
    const descendant = log('grandchild', [message(0), seed(1), message(2, 20), seed(3), message(4, 30)], 'child', 3)
    expect(attributeRecordedUsage([descendant]).incomplete).toBe(true)
    expect(total([descendant])).toBe(31)
  })

  it('does not infer a root parent from a fork prefix that ends before its seed marker', () => {
    const root = log('root', [message(0)])
    const truncated = log('grandchild', root.events, 'absent-child', 1)
    expect(total([root, truncated])).toBe(11)
    expect(attributeRecordedUsage([root, truncated]).incomplete).toBe(true)
  })

  it('selects a longer observation of one source without counting the shorter version twice', () => {
    const first = message(0)
    const second = { ...message(1, 20), data: { ...message(1, 20).data, turn: 1 } }
    const short = log('source', [first])
    const longer = log('source', [first, second])
    expect(total([short, longer])).toBe(21)
  })

  it('excludes contradictory copies of the same original settlement and marks the result partial', () => {
    const first = log('source', [message(0)])
    const contradictory = log('child', [message(0, 20), seed(1)], 'source', 1)
    const result = attributeRecordedUsage([first, contradictory])
    expect(result.incomplete).toBe(true)
    expect(result.attempts).toEqual([])
  })

  it('contains cyclic ancestry as unavailable attribution', () => {
    const first = log('first', [message(0)], 'second', 1)
    const second = log('second', [message(0)], 'first', 1)
    expect(resolveUsageSources(first, new Map([['first', first], ['second', second]])))
      .toEqual([{ end: 1, sessionId: null }])
    expect(attributeRecordedUsage([first, second]).incomplete).toBe(true)
  })
})
