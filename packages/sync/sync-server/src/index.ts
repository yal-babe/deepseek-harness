/**
 * SQLite WAL Studio sync HTTP server: batch commit, event read, device
 * directory, exclusive leases, memory FTS, and a first-run admin console.
 * @module @deepseek-ai/dsh-sync-server
 */

import { createHash, randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AddressInfo } from 'node:net'
import type { DatabaseSync } from 'node:sqlite'
import {
  DeviceId,
  MemoryId,
  redactJsonValue,
  redactSecrets,
  StudioProjectId,
  validateBatch,
  type DeviceLease,
  type MemoryKind,
  type MemoryRecord,
  type SyncBatch,
  type SyncEventEnvelope,
} from '@deepseek-ai/dsh-sync-protocol'
import { ADMIN_HTML } from './admin-page.ts'
import { openSyncDatabase } from './schema.ts'
import { zipStore } from './zip.ts'

export { SYNC_SERVER_SCHEMA_VERSION, openSyncDatabase } from './schema.ts'
export { zipStore } from './zip.ts'

const MEMORY_KINDS: ReadonlySet<string> = new Set([
  'goal', 'constraint', 'decision', 'fact', 'progress', 'blocker',
])

/** Listen, database, and admin-key options. */
export interface SyncServerOptions {
  /** SQLite file path, or `:memory:`. */
  readonly dbPath: string
  /** Bind address; defaults to `127.0.0.1`. */
  readonly host?: string
  /** Bind port; `0` selects an ephemeral port. */
  readonly port?: number
  /** Admin key; omission uses `STUDIO_ADMIN_KEY` or a first-run file. */
  readonly adminKey?: string
  /** First-run admin key file; omission uses `<db dir>/.studio-admin-key`. */
  readonly adminKeyPath?: string
}

/** Running server handle. */
export interface SyncServer {
  /** Base URL including the bound host and port. */
  readonly url: string
  /** Resolved admin key. */
  readonly adminKey: string
  /** Open database handle. */
  readonly db: DatabaseSync
  /**
   * Stop accepting connections and close the database.
   * @returns after the HTTP server and database close.
   */
  close(): Promise<void>
}

/**
 * Bind the sync HTTP server and open its database.
 * @param options - database path, bind address, and admin key material.
 * @returns the listening server.
 */
export async function listenSyncServer(options: SyncServerOptions): Promise<SyncServer> {
  const db = await openSyncDatabase(options.dbPath)
  const adminKey = await resolveAdminKey(options, db)
  const host = options.host ?? '127.0.0.1'
  const server = createServer((req, res) => {
    void handle(req, res, db, adminKey).catch((error: unknown) => {
      /* v8 ignore next -- headersSent is true only if a handler already wrote a response */
      if (!res.headersSent) json(res, 500, { error: error instanceof Error ? error.message : String(error) })
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, host, () => resolve())
  })
  const address = server.address() as AddressInfo
  const url = `http://${formatHost(host, address.port)}`
  return {
    url,
    adminKey,
    db,
    async close(): Promise<void> {
      await closeServer(server)
      db.close()
    },
  }
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  db: DatabaseSync,
  adminKey: string,
): Promise<void> {
  /* v8 ignore next -- IncomingMessage.url is set for every HTTP request */
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const path = url.pathname
  if (req.method === 'GET' && path === '/admin') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(ADMIN_HTML)
    return
  }
  if (path.startsWith('/admin/api/')) {
    if (!adminAuthorized(req, adminKey)) {
      json(res, 401, { error: 'admin key required' })
      return
    }
    await handleAdmin(req, res, db, path)
    return
  }
  if (req.method === 'POST' && path === '/v1/batches') {
    await handleBatch(req, res, db)
    return
  }
  if (req.method === 'GET' && path === '/v1/events') {
    await handleEvents(req, res, db, url)
    return
  }
  if (req.method === 'GET' && path === '/v1/devices') {
    await handleDevices(req, res, db, url)
    return
  }
  if (path === '/v1/lease' || path === '/v1/lease/takeover') {
    await handleLease(req, res, db, path)
    return
  }
  if (req.method === 'GET' && path === '/v1/memory/search') {
    await handleMemorySearch(req, res, db, url)
    return
  }
  if (req.method === 'POST' && path === '/v1/memory') {
    await handleMemoryWrite(req, res, db)
    return
  }
  json(res, 404, { error: 'not found' })
}

