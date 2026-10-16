import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import UsageStats from '../src/index.ts'

const seq = (value: number) => SessionSeq(value)

describe('UsageStats.snapshot', () => {
  it('excludes archived sessions', async () => {
    const live = SessionId('live')
    const archived = SessionId('archived')
    const events: SessionEvent[] = [{
      type: 'assistant/message',
      seq: seq(1),
      time: 1,
      surfaceOp: 'append',
      data: {
        turn: 1, step: 1, message: { role: 'assistant', content: [] }, stream: [],
        usage: { inputTokens: 3, outputTokens: 2 },
      },
    } as unknown as SessionEvent]
    const ctx = new Context()
    ctx.provide('sessionQuery', {
      listSessions: vi.fn(async () => [
        { header: { id: live }, live: true, persisted: true },
        { header: { id: archived }, live: false, persisted: true },
      ]),
      readSession: vi.fn(async (id: typeof live) => ({ session: { id }, inheritedEventCount: 0, events })),
      readTitle: vi.fn(async () => ({ title: 'Kept' })),
    })
    ctx.provide('workspaceRegistry', { archivedSessionIds: [archived] })
    const stats = new UsageStats(ctx)
    const snapshot = await stats.snapshot(0)
    expect(snapshot.sessions.map(row => row.sessionId)).toEqual(['live'])
    expect(snapshot.totals.uncachedInputTokens).toBe(3)
  })

  it('skips unreadable logs and uses the session id when the title is missing', async () => {
    const readable = SessionId('readable')
    const broken = SessionId('broken')
    const ctx = new Context()
    ctx.provide('sessionQuery', {
      listSessions: vi.fn(async () => [
        { header: { id: readable }, live: true, persisted: true },
        { header: { id: broken }, live: true, persisted: true },
      ]),
      readSession: vi.fn(async (id: typeof readable) => {
        if (id === broken) throw new Error('gone')
        return {
          session: { id },
          inheritedEventCount: 0,
          events: [{
            type: 'assistant/message',
            seq: seq(1),
            time: 1,
            surfaceOp: 'append',
            data: {
              turn: 1, step: 1, message: { role: 'assistant', content: [] }, stream: [],
              usage: { inputTokens: 1, outputTokens: 0 },
            },
          } as unknown as SessionEvent],
        }
      }),
      readTitle: vi.fn(async () => undefined),
    })
    const snapshot = await new UsageStats(ctx).snapshot(Number.NaN)
    expect(snapshot.timezoneOffsetSeconds).toBe(0)
    expect(snapshot.sessions.map(row => row.sessionId)).toEqual(['readable'])
    expect(snapshot.sessions[0]?.title).toBe('readable')
  })

  it('uses the stored title when present', async () => {
    const live = SessionId('live')
    const ctx = new Context()
    ctx.provide('sessionQuery', {
      listSessions: vi.fn(async () => [{ header: { id: live }, live: true, persisted: true }]),
      readSession: vi.fn(async () => ({
        session: { id: live },
        inheritedEventCount: 0,
        events: [{
          type: 'assistant/message',
          seq: seq(1),
          time: 1,
          surfaceOp: 'append',
          data: {
            turn: 1, step: 1, message: { role: 'assistant', content: [] }, stream: [],
            usage: { inputTokens: 1, outputTokens: 0 },
          },
        } as unknown as SessionEvent],
      })),
      readTitle: vi.fn(async () => { throw new Error('title store down') }),
    })
    const snapshot = await new UsageStats(ctx).snapshot(0)
    expect(snapshot.sessions[0]?.title).toBe('live')
  })
})
