/** Loader composition over real Session projections and JSONL observations, without model APIs. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { SessionStore, SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createAssistantMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { RetryId } from '@deepseek-ai/dsh-llm-retry'
import * as Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import UsageStats from '../src/index.ts'

const before = Date.parse('2026-10-18T23:59:59.000Z')
const after = Date.parse('2026-10-19T00:00:01.000Z')

function recorded(provider: string): SessionEvent[] {
  const callId = ToolCallId('call')
  const completed = { inputTokens: 7, outputTokens: 2, totalTokens: 12 }
  const events: SessionEvent[] = [
    { type: 'turn/start', seq: SessionSeq(0), time: before, data: { turn: 1 } },
    { type: 'step/start', seq: SessionSeq(1), time: before, data: { turn: 1, step: 1 } },
    { type: 'request/header', seq: SessionSeq(2), time: before, data: { reason: 'initial', header: { config: { provider, model: 'same' } } } },
    { type: 'request/context', seq: SessionSeq(2), time: before, data: { provider, model: 'same' } },
    { type: 'assistant/attempt', seq: SessionSeq(3), time: before, data: { turn: 1, step: 1,
      stream: [{ type: 'chunk', time: before, chunk: { type: 'usage', usage: {
        inputTokens: 4, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0,
      } } }] } },
    { type: 'llm/retry', seq: SessionSeq(4), time: before, data: { retryId: RetryId('retry'), turn: 1, step: 1,
      provider, mode: 'always', policyKey: 'test', retry: 1, delayMs: 0, failure: { message: 'busy', code: 'RATE_LIMIT' } } },
    { type: 'llm/retry-started', seq: SessionSeq(5), time: before, data: { retryId: RetryId('retry'), turn: 1, step: 1, retry: 1 } },
    { type: 'assistant/message', seq: SessionSeq(6), time: after, surfaceOp: 'append', data: { turn: 1, step: 1,
      message: createAssistantMessage({ source: { provider, model: 'same' },
        content: [{ type: 'tool-call', id: callId, name: 'read', arguments: '{}' }] }), stream: [], usage: completed } },
    { type: 'tool/call', seq: SessionSeq(7), time: after, data: { turn: 1, step: 1, callId, name: 'read', arguments: '{}' } },
    { type: 'tool/result', seq: SessionSeq(8), time: after, surfaceOp: 'append', data: { turn: 1, step: 1,
      message: createToolResultMessage({ callId, content: [], isError: false }) } },
    { type: 'step/end', seq: SessionSeq(9), time: after, data: { turn: 1, step: 1 } },
    { type: 'turn/end', seq: SessionSeq(10), time: after, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  return events.map((event, index) => ({ ...event, seq: SessionSeq(index) }))
}

it('keeps chat and per-Session totals aligned while deduplicating global fork usage and calendar activity', async () => {
  onTestFinished(() => { vi.restoreAllMocks() })
  const root = await mkdtemp(join(tmpdir(), 'usage-loader-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  ctx.baseUrl = pathToFileURL(root).href + '/'
  const fixture = await readFile(new URL('./fixtures/cordis.yml', import.meta.url), 'utf8')
  await writeFile(join(root, 'cordis.yml'), fixture.replace('__SESSION_ROOT__', JSON.stringify(join(root, 'sessions'))))
  await ctx.plugin(Loader)
  Object.assign(ctx.loader.builtins, {
    include: Include,
    'usage-test-sessions': SessionStore,
    'usage-test-persistence': Jsonl,
    'usage-test-query': SessionQuery,
    'usage-test-projections': SessionProjections,
    'usage-test-meter': TokenMeter,
    'usage-test-stats': UsageStats,
  })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(root, 'cordis.yml')).href } })
  await ctx.loader.await()
  vi.spyOn(Date, 'now').mockReturnValue(after + 1)
  const parent = ctx.sessions.prepare(SessionId('parent'), { seed: recorded('first'), meta: { cwd: root } })
  const detachParent = ctx.sessions.enter(parent)
  ctx.effect(() => detachParent, 'usage test parent')
  ctx.sessions.announce(parent)
  ctx.sessions.create(SessionId('independent'), { seed: recorded('second'), meta: { cwd: root } })
  const child = ctx.sessions.fork(parent, undefined, SessionId('child'))
  child.append('turn/start', { turn: 2 })
  child.append('step/start', { turn: 2, step: 1 })
  child.append('assistant/message', { turn: 2, step: 1, stream: [],
    message: createAssistantMessage({ source: { provider: 'first', model: 'same' }, content: [] }),
    usage: { inputTokens: 3, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
  }, { surfaceOp: 'append' })
  child.append('step/end', { turn: 2, step: 1 })
  child.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
  const snapshot = await ctx.usageStats.snapshot(0)
  const chat = ctx.sessionProjections.snapshot(child).values.tokenUsage
  expect(snapshot.sessions.find(row => row.sessionId === 'child')?.tokens.totalTokens).toBe(chat?.totalTokens)
  expect(chat?.totalTokens).toBe(21)
  expect(snapshot.totals.totalTokens).toBe(38)
  expect(snapshot.toolCalls).toBe(2)
  {
    using cut = await ctx.sessionQuery.observeSession(parent.id, { projectionMode: 'none' })
    await using handle = await ctx.sessionPersistence.create(cut.header)
    await handle.append(cut.events)
    await handle.flush()
  }
  detachParent()
  {
    using cold = await ctx.sessionQuery.observeSession(parent.id, { projectionMode: 'none' })
    expect(cold.source).toBe('prepared')
  }
  expect(await ctx.usageStats.snapshot(0)).toEqual(snapshot)
  expect(await ctx.usageStats.snapshot(0)).toEqual(snapshot)
  const view = {
    totals: snapshot.totals,
    models: snapshot.models,
    days: snapshot.days,
    sessions: [...snapshot.sessions].sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
  }
  await expect(JSON.stringify(view, null, 2) + '\n').toMatchFileSnapshot(new URL('./expected/usage.json', import.meta.url).pathname)
  const statsEntry = [...ctx.loader.entries()].find(entry => entry.options.name === 'cordis:usage-test-stats')
  if (statsEntry?.fiber === undefined) throw new Error('Missing loaded usage owner')
  await statsEntry.fiber.dispose()
  expect(ctx.get('usageStats')).toBeUndefined()
})
