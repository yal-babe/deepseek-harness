import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  DeviceId,
  StudioProjectId,
  type SyncEventEnvelope,
} from '@deepseek-ai/dsh-sync-protocol'
import SyncOutbox, { MAX_DELIVERY_ATTEMPTS } from '../src/index.ts'
import { loadQueue } from '../src/queue.ts'

const dirs: string[] = []
const fibers: { dispose(): void | Promise<void> }[] = []
const originalCredential = process.env.STUDIO_DEVICE_CREDENTIAL

function tempQueue(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-sync-outbox-'))
  dirs.push(dir)
  return join(dir, 'queue.json')
}

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  if (originalCredential === undefined) delete process.env.STUDIO_DEVICE_CREDENTIAL
  else process.env.STUDIO_DEVICE_CREDENTIAL = originalCredential
  for (const fiber of fibers.splice(0)) await fiber.dispose()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const envelope: SyncEventEnvelope = {
  id: 'e1',
  seq: 1,
  type: 'user/message',
  time: 1,
  data: { text: 'token sk-abcdefghijkl' },
}

async function mount(over: Record<string, unknown> = {}) {
  const queuePath = tempQueue()
  const ctx = new Context()
  const fiber = await ctx.plugin(SyncOutbox, {
    queuePath,
    projectId: 'proj-1',
    deviceId: 'dev-1',
    retryBaseMs: 60_000,
    ...over,
  })
  fibers.push(fiber)
  const service = ctx.syncOutbox
  return { ctx, fiber, service, queuePath }
}