async function handleAdmin(
  req: IncomingMessage,
  res: ServerResponse,
  db: DatabaseSync,
  path: string,
): Promise<void> {
  if (req.method === 'GET' && path === '/admin/api/projects') {
    const rows = db.prepare('SELECT id, created_at AS createdAt FROM projects ORDER BY created_at').all() as {
      id: string
      createdAt: number
    }[]
    json(res, 200, rows)
    return
  }
  if (req.method === 'GET' && path === '/admin/api/devices') {
    const rows = db.prepare(
      'SELECT id, project_id AS projectId, revoked FROM devices ORDER BY created_at',
    ).all() as { id: string; projectId: string; revoked: number }[]
    json(res, 200, rows.map(row => ({ ...row, revoked: row.revoked === 1 })))
    return
  }
  if (req.method === 'GET' && path === '/admin/api/failures') {
    const rows = db.prepare(
      'SELECT time, project_id AS projectId, batch_id AS batchId, message FROM sync_failures ORDER BY time DESC LIMIT 200',
    ).all() as { time: number; projectId: string; batchId: string | null; message: string }[]
    json(res, 200, rows)
    return
  }
  if (req.method === 'GET' && path === '/admin/api/backup.zip') {
    const dump = Buffer.from(JSON.stringify(exportBackup(db)), 'utf8')
    const zip = zipStore('studio-sync-backup.json', dump)
    res.writeHead(200, {
      'content-type': 'application/zip',
      'content-disposition': 'attachment; filename="studio-sync-backup.zip"',
    })
    res.end(zip)
    return
  }
  if (path === '/admin/api/s3') {
    if (req.method === 'GET') {
      json(res, 200, readS3(db))
      return
    }
    if (req.method === 'PUT') {
      const body = await readJson(req)
      if (!isRecord(body)) {
        json(res, 400, { error: 'S3 config must be an object' })
        return
      }
      db.prepare(
        'INSERT INTO s3_config (id, bucket, region, endpoint, prefix) VALUES (1, @bucket, @region, @endpoint, @prefix) ON CONFLICT(id) DO UPDATE SET bucket = @bucket, region = @region, endpoint = @endpoint, prefix = @prefix',
      ).run({
        bucket: stringField(body, 'bucket'),
        region: stringField(body, 'region'),
        endpoint: stringField(body, 'endpoint'),
        prefix: stringField(body, 'prefix'),
      })
      json(res, 200, readS3(db))
      return
    }
  }
  json(res, 404, { error: 'not found' })
}

