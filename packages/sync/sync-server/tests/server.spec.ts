import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DeviceId, StudioProjectId, SyncBatchId } from '@deepseek-ai/dsh-sync-protocol'
import { listenSyncServer, zipStore, openSyncDatabase } from '../src/index.ts'
import { SYNC_SERVER_SCHEMA_VERSION } from '../src/schema.ts'

const dirs: string[] = []
const servers: { close(): Promise<void> }[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-sync-server-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop()
    if (server !== undefined) await server.close()
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function start(over: { adminKey?: string } = {}) {
  const dir = tempDir()
  const server = await listenSyncServer({
    dbPath: join(dir, 'sync.sqlite'),
    host: '127.0.0.1',
    port: 0,
    adminKey: over.adminKey ?? 'admin-secret',
  })
  servers.push(server)
  return { server, dir }
}

const batch = {
  id: SyncBatchId('batch-1'),
  projectId: StudioProjectId('proj-1'),
  deviceId: DeviceId('dev-1'),
  baseSeq: 1,
  events: [
    { id: 'e1', seq: 1, type: 'user/message', time: 1, data: { text: 'hello sk-abcdefghijkl' } },
  ],
}

describe('listenSyncServer', () => {
  it('commits a batch, redacts secrets, and serves events and devices', async () => {
    const { server } = await start()
    const created = await fetch(`${server.url}/v1/batches`, {
      method: 'POST',
      headers: { authorization: 'Bearer device-one', 'content-type': 'application/json' },
      body: JSON.stringify(batch),
    })
    expect(created.status).toBe(200)
    const duplicate = await fetch(`${server.url}/v1/batches`, {
      method: 'POST',
      headers: { authorization: 'Bearer device-one', 'content-type': 'application/json' },
      body: JSON.stringify(batch),
    })
    expect(duplicate.status).toBe(409)

    const events = await fetch(`${server.url}/v1/events?projectId=proj-1&afterSeq=0`, {
      headers: { authorization: 'Bearer device-one' },
    })
    expect(events.status).toBe(200)
    const payload = await events.json() as { events: { data: { text: string } }[] }
    expect(payload.events).toHaveLength(1)
    expect(payload.events[0]?.data.text).toContain('[REDACTED]')

    const devices = await fetch(`${server.url}/v1/devices?projectId=proj-1`, {
      headers: { authorization: 'Bearer device-one' },
    })
    expect(await devices.json()).toEqual({ devices: [{ id: 'dev-1', revoked: false }] })
  })

  it('rejects a missing bearer, a mismatched credential, and an invalid batch', async () => {
    const { server } = await start()
    expect((await fetch(`${server.url}/v1/batches`, { method: 'POST', body: '{}' })).status).toBe(401)
    await fetch(`${server.url}/v1/batches`, {
      method: 'POST',
      headers: { authorization: 'Bearer device-one', 'content-type': 'application/json' },
      body: JSON.stringify(batch),
    })
    const mismatch = await fetch(`${server.url}/v1/batches`, {
      method: 'POST',
      headers: { authorization: 'Bearer other', 'content-type': 'application/json' },
      body: JSON.stringify({ ...batch, id: 'batch-2' }),
    })
    expect(mismatch.status).toBe(403)
    const invalid = await fetch(`${server.url}/v1/batches`, {
      method: 'POST',
      headers: { authorization: 'Bearer device-one', 'content-type': 'application/json' },
      body: JSON.stringify({ ...batch, id: 'batch-3', events: [] }),
    })
    expect(invalid.status).toBe(400)
  })

  it('takes a lease and requires generation for takeover', async () => {
    const { server } = await start()
    await fetch(`${server.url}/v1/batches`, {
      method: 'POST',
      headers: { authorization: 'Bearer device-one', 'content-type': 'application/json' },
      body: JSON.stringify(batch),
    })
    const taken = await fetch(`${server.url}/v1/lease`, {
      method: 'POST',
      headers: { authorization: 'Bearer device-one', 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-1', deviceId: 'dev-1' }),
    })
    expect(taken.status).toBe(200)
    const second = await fetch(`${server.url}/v1/batches`, {
      method: 'POST',
      headers: { authorization: 'Bearer device-two', 'content-type': 'application/json' },
      body: JSON.stringify({
        ...batch,
        id: 'batch-2',
        deviceId: 'dev-2',
        events: [{ id: 'e2', seq: 1, type: 'user/message', time: 2, data: { text: 'hi' } }],
      }),
    })
    expect(second.status).toBe(200)
    const blocked = await fetch(`${server.url}/v1/lease`, {
      method: 'POST',
      headers: { authorization: 'Bearer device-two', 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-1', deviceId: 'dev-2' }),
    })
    expect(blocked.status).toBe(409)
    const stale = await fetch(`${server.url}/v1/lease/takeover`, {
      method: 'POST',
      headers: { authorization: 'Bearer device-two', 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-1', deviceId: 'dev-2', generation: 0 }),
    })
    expect(stale.status).toBe(409)
    const takeover = await fetch(`${server.url}/v1/lease/takeover`, {
      method: 'POST',
      headers: { authorization: 'Bearer device-two', 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-1', deviceId: 'dev-2', generation: 1 }),
    })
    expect(takeover.status).toBe(200)
    const lease = await takeover.json() as { deviceId: string; generation: number }
    expect(lease.deviceId).toBe('dev-2')
    expect(lease.generation).toBe(2)
  })

  it('stores and searches project memory through FTS', async () => {
    const { server } = await start()
    await fetch(`${server.url}/v1/batches`, {
      method: 'POST',
      headers: { authorization: 'Bearer device-one', 'content-type': 'application/json' },
      body: JSON.stringify(batch),
    })
    const created = await fetch(`${server.url}/v1/memory`, {
      method: 'POST',
      headers: { authorization: 'Bearer device-one', 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-1',
        kind: 'decision',
        text: 'Prefer WAL for the sync database',
        source: 'lead',
      }),
    })
    expect(created.status).toBe(200)
    const hit = await fetch(`${server.url}/v1/memory/search?projectId=proj-1&q=WAL`, {
      headers: { authorization: 'Bearer device-one' },
    })
    const found = await hit.json() as { records: { text: string }[] }
    expect(found.records[0]?.text).toContain('WAL')
    const all = await fetch(`${server.url}/v1/memory/search?projectId=proj-1`, {
      headers: { authorization: 'Bearer device-one' },
    })
    expect(((await all.json()) as { records: unknown[] }).records).toHaveLength(1)
  })

  it('serves the admin console, lists records, saves S3 config, and downloads a backup zip', async () => {
    const { server } = await start()
    await fetch(`${server.url}/v1/batches`, {
      method: 'POST',
      headers: { authorization: 'Bearer device-one', 'content-type': 'application/json' },
      body: JSON.stringify(batch),
    })
    const page = await fetch(`${server.url}/admin`)
    expect(await page.text()).toContain('Studio Sync Admin')
    expect((await fetch(`${server.url}/admin/api/projects`)).status).toBe(401)
    const headers = { 'x-admin-key': 'admin-secret' }
    const projects = await fetch(`${server.url}/admin/api/projects`, { headers })
    expect(await projects.json()).toEqual([expect.objectContaining({ id: 'proj-1' })])
    const devices = await fetch(`${server.url}/admin/api/devices`, { headers })
    expect(((await devices.json()) as { id: string }[])[0]?.id).toBe('dev-1')
    await fetch(`${server.url}/admin/api/s3`, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ bucket: 'studio', region: 'us-east-1', endpoint: '', prefix: 'sync/' }),
    })
    const s3 = await fetch(`${server.url}/admin/api/s3`, { headers })
    expect(await s3.json()).toMatchObject({ bucket: 'studio', prefix: 'sync/' })
    const zip = await fetch(`${server.url}/admin/api/backup.zip`, { headers })
    expect(zip.headers.get('content-type')).toBe('application/zip')
    const bytes = new Uint8Array(await zip.arrayBuffer())
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
  })

  it('mints an admin key file on first run and reuses it', async () => {
    const dir = tempDir()
    const keyPath = join(dir, '.studio-admin-key')
    const first = await listenSyncServer({
      dbPath: join(dir, 'sync.sqlite'),
      host: '127.0.0.1',
      port: 0,
      adminKeyPath: keyPath,
    })
    servers.push(first)
    const stored = readFileSync(keyPath, 'utf8').trim()
    expect(first.adminKey).toBe(stored)
    await first.close()
    servers.pop()
    const second = await listenSyncServer({
      dbPath: join(dir, 'sync.sqlite'),
      host: '127.0.0.1',
      port: 0,
      adminKeyPath: keyPath,
    })
    servers.push(second)
    expect(second.adminKey).toBe(stored)
  })

  it('builds a zip that starts with a local-file header', () => {
    const zip = zipStore('a.txt', Buffer.from('hello'))
    expect(Buffer.from(zip.subarray(0, 4)).toString('hex')).toBe('504b0304')
  })

  it('exposes the schema version constant', () => {
    expect(SYNC_SERVER_SCHEMA_VERSION).toBe(1)
  })

  it('returns 404 for unknown routes', async () => {
    const { server } = await start()
    expect((await fetch(`${server.url}/nope`)).status).toBe(404)
  })

  it('covers auth, lease, memory, and admin error paths', async () => {
    const { server } = await start()
    expect((await fetch(`${server.url}/v1/events`)).status).toBe(400)
    expect((await fetch(`${server.url}/v1/devices`)).status).toBe(400)
    expect((await fetch(`${server.url}/v1/memory/search`)).status).toBe(400)
    expect((await fetch(`${server.url}/v1/lease`)).status).toBe(400)
    expect((await fetch(`${server.url}/v1/events?projectId=proj-1`)).status).toBe(401)
    expect((await fetch(`${server.url}/v1/devices?projectId=proj-1`)).status).toBe(401)
    expect((await fetch(`${server.url}/v1/memory/search?projectId=proj-1`)).status).toBe(401)
    expect((await fetch(`${server.url}/v1/lease`, { method: 'PUT' })).status).toBe(405)
    expect((await fetch(`${server.url}/v1/lease`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })).status).toBe(400)
    expect((await fetch(`${server.url}/admin/api/nope`, { headers: { 'x-admin-key': 'admin-secret' } })).status).toBe(404)
    expect(await (await fetch(`${server.url}/admin/api/s3`, {
      headers: { 'x-admin-key': 'admin-secret' },
    })).json()).toEqual({ bucket: null, region: null, endpoint: null, prefix: null })
    expect((await fetch(`${server.url}/admin/api/s3`, {
      method: 'PUT',
      headers: { 'x-admin-key': 'admin-secret', 'content-type': 'application/json' },
      body: '[]',
    })).status).toBe(400)
    expect((await fetch(`${server.url}/v1/batches`, {
      method: 'POST',
      headers: { authorization: 'Bearer ', 'content-type': 'application/json' },
      body: '{}',
    })).status).toBe(401)

    await fetch(`${server.url}/v1/batches`, {
      method: 'POST',
      headers: { authorization: 'Bearer device-one', 'content-type': 'application/json' },
      body: JSON.stringify({
        ...batch,
        events: [{ id: 'e1', seq: 1, type: 'user/message', time: 1, data: { text: 'hi' }, sessionId: 'sess-1' }],
      }),
    })
    const events = await fetch(`${server.url}/v1/events?projectId=proj-1`, {
      headers: { authorization: 'Bearer device-one' },
    })
    expect(((await events.json()) as { events: { sessionId?: string }[] }).events[0]?.sessionId).toBe('sess-1')
    expect((await fetch(`${server.url}/v1/lease?projectId=proj-1`)).status).toBe(200)

    const unauthLease = await fetch(`${server.url}/v1/lease`, {
      method: 'POST',
      headers: { authorization: 'Bearer device-one', 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-1', deviceId: 'dev-1' }),
    })
    expect(unauthLease.status).toBe(200)
    const renew = await fetch(`${server.url}/v1/lease`, {
      method: 'POST',
      headers: { authorization: 'Bearer device-one', 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-1', deviceId: 'dev-1' }),
    })
    expect(renew.status).toBe(200)

    const badBatch = await fetch(`${server.url}/v1/batches`, {
      method: 'POST',
      headers: { authorization: 'Bearer device-one', 'content-type': 'application/json' },
      body: '[]',
    })
    expect(badBatch.status).toBe(400)
    const parseFail = await fetch(`${server.url}/v1/batches`, {
      method: 'POST',
      headers: { authorization: 'Bearer device-one', 'content-type': 'application/json' },
      body: '{"id":1}',
    })
    expect(parseFail.status).toBe(400)
    const badEvent = await fetch(`${server.url}/v1/batches`, {
      method: 'POST',
      headers: { authorization: 'Bearer device-one', 'content-type': 'application/json' },
      body: JSON.stringify({ ...batch, id: 'batch-bad-event', events: [{ id: 1 }] }),
    })
    expect(badEvent.status).toBe(400)
    const badSeq = await fetch(`${server.url}/v1/batches`, {
      method: 'POST',
      headers: { authorization: 'Bearer device-one', 'content-type': 'application/json' },
      body: JSON.stringify({
        ...batch,
        id: 'batch-bad-seq',
        events: [{ id: 'e-bad', seq: 'x', type: 'a', time: 1, data: null }],
      }),
    })
    expect(badSeq.status).toBe(400)
    const invalidJson = await fetch(`${server.url}/v1/batches`, {
      method: 'POST',
      headers: { authorization: 'Bearer device-one', 'content-type': 'application/json' },
      body: '{',
    })
    expect(invalidJson.status).toBe(500)

    server.db.prepare('UPDATE devices SET revoked = 1 WHERE id = ?').run('dev-1')
    const revoked = await fetch(`${server.url}/v1/batches`, {
      method: 'POST',
      headers: { authorization: 'Bearer device-one', 'content-type': 'application/json' },
      body: JSON.stringify({ ...batch, id: 'batch-revoked' }),
    })
    expect(revoked.status).toBe(403)
    server.db.prepare('UPDATE devices SET revoked = 0 WHERE id = ?').run('dev-1')

    const dupEvent = await fetch(`${server.url}/v1/batches`, {
      method: 'POST',
      headers: { authorization: 'Bearer device-one', 'content-type': 'application/json' },
      body: JSON.stringify({
        ...batch,
        id: 'batch-dup-event',
        events: [{ id: 'e1', seq: 2, type: 'user/message', time: 3, data: { text: 'again' } }],
      }),
    })
    expect(dupEvent.status).toBe(500)
    const failures = await fetch(`${server.url}/admin/api/failures`, { headers: { 'x-admin-key': 'admin-secret' } })
    expect(((await failures.json()) as unknown[]).length).toBeGreaterThan(0)

    expect((await fetch(`${server.url}/v1/memory`, {
      method: 'POST',
      headers: { authorization: 'Bearer device-one', 'content-type': 'application/json' },
      body: '{}',
    })).status).toBe(400)
    expect((await fetch(`${server.url}/v1/memory`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-1', kind: 'fact', text: 'x' }),
    })).status).toBe(401)
    expect((await fetch(`${server.url}/v1/memory`, {
      method: 'POST',
      headers: { authorization: 'Bearer device-one', 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-1', kind: 'mystery', text: 'x' }),
    })).status).toBe(400)
    expect((await fetch(`${server.url}/v1/memory`, {
      method: 'POST',
      headers: { authorization: 'Bearer device-one', 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-1', kind: 'fact', text: '   ' }),
    })).status).toBe(400)
    expect((await fetch(`${server.url}/v1/lease`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-1', deviceId: 'dev-1' }),
    })).status).toBe(401)
    expect((await fetch(`${server.url}/admin/api/s3`, {
      method: 'POST',
      headers: { 'x-admin-key': 'admin-secret' },
    })).status).toBe(404)
    const omittedBase = await fetch(`${server.url}/v1/batches`, {
      method: 'POST',
      headers: { authorization: 'Bearer device-one', 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'batch-no-base',
        projectId: 'proj-1',
        deviceId: 'dev-1',
        events: [{ id: 'e-no-base', seq: 0, type: 'user/message', time: 4, data: {} }],
      }),
    })
    expect(omittedBase.status).toBe(200)
    const emptyBody = await fetch(`${server.url}/v1/lease`, {
      method: 'POST',
      headers: { authorization: 'Bearer device-one', 'content-type': 'application/json' },
    })
    expect(emptyBody.status).toBe(400)
    const missingEvents = await fetch(`${server.url}/v1/batches`, {
      method: 'POST',
      headers: { authorization: 'Bearer device-one', 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'batch-no-events', projectId: 'proj-1', deviceId: 'dev-1' }),
    })
    expect(missingEvents.status).toBe(400)

    const written = await fetch(`${server.url}/v1/memory`, {
      method: 'POST',
      headers: { authorization: 'Bearer device-one', 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-1',
        id: 'mem-1',
        kind: 'fact',
        text: 'named record',
        gitRev: 'def456',
      }),
    })
    expect(written.status).toBe(200)
    expect((await written.json() as { record: { gitRev?: string } }).record.gitRev).toBe('def456')
    const named = await fetch(`${server.url}/v1/memory/search?projectId=proj-1&q=named`, {
      headers: { authorization: 'Bearer device-one' },
    })
    expect(((await named.json()) as { records: { gitRev?: string }[] }).records[0]?.gitRev).toBe('def456')
    expect((await fetch(`${server.url}/v1/memory/search?projectId=proj-1&q=%22`, {
      headers: { authorization: 'Bearer device-one' },
    })).status).toBe(400)
  })

  it('binds on IPv6 and uses STUDIO_ADMIN_KEY', async () => {
    const previous = process.env.STUDIO_ADMIN_KEY
    process.env.STUDIO_ADMIN_KEY = 'env-admin'
    try {
      const dir = tempDir()
      const server = await listenSyncServer({
        dbPath: join(dir, 'sync.sqlite'),
        host: '::1',
        port: 0,
      })
      servers.push(server)
      expect(server.url).toContain('[::1]:')
      expect(server.adminKey).toBe('env-admin')
    } finally {
      if (previous === undefined) delete process.env.STUDIO_ADMIN_KEY
      else process.env.STUDIO_ADMIN_KEY = previous
    }
  })

  it('rejects an empty first-run admin key file', async () => {
    const dir = tempDir()
    const keyPath = join(dir, '.studio-admin-key')
    writeFileSync(keyPath, '\n')
    await expect(listenSyncServer({
      dbPath: join(dir, 'sync.sqlite'),
      host: '127.0.0.1',
      port: 0,
      adminKeyPath: keyPath,
    })).rejects.toThrow(/empty/)
  })

  it('rejects an incompatible database schema version', async () => {
    const dir = tempDir()
    const path = join(dir, 'sync.sqlite')
    const db = await openSyncDatabase(path)
    db.exec('PRAGMA user_version = 99')
    db.close()
    await expect(openSyncDatabase(path)).rejects.toThrow(/schema version 99/)
  })

  it('opens an in-memory database', async () => {
    const db = await openSyncDatabase(':memory:')
    db.close()
  })

  it('binds an ephemeral port when host and port are omitted', async () => {
    const dir = tempDir()
    const server = await listenSyncServer({
      dbPath: join(dir, 'sync.sqlite'),
      adminKey: 'admin-secret',
    })
    servers.push(server)
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })

  it('mints an admin key beside the database when adminKeyPath is omitted', async () => {
    const previous = process.env.STUDIO_ADMIN_KEY
    delete process.env.STUDIO_ADMIN_KEY
    try {
      const dir = tempDir()
      const server = await listenSyncServer({
        dbPath: join(dir, 'sync.sqlite'),
        host: '127.0.0.1',
        port: 0,
      })
      servers.push(server)
      expect(server.adminKey.length).toBeGreaterThan(0)
      expect(readFileSync(join(dir, '.studio-admin-key'), 'utf8').trim()).toBe(server.adminKey)
    } finally {
      if (previous === undefined) delete process.env.STUDIO_ADMIN_KEY
      else process.env.STUDIO_ADMIN_KEY = previous
    }
  })
})

describe('admin key file race', () => {
  it('adopts a concurrent winner when exclusive create loses', async () => {
    const dir = tempDir()
    const keyPath = join(dir, '.studio-admin-key')
    writeFileSync(keyPath, 'winner-key\n', { flag: 'wx' })
    const server = await listenSyncServer({
      dbPath: join(dir, 'sync.sqlite'),
      host: '127.0.0.1',
      port: 0,
      adminKeyPath: keyPath,
    })
    servers.push(server)
    expect(server.adminKey).toBe('winner-key')
  })
})
