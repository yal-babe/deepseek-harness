import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SyncMemory, { openMemoryStore, renderMemoryContext } from '../src/index.ts'

const dirs: string[] = []
const SIGNAL = new AbortController().signal

function tempStore(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-sync-memory-'))
  dirs.push(dir)
  return join(dir, 'memory.sqlite')
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function mount(over: Record<string, unknown> = {}) {
  const storePath = typeof over.storePath === 'string' ? over.storePath : tempStore()
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  const fiber = await ctx.plugin(SyncMemory, {
    projectId: 'proj-1',
    storePath,
    ...over,
  })
  return { ctx, fiber, service: ctx.syncMemory, storePath }
}

function sessionAgent(session: Session): Agent {
  return {
    id: SessionId('agent'),
    options: {},
    session,
    inbox: unsupportedInbox(),
    status: 'running',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => { throw new Error('sync-memory must append through pre-step') },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

async function fire(ctx: Context, agent: Agent): Promise<void> {
  const proposed = createUserMessage({
    content: [{ type: 'text', text: 'proposed' }],
    source: { kind: 'user' },
  })
  const decision = await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: [proposed], turn: 1, step: 1, signal: SIGNAL },
    () => Promise.resolve({ kind: 'enter' as const, messages: [proposed] }),
  )
  if (decision.kind === 'enter') {
    for (const message of decision.messages) {
      if (message === proposed) continue
      agent.session.append('user/message', message, { surfaceOp: 'append' })
    }
  }
}

describe('renderMemoryContext', () => {
  it('renders admitted records and an empty snapshot', () => {
    expect(renderMemoryContext([])).toBe('')
    expect(renderMemoryContext([{
      id: 'm1' as never,
      projectId: 'proj-1' as never,
      kind: 'fact',
      text: 'uses sqlite',
      source: 'user',
      createdAt: 1,
      updatedAt: 1,
    }])).toBe('Relevant project memory:\n- (fact) uses sqlite')
  })
})

describe('SyncMemory', () => {
  it('redacts secrets on write and retrieves them by FTS', async () => {
    const { service, fiber } = await mount()
    const record = await service.create({
      kind: 'fact',
      text: 'API token sk-abcdefghijkl is forbidden',
      source: 'user Bearer abc',
    })
    expect(record.text).toContain('[REDACTED]')
    expect(record.text).not.toContain('sk-abcdefghijkl')
    expect(record.source).toContain('[REDACTED]')
    const hits = await service.search('forbidden')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.id).toBe(record.id)
    fiber.dispose()
  })

  it('lists recent live rows for an empty query and drops deleted rows', async () => {
    const { service, fiber } = await mount()
    const first = await service.create({ kind: 'goal', text: 'ship sync' })
    await service.create({ kind: 'blocker', text: 'no admin key' })
    expect(await service.search('')).toHaveLength(2)
    await service.remove(first.id)
    const remaining = await service.search('')
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.kind).toBe('blocker')
    fiber.dispose()
  })

  it('revises a live row by writing a successor', async () => {
    const { service, fiber } = await mount()
    const original = await service.create({ kind: 'decision', text: 'use wal' })
    const successor = await service.revise(original.id, { kind: 'decision', text: 'use wal and fts' })
    const live = await service.search('fts')
    expect(live).toHaveLength(1)
    expect(live[0]?.id).toBe(successor.id)
    await expect(service.revise(original.id, { kind: 'decision', text: 'again' })).rejects.toThrow(/already superseded/)
    fiber.dispose()
  })

  it('injects matching records as a logged sync-memory snapshot', async () => {
    const { ctx, service, fiber } = await mount()
    await service.create({ kind: 'fact', text: 'the checkout uses sqlite wal' })
    const session = Session.create(SessionId('mem-1'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'how does sqlite persist?' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await fire(ctx, sessionAgent(session))
    const injected = session.snapshotEvents().filter(event =>
      event.type === 'user/message' && event.data.source.kind === 'sync-memory')
    expect(injected).toHaveLength(1)
    const event = injected[0]
    if (event?.type !== 'user/message') throw new Error('missing injection')
    expect(event.data.content[0]).toMatchObject({ type: 'text' })
    expect(event.data.content[0] && event.data.content[0].type === 'text' ? event.data.content[0].text : '')
      .toContain('the checkout uses sqlite wal')
    expect(event.data.source).toEqual({
      kind: 'sync-memory',
      form: 'snapshot',
      sections: [{
        name: 'sync-memory',
        text: 'Relevant project memory:\n- (fact) the checkout uses sqlite wal',
      }],
    })
    expect(event.surfaceOp).toBe('append')
    fiber.dispose()
  })

  it('skips injection on reject and when nothing matches the char budget', async () => {
    const { ctx, service, fiber } = await mount({ maxInjectChars: 8 })
    await service.create({ kind: 'fact', text: 'a very long memory body that cannot fit' })
    const session = Session.create(SessionId('skip'))
    const agent = sessionAgent(session)
    const proposed = createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } })
    const rejected = await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [proposed], turn: 1, step: 1, signal: SIGNAL },
      () => Promise.resolve({ kind: 'reject' as const }),
    )
    expect(rejected.kind).toBe('reject')
    await fire(ctx, agent)
    expect(session.snapshotEvents().some(event =>
      event.type === 'user/message' && event.data.source.kind === 'sync-memory')).toBe(false)
    fiber.dispose()
  })

  it('uses default injection caps when Config omits them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-sync-memory-home-'))
    dirs.push(dir)
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = dir
    try {
      const ctx = new Context()
      const service = new SyncMemory(ctx, { projectId: 'proj-defaults' })
      expect(service).toBeDefined()
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })

  it('rejects empty project ids, unknown kinds, empty text, and invalid bounds', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await expect(ctx.plugin(SyncMemory, { projectId: ' ', storePath: ':memory:' })).rejects.toThrow(/projectId/)
    await expect(ctx.plugin(SyncMemory, { projectId: 'p', storePath: ':memory:', maxInjectRecords: 0 })).rejects.toThrow(/maxInjectRecords/)
    await expect(ctx.plugin(SyncMemory, { projectId: 'p', storePath: ':memory:', maxInjectChars: 0 })).rejects.toThrow(/maxInjectChars/)
    const { service, fiber } = await mount()
    await expect(service.create({ kind: 'mystery' as never, text: 'x' })).rejects.toThrow(/unknown kind/)
    await expect(service.create({ kind: 'fact', text: '   ' })).rejects.toThrow(/text is required/)
    await expect(service.remove('missing-id' as never)).rejects.toThrow(/missing/)
    fiber.dispose()
  })

  it('falls back to recency when FTS tokens are operators', async () => {
    const { service, fiber } = await mount()
    await service.create({ kind: 'fact', text: 'plain memory' })
    expect(await service.search('NOT AND OR')).toHaveLength(1)
    fiber.dispose()
  })

  it('stores a caller id and gitRev, then injects from recency when no user message exists', async () => {
    const { ctx, service, fiber } = await mount({ storePath: ':memory:' })
    const record = await service.create({
      id: 'mem-fixed',
      kind: 'progress',
      text: 'wal is on',
      gitRev: 'abc123',
    })
    expect(record.id).toBe('mem-fixed')
    expect(record.gitRev).toBe('abc123')
    const session = Session.create(SessionId('empty-user'))
    session.append('turn/start', { turn: 1 })
    await fire(ctx, sessionAgent(session))
    expect(session.snapshotEvents().some(event =>
      event.type === 'user/message' && event.data.source.kind === 'sync-memory')).toBe(true)
    fiber.dispose()
  })

  it('skips injection when the pre-step signal is aborted', async () => {
    const { ctx, service, fiber } = await mount()
    await service.create({ kind: 'fact', text: 'should not appear' })
    const session = Session.create(SessionId('aborted'))
    const agent = sessionAgent(session)
    const proposed = createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } })
    const aborted = new AbortController()
    aborted.abort()
    const decision = await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [proposed], turn: 1, step: 1, signal: aborted.signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [proposed] }),
    )
    expect(decision.kind).toBe('enter')
    if (decision.kind === 'enter') expect(decision.messages).toHaveLength(1)
    fiber.dispose()
  })

  it('rejects search after dispose', async () => {
    const { service, fiber } = await mount()
    await fiber.dispose()
    await expect(service.search('')).rejects.toThrow(/not open/)
  })

  it('reopens an existing store file', async () => {
    const path = tempStore()
    const first = await mount({ storePath: path })
    await first.service.create({ kind: 'constraint', text: 'keep secrets out' })
    first.fiber.dispose()
    const second = await mount({ storePath: path })
    expect(await second.service.search('secrets')).toHaveLength(1)
    second.fiber.dispose()
  })

  it('rejects an incompatible on-disk schema version', async () => {
    const path = tempStore()
    const db = new DatabaseSync(path)
    db.exec('PRAGMA user_version = 99')
    db.close()
    await expect(openMemoryStore(path)).rejects.toThrow(/schema version 99/)
  })
})