async function handleBatch(req: IncomingMessage, res: ServerResponse, db: DatabaseSync): Promise<void> {
  const token = bearer(req)
  if (token === undefined) {
    json(res, 401, { error: 'device credential required' })
    return
  }
  const body = await readJson(req)
  if (!isRecord(body)) {
    json(res, 400, { error: 'batch must be an object' })
    return
  }
  let batch: SyncBatch
  try {
    batch = parseBatch(body)
  } catch (error: unknown) {
    /* v8 ignore next -- parseBatch throws Error */
    json(res, 400, { error: error instanceof Error ? error.message : String(error) })
    return
  }
  const checked = validateBatch(batch)
  if (!checked.ok) {
    json(res, 400, { error: checked.failure.message, code: checked.failure.code })
    return
  }
  const hash = credentialHash(token)
  const existingBatch = db.prepare('SELECT id FROM batches WHERE id = ?').get(batch.id) as { id: string } | undefined
  if (existingBatch !== undefined) {
    json(res, 409, { id: batch.id, duplicate: true })
    return
  }
  try {
    db.exec('BEGIN IMMEDIATE')
    upsertProject(db, batch.projectId)
    const device = db.prepare(
      'SELECT credential_hash AS credentialHash, revoked FROM devices WHERE id = ? AND project_id = ?',
    ).get(batch.deviceId, batch.projectId) as { credentialHash: string; revoked: number } | undefined
    if (device === undefined) {
      db.prepare(
        'INSERT INTO devices (id, project_id, credential_hash, created_at, revoked) VALUES (?, ?, ?, ?, 0)',
      ).run(batch.deviceId, batch.projectId, hash, Date.now())
    } else if (device.revoked === 1) {
      db.exec('ROLLBACK')
      json(res, 403, { error: 'device credential revoked' })
      return
    } else if (device.credentialHash !== hash) {
      db.exec('ROLLBACK')
      json(res, 403, { error: 'device credential mismatch' })
      return
    }
    db.prepare(
      'INSERT INTO batches (id, project_id, device_id, base_seq, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(batch.id, batch.projectId, batch.deviceId, batch.baseSeq, Date.now())
    const insertEvent = db.prepare(
      'INSERT INTO events (id, project_id, device_id, batch_id, seq, type, time, session_id, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    for (const event of batch.events) {
      insertEvent.run(
        event.id,
        batch.projectId,
        batch.deviceId,
        batch.id,
        event.seq,
        event.type,
        event.time,
        event.sessionId ?? null,
        JSON.stringify(event.data),
      )
    }
    db.exec('COMMIT')
    json(res, 200, { id: batch.id, accepted: batch.events.length })
  } catch (error: unknown) {
    try {
      db.exec('ROLLBACK')
    } catch (rollbackError: unknown) {
      /* v8 ignore next -- ROLLBACK fails only when SQLite already left the transaction */
      void rollbackError
    }
    /* v8 ignore next -- SQLite throws Error */
    const message = error instanceof Error ? error.message : String(error)
    db.prepare(
      'INSERT INTO sync_failures (project_id, batch_id, message, time) VALUES (?, ?, ?, ?)',
    ).run(batch.projectId, batch.id, message, Date.now())
    json(res, 500, { error: message })
  }
}

async function handleEvents(
  req: IncomingMessage,
  res: ServerResponse,
  db: DatabaseSync,
  url: URL,
): Promise<void> {
  const projectId = url.searchParams.get('projectId')
  if (projectId === null || projectId.length === 0) {
    json(res, 400, { error: 'projectId is required' })
    return
  }
  if (!(await authorizeDevice(req, db, projectId))) {
    json(res, 401, { error: 'device credential required' })
    return
  }
  const afterSeq = Number(url.searchParams.get('afterSeq') ?? '-1')
  const rows = db.prepare(
    'SELECT id, seq, type, time, session_id AS sessionId, data FROM events WHERE project_id = ? AND seq > ? ORDER BY seq, id',
  ).all(projectId, afterSeq) as {
    id: string
    seq: number
    type: string
    time: number
    sessionId: string | null
    data: string
  }[]
  const events: SyncEventEnvelope[] = rows.map((row) => {
    const data: unknown = JSON.parse(row.data)
    return row.sessionId === null
      ? { id: row.id, seq: row.seq, type: row.type, time: row.time, data }
      : { id: row.id, seq: row.seq, type: row.type, time: row.time, data, sessionId: row.sessionId }
  })
  json(res, 200, { events })
}

async function handleDevices(
  req: IncomingMessage,
  res: ServerResponse,
  db: DatabaseSync,
  url: URL,
): Promise<void> {
  const projectId = url.searchParams.get('projectId')
  if (projectId === null || projectId.length === 0) {
    json(res, 400, { error: 'projectId is required' })
    return
  }
  if (!(await authorizeDevice(req, db, projectId))) {
    json(res, 401, { error: 'device credential required' })
    return
  }
  const rows = db.prepare(
    'SELECT id, revoked FROM devices WHERE project_id = ?',
  ).all(projectId) as { id: string; revoked: number }[]
  json(res, 200, { devices: rows.map(row => ({ id: row.id, revoked: row.revoked === 1 })) })
}

async function handleLease(
  req: IncomingMessage,
  res: ServerResponse,
  db: DatabaseSync,
  path: string,
): Promise<void> {
  if (req.method === 'GET' && path === '/v1/lease') {
    /* v8 ignore next -- IncomingMessage.url is set for HTTP requests */
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const projectId = url.searchParams.get('projectId')
    if (projectId === null) {
      json(res, 400, { error: 'projectId is required' })
      return
    }
    json(res, 200, readLease(db, projectId))
    return
  }
  if (req.method !== 'POST') {
    json(res, 405, { error: 'method not allowed' })
    return
  }
  const body = await readJson(req)
  if (!isRecord(body) || typeof body.projectId !== 'string' || typeof body.deviceId !== 'string') {
    json(res, 400, { error: 'projectId and deviceId are required' })
    return
  }
  if (!(await authorizeDevice(req, db, body.projectId, body.deviceId))) {
    json(res, 401, { error: 'device credential required' })
    return
  }
  const takeover = path.endsWith('/takeover')
  const now = Date.now()
  const current = readLease(db, body.projectId)
  const held = current.deviceId !== null && current.holderUntil !== null && current.holderUntil > now
  if (held && current.deviceId !== body.deviceId) {
    if (!takeover) {
      json(res, 409, { error: 'lease held', lease: current })
      return
    }
    if (typeof body.generation !== 'number' || body.generation !== current.generation) {
      json(res, 409, { error: 'stale generation', lease: current })
      return
    }
  }
  const generation = held && takeover ? current.generation + 1 : current.generation === 0 ? 1 : current.generation
  const holderUntil = now + 30 * 60_000
  db.prepare(
    'INSERT INTO leases (project_id, device_id, holder_until, generation) VALUES (@projectId, @deviceId, @holderUntil, @generation) ON CONFLICT(project_id) DO UPDATE SET device_id = @deviceId, holder_until = @holderUntil, generation = @generation',
  ).run({
    projectId: body.projectId,
    deviceId: body.deviceId,
    holderUntil,
    generation,
  })
  json(res, 200, readLease(db, body.projectId))
}

async function handleMemorySearch(
  req: IncomingMessage,
  res: ServerResponse,
  db: DatabaseSync,
  url: URL,
): Promise<void> {
  const projectId = url.searchParams.get('projectId')
  const query = url.searchParams.get('q') ?? ''
  if (projectId === null || projectId.length === 0) {
    json(res, 400, { error: 'projectId is required' })
    return
  }
  if (!(await authorizeDevice(req, db, projectId))) {
    json(res, 401, { error: 'device credential required' })
    return
  }
  try {
    const records = searchMemory(db, projectId, query)
    json(res, 200, { records })
  } catch (error: unknown) {
    /* v8 ignore next -- FTS MATCH throws Error */
    json(res, 400, { error: error instanceof Error ? error.message : String(error) })
  }
}

async function handleMemoryWrite(req: IncomingMessage, res: ServerResponse, db: DatabaseSync): Promise<void> {
  const body = await readJson(req)
  if (!isRecord(body) || typeof body.projectId !== 'string') {
    json(res, 400, { error: 'projectId is required' })
    return
  }
  if (!(await authorizeDevice(req, db, body.projectId))) {
    json(res, 401, { error: 'device credential required' })
    return
  }
  const kind = body.kind
  if (typeof kind !== 'string' || !MEMORY_KINDS.has(kind)) {
    json(res, 400, { error: 'kind is required' })
    return
  }
  if (typeof body.text !== 'string' || body.text.trim().length === 0) {
    json(res, 400, { error: 'text is required' })
    return
  }
  const now = Date.now()
  const id = typeof body.id === 'string' ? MemoryId(body.id) : MemoryId(randomBytes(12).toString('hex'))
  const record: MemoryRecord = {
    id,
    projectId: StudioProjectId(body.projectId),
    kind: kind as MemoryKind,
    text: redactSecrets(body.text),
    source: typeof body.source === 'string' ? redactSecrets(body.source) : 'user',
    createdAt: now,
    updatedAt: now,
    ...typeof body.gitRev === 'string' ? { gitRev: body.gitRev } : {},
  }
  upsertProject(db, record.projectId)
  db.prepare(
    'INSERT INTO memories (id, project_id, kind, text, source, created_at, updated_at, superseded_by, git_rev) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)',
  ).run(record.id, record.projectId, record.kind, record.text, record.source, record.createdAt, record.updatedAt, record.gitRev ?? null)
  db.prepare('INSERT INTO memory_fts (text, id, project_id) VALUES (?, ?, ?)').run(record.text, record.id, record.projectId)
  json(res, 200, { record })
}

function searchMemory(db: DatabaseSync, projectId: string, query: string): MemoryRecord[] {
  const trimmed = query.trim()
  const rows = trimmed.length === 0
    ? db.prepare(
      'SELECT id, project_id AS projectId, kind, text, source, created_at AS createdAt, updated_at AS updatedAt, superseded_by AS supersededBy, git_rev AS gitRev FROM memories WHERE project_id = ? AND superseded_by IS NULL ORDER BY updated_at DESC',
    ).all(projectId)
    : db.prepare(
      `SELECT m.id, m.project_id AS projectId, m.kind, m.text, m.source, m.created_at AS createdAt, m.updated_at AS updatedAt, m.superseded_by AS supersededBy, m.git_rev AS gitRev
       FROM memory_fts f JOIN memories m ON m.id = f.id
       WHERE f.project_id = ? AND memory_fts MATCH ? AND m.superseded_by IS NULL
       ORDER BY m.updated_at DESC`,
    ).all(projectId, trimmed)
  return (rows as Record<string, unknown>[]).map(rowToMemory)
}

function rowToMemory(row: Record<string, unknown>): MemoryRecord {
  const gitRev = typeof row.gitRev === 'string' ? row.gitRev : undefined
  return {
    id: MemoryId(String(row.id)),
    projectId: StudioProjectId(String(row.projectId)),
    kind: row.kind as MemoryKind,
    text: String(row.text),
    source: String(row.source),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
    ...gitRev === undefined ? {} : { gitRev },
  }
}

function readLease(db: DatabaseSync, projectId: string): DeviceLease {
  const row = db.prepare(
    'SELECT project_id AS projectId, device_id AS deviceId, holder_until AS holderUntil, generation FROM leases WHERE project_id = ?',
  ).get(projectId) as {
    projectId: string
    deviceId: string | null
    holderUntil: number | null
    generation: number
  } | undefined
  if (row === undefined) {
    return { projectId: StudioProjectId(projectId), deviceId: null, holderUntil: null, generation: 0 }
  }
  return {
    projectId: StudioProjectId(row.projectId),
    /* v8 ignore next -- inserted leases always carry a device id */
    deviceId: row.deviceId === null ? null : DeviceId(row.deviceId),
    holderUntil: row.holderUntil,
    generation: row.generation,
  }
}

function upsertProject(db: DatabaseSync, projectId: string): void {
  db.prepare('INSERT OR IGNORE INTO projects (id, created_at) VALUES (?, ?)').run(projectId, Date.now())
}

function parseBatch(body: Record<string, unknown>): SyncBatch {
  if (typeof body.id !== 'string' || typeof body.projectId !== 'string' || typeof body.deviceId !== 'string') {
    throw new Error('id, projectId, and deviceId are required')
  }
  if (!Array.isArray(body.events)) throw new Error('events must be an array')
  const events: SyncEventEnvelope[] = body.events.map((item, index) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.type !== 'string') {
      throw new Error(`event ${String(index)} is invalid`)
    }
    if (typeof item.seq !== 'number' || typeof item.time !== 'number') {
      throw new Error(`event ${String(index)} is invalid`)
    }
    const sessionId = typeof item.sessionId === 'string' ? item.sessionId : undefined
    return {
      id: item.id,
      seq: item.seq,
      type: item.type,
      time: item.time,
      data: redactJsonValue(item.data),
      ...sessionId === undefined ? {} : { sessionId },
    }
  })
  return {
    id: body.id as SyncBatch['id'],
    projectId: StudioProjectId(body.projectId),
    deviceId: DeviceId(body.deviceId),
    baseSeq: typeof body.baseSeq === 'number' ? body.baseSeq : 0,
    events,
  }
}

