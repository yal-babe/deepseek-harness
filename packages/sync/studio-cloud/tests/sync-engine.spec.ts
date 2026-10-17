import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { PersonalSync, type SyncConnection, type SyncContribution } from '../src/sync-engine.ts'
import { CloudError } from '../src/transport.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function root() {
  const path = await mkdtemp(join(tmpdir(), 'studio-sync-'))
  roots.push(path)
  return path
}
const remoteObject = z.object({
  id: z.string(),
  kind: z.literal('preference'),
  namespace: z.string(),
  parentId: z.null(),
  version: z.number(),
  formatVersion: z.number(),
  encrypted: z.boolean(),
  payload: z.json(),
  deleted: z.boolean(),
  fileRefs: z.array(z.string()),
})
type Value = z.infer<typeof remoteObject>
function fixture() {
  let current: Value | undefined,
    seq = 0,
    lost = false,
    offline = false
  const requests: { requestId: string; changes: { id: string; baseVersion: number; payload: unknown }[] }[] = []
  const completed = new Map<string, object>()
  const connection: SyncConnection = {
    signal: new AbortController().signal,
    request: async (path, schema, options) => {
      if (offline) throw new CloudError('NETWORK')
      if (path.startsWith('/v1/sync/snapshot'))
        return schema.parse({
          snapshot: randomUUID(),
          items: current ? [current] : [],
          hasMore: false,
          after: current?.id ?? null,
          cursor: String(seq),
        })
      if (path.startsWith('/v1/sync/pull'))
        return schema.parse({ changes: current ? [{ value: current }] : [], hasMore: false, cursor: String(seq) })
      const request = z
        .object({
          requestId: z.uuid(),
          changes: z.array(z.object({ id: z.string(), baseVersion: z.number(), payload: z.json() })),
        })
        .parse(options?.body)
      requests.push(request)
      const prior = completed.get(request.requestId)
      if (prior) return schema.parse(prior)
      const change = request.changes[0]!
      if (change.baseVersion !== (current?.version ?? 0)) throw new CloudError('VERSION_CONFLICT', 409)
      current = {
        id: change.id,
        kind: 'preference',
        namespace: 'owner',
        parentId: null,
        version: ++seq,
        formatVersion: 1,
        encrypted: false,
        payload: change.payload,
        deleted: false,
        fileRefs: [],
      }
      const result = { versions: [{ id: current.id, version: seq }], cursor: String(seq) }
      completed.set(request.requestId, result)
      if (lost) {
        lost = false
        throw new CloudError('NETWORK')
      }
      return schema.parse(result)
    },
  }
  return {
    connection,
    requests,
    get current() {
      return current
    },
    set current(value: Value | undefined) {
      current = value
      seq = value?.version ?? 0
    },
    lose() {
      lost = true
    },
    offline(value: boolean) {
      offline = value
    },
  }
}
function owner(seed = 'local') {
  let text = seed
  const contribution: SyncContribution = {
    namespace: 'owner',
    version: 1,
    fields: ['text'],
    export: async () => [
      {
        id: 'preference:one',
        kind: 'preference',
        payload: { text, password: 'never-upload', environment: { secret: 'never-upload' } },
      },
    ],
    import: async (value) => {
      text = z.object({ text: z.string() }).parse(value.payload).text
    },
  }
  return {
    contribution,
    get text() {
      return text
    },
    set text(value: string) {
      text = value
    },
  }
}

