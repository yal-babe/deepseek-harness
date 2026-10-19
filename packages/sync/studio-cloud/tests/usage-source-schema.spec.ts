import { describe, expect, it } from 'vitest'
import { cloudSessionSchema } from '../src/cloud-sessions.ts'

const legacy = {
  format: 'dsh-session-1', sessionFormatVersion: 1, sourceSessionId: 'child', parentSourceSessionId: 'parent',
  inheritedEventCount: 3, createdAt: 1, throughSeq: 5, title: 'Selected conversation',
  chunks: [{ id: '00000000-0000-4000-8000-000000000001', sha256: 'a'.repeat(64), bytes: 1 }], attachments: [],
}
const current = {
  ...legacy, format: 'dsh-session-2',
  sourceRanges: [{ end: 3, sessionId: 'parent' }, { end: 6, sessionId: 'child' }],
}

describe('versioned cloud usage source ranges', () => {
  it('reads unchanged legacy payloads and requires explicit ranges for version two', () => {
    expect(cloudSessionSchema.parse(legacy)).toEqual(legacy)
    expect(cloudSessionSchema.parse(current)).toEqual(current)
    expect(cloudSessionSchema.safeParse({ ...legacy, format: 'dsh-session-2' }).success).toBe(false)
    expect(cloudSessionSchema.safeParse({ ...current, format: 'dsh-session-1' }).success).toBe(false)
    expect(cloudSessionSchema.safeParse({ ...current, format: 'dsh-session-3' }).success).toBe(false)
  })

  it.each([
    [],
    [{ end: 3, sessionId: 'parent' }],
    [{ end: 3, sessionId: 'parent' }, { end: 3, sessionId: 'child' }, { end: 6, sessionId: 'child' }],
    [{ end: 7, sessionId: 'child' }],
    [{ end: 0, sessionId: 'parent' }, { end: 6, sessionId: 'child' }],
    [{ end: 6, sessionId: 'parent' }],
    [{ end: 6, sessionId: null }],
    [{ end: 6, sessionId: 'child', devicePath: '/private' }],
  ])('rejects malformed or misattributed source ranges: %j', (...ranges) => {
    expect(cloudSessionSchema.safeParse({ ...current, sourceRanges: ranges }).success).toBe(false)
  })

  it('preserves unavailable ancestry only inside the inherited prefix', () => {
    const partial = { ...current, sourceRanges: [{ end: 3, sessionId: null }, { end: 6, sessionId: 'child' }] }
    expect(cloudSessionSchema.parse(partial)).toEqual(partial)
    expect(cloudSessionSchema.safeParse({ ...current, inheritedEventCount: 7 }).success).toBe(false)
  })
})