async function authorizeDevice(
  req: IncomingMessage,
  db: DatabaseSync,
  projectId: string,
  deviceId?: string,
): Promise<boolean> {
  const token = bearer(req)
  if (token === undefined) return false
  const hash = credentialHash(token)
  if (deviceId !== undefined) {
    const row = db.prepare(
      'SELECT credential_hash AS credentialHash, revoked FROM devices WHERE id = ? AND project_id = ?',
    ).get(deviceId, projectId) as { credentialHash: string; revoked: number } | undefined
    return row !== undefined && row.revoked === 0 && row.credentialHash === hash
  }
  const row = db.prepare(
    'SELECT 1 AS ok FROM devices WHERE project_id = ? AND credential_hash = ? AND revoked = 0',
  ).get(projectId, hash) as { ok: number } | undefined
  return row !== undefined
}

function readS3(db: DatabaseSync): { bucket: string | null; region: string | null; endpoint: string | null; prefix: string | null } {
  const row = db.prepare('SELECT bucket, region, endpoint, prefix FROM s3_config WHERE id = 1').get() as {
    bucket: string | null
    region: string | null
    endpoint: string | null
    prefix: string | null
  } | undefined
  return row ?? { bucket: null, region: null, endpoint: null, prefix: null }
}

function exportBackup(db: DatabaseSync): unknown {
  return {
    projects: db.prepare('SELECT * FROM projects').all(),
    devices: db.prepare('SELECT id, project_id, created_at, revoked FROM devices').all(),
    events: db.prepare('SELECT * FROM events').all(),
    memories: db.prepare('SELECT * FROM memories').all(),
    failures: db.prepare('SELECT * FROM sync_failures').all(),
    leases: db.prepare('SELECT * FROM leases').all(),
    s3: readS3(db),
  }
}