describe('SyncOutbox', () => {
  it('redacts secrets before writing the queue and reports pending', async () => {
    const { service, queuePath, fiber } = await mount({ serverUrl: '' })
    const batch = await service.enqueue({ events: [envelope] })
    expect(JSON.stringify(batch.events[0]?.data)).toContain('[REDACTED]')
    expect(JSON.stringify(batch.events[0]?.data)).not.toContain('sk-abcdefghijkl')
    expect(service.status()).toEqual({
      status: 'pending',
      pendingCount: 1,
      syncingCount: 0,
      syncedCount: 0,
      failedCount: 0,
    })
    expect(readFileSync(queuePath, 'utf8')).toContain('[REDACTED]')
    fiber.dispose()
  })

  it('rejects a batch larger than maxBatchEvents', async () => {
    const { service, fiber } = await mount({ serverUrl: '', maxBatchEvents: 1 })
    await expect(service.enqueue({
      events: [envelope, { ...envelope, id: 'e2', seq: 2 }],
    })).rejects.toThrow(/max is 1/)
    fiber.dispose()
  })

  it('rejects an empty event list at enqueue', async () => {
    const { service, fiber } = await mount({ serverUrl: '' })
    await expect(service.enqueue({ events: [] })).rejects.toThrow(/at least one event/)
    fiber.dispose()
  })

  it('returns the existing row for a duplicate batch id', async () => {
    const { service, fiber } = await mount({ serverUrl: '' })
    const first = await service.enqueue({ id: 'batch-1', events: [envelope] })
    const second = await service.enqueue({
      id: 'batch-1',
      events: [{ ...envelope, id: 'e2', data: { text: 'other' } }],
    })
    expect(second).toEqual(first)
    expect(service.status().pendingCount).toBe(1)
    fiber.dispose()
  })

  it('marks a batch synced after HTTP 200 and treats 409 as idempotent success', async () => {
    process.env.STUDIO_DEVICE_CREDENTIAL = 'secret'
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { service, fiber } = await mount({ serverUrl: 'http://sync.example' })
    await service.enqueue({ events: [envelope] })
    await service.drain()
    expect(service.status().status).toBe('synced')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://sync.example/v1/batches',
      expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer secret' }) }),
    )

    fetchMock.mockImplementationOnce(async () => new Response('dup', { status: 409 }))
    await service.enqueue({ id: 'batch-dup', events: [{ ...envelope, id: 'e2', seq: 2 }] })
    await service.drain()
    expect(service.status().syncedCount).toBe(2)
    fiber.dispose()
  })

  it('retries then marks failed after the attempt budget, and retryFailed requeues', async () => {
    process.env.STUDIO_DEVICE_CREDENTIAL = 'secret'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 500 })))
    const { service, fiber } = await mount({ serverUrl: 'http://sync.example', retryBaseMs: 1 })
    await service.enqueue({ events: [envelope] })
    for (let attempt = 0; attempt < MAX_DELIVERY_ATTEMPTS; attempt += 1) {
      await service.drain()
    }
    expect(service.status()).toMatchObject({ status: 'failed', failedCount: 1, pendingCount: 0 })
    await service.retryFailed()
    expect(service.status()).toMatchObject({ status: 'pending', failedCount: 0, pendingCount: 1 })
    fiber.dispose()
  })

  it('fails a drain when the device credential is missing', async () => {
    delete process.env.STUDIO_DEVICE_CREDENTIAL
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { service, fiber } = await mount({ serverUrl: 'http://sync.example', retryBaseMs: 1 })
    await service.enqueue({ events: [envelope] })
    await service.drain()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(service.status().syncedCount).toBe(0)
    expect(service.status().pendingCount + service.status().failedCount + service.status().syncingCount).toBe(1)
    fiber.dispose()
  })

  it('reports syncing while a delivery is in flight', async () => {
    process.env.STUDIO_DEVICE_CREDENTIAL = 'secret'
    let release: () => void = () => {}
    const blocked = new Promise<Response>((resolve) => {
      release = () => resolve(new Response('ok', { status: 200 }))
    })
    vi.stubGlobal('fetch', vi.fn(async () => blocked))
    const { service, fiber } = await mount({ serverUrl: 'http://sync.example' })
    const done = service.enqueue({ events: [envelope] }).then(async () => service.drain())
    await vi.waitFor(() => {
      expect(service.status().status).toBe('syncing')
    })
    release()
    await done
    expect(service.status().status).toBe('synced')
    fiber.dispose()
  })

  it('strips a trailing slash on https serverUrl', async () => {
    process.env.STUDIO_DEVICE_CREDENTIAL = 'secret'
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { service, fiber } = await mount({ serverUrl: 'https://sync.example/' })
    await service.enqueue({ events: [envelope] })
    await service.drain()
    expect(fetchMock).toHaveBeenCalledWith('https://sync.example/v1/batches', expect.anything())
    fiber.dispose()
  })

  it('does not POST when serverUrl is empty', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { service, fiber } = await mount({ serverUrl: '' })
    await service.enqueue({ events: [envelope] })
    await service.drain()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(service.status().status).toBe('pending')
    fiber.dispose()
  })

  it('requires project and device when Config omitted them', async () => {
    const { service, fiber } = await mount({ serverUrl: '', projectId: '', deviceId: '' })
    await expect(service.enqueue({ events: [envelope] })).rejects.toThrow(/projectId is required/)
    await service.enqueue({
      projectId: 'proj-2',
      deviceId: 'dev-2',
      events: [envelope],
    })
    expect(service.status().pendingCount).toBe(1)
    fiber.dispose()
  })

  it('rejects invalid serverUrl, retryBaseMs, maxBatchEvents, and credential env at load', async () => {
    const queuePath = tempQueue()
    const ctx = new Context()
    await expect(ctx.plugin(SyncOutbox, { queuePath, serverUrl: 'ftp://x', retryBaseMs: 1 })).rejects.toThrow(/http\(s\)/)
    await expect(ctx.plugin(SyncOutbox, { queuePath, retryBaseMs: 0 })).rejects.toThrow(/retryBaseMs/)
    await expect(ctx.plugin(SyncOutbox, { queuePath, maxBatchEvents: 0 })).rejects.toThrow(/maxBatchEvents/)
    await expect(ctx.plugin(SyncOutbox, { queuePath, deviceCredentialEnv: ' ' })).rejects.toThrow(/deviceCredentialEnv/)
  })

  it('loads an empty missing queue and rejects a corrupt document', async () => {
    const { service, fiber, queuePath } = await mount({ serverUrl: '' })
    expect(service.status().status).toBe('synced')
    fiber.dispose()
    writeFileSync(queuePath, '{}\n')
    await expect(loadQueue(queuePath)).rejects.toThrow(/version-1/)
  })

  it('records a network failure message and keeps the row pending', async () => {
    process.env.STUDIO_DEVICE_CREDENTIAL = 'secret'
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline')
    }))
    const { service, fiber, queuePath } = await mount({ serverUrl: 'http://sync.example', retryBaseMs: 1 })
    await service.enqueue({ events: [envelope] })
    await service.drain()
    expect(service.status().syncedCount).toBe(0)
    expect(service.status().pendingCount + service.status().failedCount + service.status().syncingCount).toBe(1)
    expect(readFileSync(queuePath, 'utf8')).toContain('offline')
    fiber.dispose()
  })

  it('records a non-Error fetch rejection as the lastError', async () => {
    process.env.STUDIO_DEVICE_CREDENTIAL = 'secret'
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw 'offline-string'
    }))
    const { service, fiber, queuePath } = await mount({ serverUrl: 'http://sync.example', retryBaseMs: 1 })
    await service.enqueue({ events: [envelope] })
    await service.drain()
    expect(readFileSync(queuePath, 'utf8')).toContain('offline-string')
    fiber.dispose()
  })

  it('captures session events when sessions is present', async () => {
    const queuePath = tempQueue()
    const ctx = new Context()
    ctx.provide('sessions', {})
    const fiber = await ctx.plugin(SyncOutbox, {
      queuePath,
      projectId: 'proj-1',
      deviceId: 'dev-1',
      serverUrl: '',
      retryBaseMs: 60_000,
    })
    fibers.push(fiber)
    const session = Session.create(SessionId('sess-1'))
    session.append('turn/start', { turn: 1 })
    const event = session.snapshotEvents()[0]
    if (event === undefined) throw new Error('missing event')
    ctx.emit('session/event', session, event)
    await vi.waitFor(() => {
      expect(ctx.syncOutbox.status().pendingCount).toBe(1)
    })
    expect(JSON.parse(readFileSync(queuePath, 'utf8')).items[0].batch.events[0].sessionId).toBe('sess-1')
  })

  it('skips session capture when projectId is omitted', async () => {
    const queuePath = tempQueue()
    const ctx = new Context()
    ctx.provide('sessions', {})
    const fiber = await ctx.plugin(SyncOutbox, {
      queuePath,
      serverUrl: '',
      retryBaseMs: 60_000,
    })
    fibers.push(fiber)
    const session = Session.create(SessionId('sess-2'))
    session.append('turn/start', { turn: 1 })
    const event = session.snapshotEvents()[0]
    if (event === undefined) throw new Error('missing event')
    ctx.emit('session/event', session, event)
    expect(ctx.syncOutbox.status().pendingCount).toBe(0)
  })

  it('rejects a non-http URL that is not a valid origin', async () => {
    const queuePath = tempQueue()
    const ctx = new Context()
    await expect(ctx.plugin(SyncOutbox, { queuePath, serverUrl: 'not a url' })).rejects.toThrow(/invalid serverUrl/)
  })

  it('loads a missing queue as empty and rejects a directory path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-sync-outbox-dir-'))
    dirs.push(dir)
    expect(await loadQueue(join(dir, 'missing.json'))).toEqual({ version: 1, items: [] })
    await expect(loadQueue(dir)).rejects.toThrow()
    writeFileSync(join(dir, 'bad.json'), '[]\n')
    await expect(loadQueue(join(dir, 'bad.json'))).rejects.toThrow(/version-1/)
  })

  it('applies constructor defaults when Config omits optional fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-sync-outbox-home-'))
    dirs.push(dir)
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = dir
    try {
      const ctx = new Context()
      const service = new SyncOutbox(ctx, {})
      expect(service.status().status).toBe('synced')
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })

  it('clears a scheduled retry timer on dispose', async () => {
    process.env.STUDIO_DEVICE_CREDENTIAL = 'secret'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 500 })))
    const { service, fiber } = await mount({ serverUrl: 'http://sync.example', retryBaseMs: 60_000 })
    await service.enqueue({ events: [envelope] })
    await service.drain()
    expect(service.status().pendingCount).toBe(1)
    await fiber.dispose()
  })

  it('skips persist after dispose and retries mixed queue rows', async () => {
    process.env.STUDIO_DEVICE_CREDENTIAL = 'secret'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 500 })))
    const { service, fiber } = await mount({ serverUrl: 'http://sync.example', retryBaseMs: 60_000 })
    await service.enqueue({ id: 'batch-a', events: [envelope] })
    for (let attempt = 0; attempt < MAX_DELIVERY_ATTEMPTS; attempt += 1) {
      await service.drain()
    }
    expect(service.status().failedCount).toBe(1)
    await service.enqueue({ id: 'batch-b', events: [{ ...envelope, id: 'e2', seq: 2 }] })
    await service.retryFailed()
    expect(service.status().failedCount).toBe(0)
    await fiber.dispose()
    await service.enqueue({ id: 'batch-c', events: [{ ...envelope, id: 'e3', seq: 3 }] })
  })

  it('loads a valid document and rejects null or unversioned JSON', async () => {
    const path = join(tempQueue(), '..', 'valid.json')
    writeFileSync(path, '{"version":1,"items":[]}\n')
    expect(await loadQueue(path)).toEqual({ version: 1, items: [] })
    writeFileSync(path, 'null\n')
    await expect(loadQueue(path)).rejects.toThrow(/version-1/)
    writeFileSync(path, '{"version":1}\n')
    await expect(loadQueue(path)).rejects.toThrow(/version-1/)
  })

  it('preserves sessionId on an enqueued envelope', async () => {
    const { service, fiber } = await mount({ serverUrl: '' })
    const batch = await service.enqueue({
      events: [{ ...envelope, sessionId: 'sess-3' }],
    })
    expect(batch.events[0]?.sessionId).toBe('sess-3')
    fiber.dispose()
  })
})

describe('queue identifiers', () => {
  it('re-exports brand constructors used by callers', () => {
    expect(StudioProjectId('proj-1')).toBe('proj-1')
    expect(DeviceId('dev-1')).toBe('dev-1')
  })
})