describe('personal object synchronization', () => {
  it('downloads on a new device without enabling uploads, then uploads only selected categories', async () => {
    const f = fixture(), source = owner('cloud preference')
    const first = new PersonalSync(await root(), 'https://cloud.test', 'alice', new Map([['owner', source.contribution]]))
    await first.configure(['settings'], false, f.connection)
    const local = owner('local preference'), directory = await root()
    const receiver = new PersonalSync(directory, 'https://cloud.test', 'alice', new Map([['owner', local.contribution]]))
    const uploads = f.requests.length
    await receiver.download(f.connection)
    expect(local.text).toBe('cloud preference')
    expect(f.requests).toHaveLength(uploads)
    expect(await receiver.status()).toMatchObject({ enabled: false, categories: [], automatic: false })
    local.text = 'local edit'
    await receiver.configure(['projects'], true, f.connection)
    expect(f.requests).toHaveLength(uploads)
    await receiver.configure(['settings'], true, f.connection)
    expect(f.current?.payload).toEqual({ text: 'local edit' })
    const restarted = new PersonalSync(directory, 'https://cloud.test', 'alice', new Map([['owner', local.contribution]]))
    expect(await restarted.status()).toMatchObject({ categories: ['settings'], automatic: true })
  })
  it('retains immutable unknown-outcome uploads when their category is disabled', async () => {
    const f = fixture(), o = owner(), directory = await root()
    const engine = new PersonalSync(directory, 'https://cloud.test', 'alice', new Map([['owner', o.contribution]]))
    f.lose()
    await expect(engine.configure(['settings'], false, f.connection)).rejects.toMatchObject({ code: 'NETWORK' })
    const original = f.requests[0]!
    await engine.configure([], false, f.connection)
    expect(f.requests).toHaveLength(1)
    expect(await engine.status()).toMatchObject({ enabled: false, pending: 1 })
    await engine.configure(['settings'], false, f.connection)
    expect(f.requests[1]).toEqual(original)
    expect(f.current?.version).toBe(1)
  })
  it('does not upload during preview and filters fields before redacting text', async () => {
    const f = fixture(),
      o = owner('api_key=sk-sensitive-value'),
      engine = new PersonalSync(await root(), 'https://cloud.test', 'alice', new Map([['owner', o.contribution]]))
    const rows = await engine.preview(f.connection)
    expect(f.requests).toHaveLength(0)
    expect(rows[0]?.local).not.toContain('never-upload')
    expect(rows[0]?.local).not.toContain('sk-sensitive-value')
    await engine.select([{ id: 'preference:one', source: 'local', version: 0 }], f.connection)
    expect(f.current?.payload).toEqual({ text: '[REDACTED]' })
  })
  it('retries an unknown upload outcome with the exact durable request ID after restart', async () => {
    const f = fixture(),
      o = owner(),
      directory = await root(),
      owners = new Map([['owner', o.contribution]])
    const engine = new PersonalSync(directory, 'https://cloud.test', 'alice', owners)
    await engine.preview(f.connection)
    f.lose()
    await expect(
      engine.select([{ id: 'preference:one', source: 'local', version: 0 }], f.connection),
    ).rejects.toMatchObject({ code: 'NETWORK' })
    const restarted = new PersonalSync(directory, 'https://cloud.test', 'alice', owners)
    await restarted.synchronize(f.connection)
    expect(f.requests).toHaveLength(2)
    expect(f.requests[0]?.requestId).toEqual(f.requests[1]?.requestId)
    expect(f.current?.version).toBe(1)
    expect(await restarted.status()).toEqual({ enabled: true, pending: 0, selectedCount: 1, categories: [], automatic: false })
  })
  it('keeps both sides on conflict and resolves only after explicit cloud selection', async () => {
    const f = fixture(),
      o = owner(),
      engine = new PersonalSync(await root(), 'https://cloud.test', 'alice', new Map([['owner', o.contribution]]))
    await engine.preview(f.connection)
    await engine.select([{ id: 'preference:one', source: 'local', version: 0 }], f.connection)
    o.text = 'offline edit'
    f.current = { ...f.current!, version: 2, payload: { text: 'other device' } }
    await expect(engine.synchronize(f.connection)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    expect(o.text).toBe('offline edit')
    expect(f.current.payload).toEqual({ text: 'other device' })
    const rows = await engine.preview(f.connection)
    expect(rows[0]).toMatchObject({ conflict: true, version: 2 })
    await engine.select([{ id: 'preference:one', source: 'cloud', version: 2 }], f.connection)
    expect(o.text).toBe('other device')
  })
  it('isolates accounts, retains offline state and pauses without deleting data', async () => {
    const f = fixture(),
      o = owner(),
      directory = await root(),
      owners = new Map([['owner', o.contribution]])
    const alice = new PersonalSync(directory, 'https://cloud.test', 'alice', owners)
    await alice.preview(f.connection)
    await alice.select([{ id: 'preference:one', source: 'local', version: 0 }], f.connection)
    const bob = new PersonalSync(directory, 'https://cloud.test', 'bob', owners)
    expect(await bob.status()).toEqual({ enabled: false, pending: 0, selectedCount: 0, categories: [], automatic: false })
    await alice.pause(true)
    o.text = 'paused edit'
    await alice.synchronize(f.connection)
    expect(f.current?.payload).toEqual({ text: 'local' })
    await alice.pause(false)
    f.offline(true)
    await expect(alice.synchronize(f.connection)).rejects.toMatchObject({ code: 'NETWORK' })
    f.offline(false)
    await alice.synchronize(f.connection)
    expect(f.current?.payload).toEqual({ text: 'paused edit' })
    const paths = await readdir(directory)
    expect(paths).toHaveLength(1)
    expect(await readFile(join(directory, paths[0]!, 'state.json'), 'utf8')).not.toContain('never-upload')
  })
  it('refuses unknown payload versions without invoking the importer', async () => {
    const f = fixture(),
      o = owner(),
      engine = new PersonalSync(await root(), 'https://cloud.test', 'alice', new Map([['owner', o.contribution]]))
    f.current = {
      id: 'preference:one',
      kind: 'preference',
      namespace: 'owner',
      parentId: null,
      version: 1,
      formatVersion: 2,
      encrypted: false,
      payload: { text: 'new format' },
      deleted: false,
      fileRefs: [],
    }
    expect((await engine.preview(f.connection))[0]?.supported).toBe(false)
    await expect(
      engine.select([{ id: 'preference:one', source: 'cloud', version: 1 }], f.connection),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_PAYLOAD' })
    expect(o.text).toBe('local')
  })
})