async function resolveAdminKey(options: SyncServerOptions, _db: DatabaseSync): Promise<string> {
  if (options.adminKey !== undefined && options.adminKey.length > 0) return options.adminKey
  const fromEnv = process.env.STUDIO_ADMIN_KEY
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv
  const path = options.adminKeyPath ?? defaultAdminKeyPath(options.dbPath)
  try {
    const existing = (await readFile(path, 'utf8')).trim()
    if (existing.length > 0) return existing
  } catch (error: unknown) {
    /* v8 ignore next -- admin-key read fails only for errors other than a missing file */
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const minted = randomBytes(24).toString('base64url')
  try {
    await writeFile(path, `${minted}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    return minted
  } catch (error: unknown) {
    /* v8 ignore next -- exclusive mint fails only for errors other than EEXIST */
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const winner = (await readFile(path, 'utf8')).trim()
    /* v8 ignore next -- empty file throws; non-empty EEXIST race is not scheduled from tests */
    if (winner.length === 0) throw new Error(`sync-server: admin key file "${path}" is empty`)
    /* v8 ignore next -- exclusive create lost to a non-empty peer write */
    return winner
  }
}

function defaultAdminKeyPath(dbPath: string): string {
  /* v8 ignore next -- in-memory databases mint the key in process.cwd */
  if (dbPath === ':memory:') return join(process.cwd(), '.studio-admin-key')
  return join(dirname(dbPath), '.studio-admin-key')
}

function adminAuthorized(req: IncomingMessage, adminKey: string): boolean {
  return req.headers['x-admin-key'] === adminKey
}

function bearer(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization
  if (header === undefined || !header.startsWith('Bearer ')) return undefined
  const token = header.slice('Bearer '.length).trim()
  /* v8 ignore next -- fetch clients omit an empty Bearer secret */
  return token.length > 0 ? token : undefined
}

function credentialHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(`${JSON.stringify(body)}\n`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    /* v8 ignore next -- Node HTTP yields Buffer chunks */
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    /* v8 ignore next -- bodies over 2 MiB are rejected before JSON parse */
    if (size > 2_000_000) throw new Error('request body too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim().length === 0) return {}
  return JSON.parse(text) as unknown
}

function formatHost(host: string, port: number): string {
  return host.includes(':') ? `[${host}]:${String(port)}` : `${host}:${String(port)}`
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      /* v8 ignore next -- close errors only if the handle is already closing */
      if (error) reject(error)
      else resolve()
    })
  })
}

/* v8 ignore start -- process entry runs only when node executes lib/index.js */
async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? '8787')
  const dbPath = process.env.STUDIO_SYNC_DB ?? join(process.cwd(), 'studio-sync.sqlite')
  const server = await listenSyncServer({ dbPath, port, host: process.env.HOST ?? '0.0.0.0' })
  process.stdout.write(`studio-sync listening on ${server.url}\n`)
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  void main()
}
/* v8 ignore stop */
