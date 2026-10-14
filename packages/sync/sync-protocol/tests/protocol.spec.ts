import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MAX_BATCH_EVENTS,
  DeviceId,
  MemoryId,
  StudioProjectId,
  SyncBatchId,
  isSyncIdentifier,
  redactJsonValue,
  redactSecrets,
  validateBatch,
  type SyncBatch,
} from '../src/index.ts'

function batch(over: Partial<SyncBatch> = {}): SyncBatch {
  return {
    id: SyncBatchId('batch-1'),
    projectId: StudioProjectId('proj-1'),
    deviceId: DeviceId('dev-1'),
    baseSeq: 1,
    events: [
      { id: 'e1', seq: 1, type: 'user/message', time: 1, data: { text: 'hi' } },
    ],
    ...over,
  }
}

describe('identifiers', () => {
  it('brands values that match the grammar', () => {
    expect(StudioProjectId('proj_1')).toBe('proj_1')
    expect(DeviceId('dev:1')).toBe('dev:1')
    expect(SyncBatchId('batch.1')).toBe('batch.1')
    expect(MemoryId('mem-1')).toBe('mem-1')
    expect(isSyncIdentifier('a')).toBe(true)
  })

  it('rejects empty, whitespace, and oversized identifiers', () => {
    expect(() => StudioProjectId('')).toThrow(/invalid StudioProjectId/)
    expect(() => DeviceId(' bad')).toThrow(/invalid DeviceId/)
    expect(() => SyncBatchId('x'.repeat(129))).toThrow(/invalid SyncBatchId/)
    expect(isSyncIdentifier('')).toBe(false)
    expect(() => MemoryId('.mem')).toThrow(/invalid MemoryId/)
  })
})

describe('validateBatch', () => {
  it('accepts a well-formed batch at the default cap', () => {
    expect(validateBatch(batch())).toEqual({ ok: true })
    expect(DEFAULT_MAX_BATCH_EVENTS).toBe(100)
  })

  it('rejects an empty event list', () => {
    const result = validateBatch(batch({ events: [] }))
    expect(result).toEqual({ ok: false, failure: { code: 'empty', message: 'a sync batch must contain at least one event' } })
  })

  it('rejects a batch larger than the caller cap', () => {
    const events = [
      { id: 'e1', seq: 1, type: 'a', time: 1, data: null },
      { id: 'e2', seq: 2, type: 'b', time: 2, data: null },
    ]
    const result = validateBatch(batch({ events }), 1)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.failure.code).toBe('too-large')
  })

  it('rejects a non-identifier batch id without branding', () => {
    const result = validateBatch({ ...batch(), id: ' bad' as ReturnType<typeof SyncBatchId> })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.failure.code).toBe('invalid-id')
  })

  it('rejects a non-identifier project or device', () => {
    expect(validateBatch({ ...batch(), projectId: ' ' as ReturnType<typeof StudioProjectId> }).ok).toBe(false)
    expect(validateBatch({ ...batch(), deviceId: '' as ReturnType<typeof DeviceId> }).ok).toBe(false)
  })

  it('rejects a negative or non-integer baseSeq', () => {
    expect(validateBatch(batch({ baseSeq: -1 })).ok).toBe(false)
    expect(validateBatch(batch({ baseSeq: 1.5 })).ok).toBe(false)
  })

  it('rejects an envelope whose seq precedes baseSeq or decreases', () => {
    const early = validateBatch(batch({
      baseSeq: 5,
      events: [{ id: 'e1', seq: 4, type: 'a', time: 1, data: null }],
    }))
    expect(early.ok).toBe(false)
    if (early.ok) throw new Error('expected failure')
    expect(early.failure.code).toBe('invalid-seq')

    const decreasing = validateBatch(batch({
      events: [
        { id: 'e1', seq: 2, type: 'a', time: 1, data: null },
        { id: 'e2', seq: 1, type: 'b', time: 2, data: null },
      ],
    }))
    expect(decreasing.ok).toBe(false)
    if (decreasing.ok) throw new Error('expected failure')
    expect(decreasing.failure.code).toBe('nonmonotonic')
  })

  it('rejects an empty envelope id or a bad envelope seq', () => {
    expect(validateBatch(batch({
      events: [{ id: '  ', seq: 1, type: 'a', time: 1, data: null }],
    })).ok).toBe(false)
    expect(validateBatch(batch({
      events: [{ id: '', seq: 1, type: 'a', time: 1, data: null }],
    })).ok).toBe(false)
    expect(validateBatch(batch({
      events: [{ id: 'e1', seq: -1, type: 'a', time: 1, data: null }],
    })).ok).toBe(false)
    expect(validateBatch(batch({
      events: [{ id: 'e1', seq: 1.5, type: 'a', time: 1, data: null }],
    })).ok).toBe(false)
  })

  it('allows equal consecutive seq values', () => {
    expect(validateBatch(batch({
      events: [
        { id: 'e1', seq: 1, type: 'a', time: 1, data: null },
        { id: 'e2', seq: 1, type: 'b', time: 2, data: null },
      ],
    }))).toEqual({ ok: true })
  })

  it('throws when the caller cap is not a positive safe integer', () => {
    expect(() => validateBatch(batch(), 0)).toThrow(/maxEvents/)
    expect(() => validateBatch(batch(), 1.2)).toThrow(/maxEvents/)
  })
})

describe('redactSecrets', () => {
  it('replaces API keys, bearer tokens, assignment secrets, and PEM blocks', () => {
    expect(redactSecrets('token sk-abcdefghijkl')).toContain('[REDACTED]')
    expect(redactSecrets('Authorization: Bearer abc.def-ghi')).toBe('[REDACTED]')
    expect(redactSecrets('api_key=super-secret-value')).toBe('[REDACTED]')
    expect(redactSecrets('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----')).toBe('[REDACTED]')
  })

  it('leaves ordinary prose unchanged', () => {
    expect(redactSecrets('ship the migration')).toBe('ship the migration')
  })

  it('redacts nested JSON string leaves and preserves other JSON values', () => {
    expect(redactJsonValue({
      n: 1,
      ok: true,
      missing: null,
      list: ['sk-abcdefghijkl', 2],
      nested: { token: 'Bearer abcdefgh' },
    })).toEqual({
      n: 1,
      ok: true,
      missing: null,
      list: ['[REDACTED]', 2],
      nested: { token: '[REDACTED]' },
    })
  })
})
