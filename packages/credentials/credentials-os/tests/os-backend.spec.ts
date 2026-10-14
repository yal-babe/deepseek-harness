import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import { createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import type { CredentialKey, CredentialRecord, CredentialRef } from '@deepseek-ai/dsh-credentials'
import OsCredentialProvider, {
  DEFAULT_SERVICE,
  INDEX_FILENAME,
  MemoryOsSecretStore,
  parseCredentialsOsIndex,
  renderCredentialsOsIndex,
  resolveSpec,
} from '../src/index.ts'
import { createPlatformOsSecretStore } from '../src/os-store.ts'

type ExecFileCallback = (error: Error | string | null, stdout?: string, stderr?: string) => void

const childMocks = vi.hoisted(() => ({
  execFile: vi.fn((
    _file: string,
    _args: readonly string[],
    optionsOrCb: unknown,
    maybeCb?: ExecFileCallback,
  ) => {
    const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb
    const error = Object.assign(new Error('could not be found'), { code: 44 })
    queueMicrotask(() => cb?.(error))
  }),
}))

const osMocks = vi.hoisted(() => ({
  homedir: vi.fn(() => '/unused-os-home'),
}))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, execFile: childMocks.execFile }
})

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => osMocks.homedir() }
})

const KEY = credentialRef('DSH_CRED_OS')
const OTHER = credentialRef('DSH_CRED_OS_OTHER')
const CODEX = credentialKey('llm-pi-ai', 'openai-codex')
const BEDROCK = credentialKey('llm-pi-ai', 'amazon-bedrock')

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  vi.unstubAllEnvs()
  childMocks.execFile.mockReset()
  childMocks.execFile.mockImplementation((
    _file: string,
    _args: readonly string[],
    optionsOrCb: unknown,
    maybeCb?: ExecFileCallback,
  ) => {
    const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb
    const error = Object.assign(new Error('could not be found'), { code: 44 })
    queueMicrotask(() => cb?.(error))
  })
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-credentials-os-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function boot(
  config: ConstructorParameters<typeof OsCredentialProvider>[1],
  store: MemoryOsSecretStore = new MemoryOsSecretStore(),
): Promise<Context> {
  const ctx = new Context()
  class Injected extends OsCredentialProvider {
    constructor(c: Context, cfg: ConstructorParameters<typeof OsCredentialProvider>[1]) {
      super(c, cfg, store)
    }
  }
  const fiber = ctx.plugin(Injected, config)
  cleanups.push(async () => { await fiber.dispose() })
  await fiber
  return ctx
}

function updates(ctx: Context): CredentialRef[] {
  const seen: CredentialRef[] = []
  ctx.on('credentials/reference-updated', (ref) => { seen.push(ref) })
  return seen
}

function recordUpdates(ctx: Context): CredentialKey[] {
  const seen: CredentialKey[] = []
  ctx.on('credentials/record-updated', (key) => { seen.push(key) })
  return seen
}

function put(ctx: Context, key: CredentialKey, record: CredentialRecord): Promise<CredentialRecord | undefined> {
  return ctx.credentials.modifyRecord(key, () => Promise.resolve(record))
}

describe('resolveSpec os backend', () => {
  it('defaults the index under the harness home with service dsh-studio', () => {
    expect(resolveSpec({ dshHome: '/custom/home' })).toEqual({
      backend: 'os',
      service: DEFAULT_SERVICE,
      filename: resolve(`/custom/home/${INDEX_FILENAME}`),
      watch: true,
      debounceMs: 100,
    })
  })

  it('lets an explicit path and service win', () => {
    expect(resolveSpec({
      backend: 'os', path: '/var/index.yaml', service: 'custom', watch: false, debounceMs: 0,
    })).toEqual({
      backend: 'os',
      service: 'custom',
      filename: resolve('/var/index.yaml'),
      watch: false,
      debounceMs: 0,
    })
  })
})

describe('index parse and render', () => {
  it('round-trips refs and record kinds without secret values', () => {
    const text = renderCredentialsOsIndex({
      refs: new Set(['DEEPSEEK_API_KEY', 'OPENAI_API_KEY']),
      records: new Map([['llm-pi-ai/openai-codex', 'grant'], ['llm-pi-ai/amazon-bedrock', 'api-key']]),
    })
    expect(text).not.toMatch(/sk-|eyJ|token|secret/i)
    expect(parseCredentialsOsIndex(text, '/index.yaml')).toEqual({
      refs: new Set(['DEEPSEEK_API_KEY', 'OPENAI_API_KEY']),
      records: new Map([['llm-pi-ai/amazon-bedrock', 'api-key'], ['llm-pi-ai/openai-codex', 'grant']]),
    })
  })

  it('treats an empty document as an empty index', () => {
    expect(parseCredentialsOsIndex('# nothing\n', '/index.yaml')).toEqual({ refs: new Set(), records: new Map() })
    expect(parseCredentialsOsIndex('version: 1\nrefs: null\nrecords: null\n', '/index.yaml')).toEqual({
      refs: new Set(), records: new Map(),
    })
    expect(renderCredentialsOsIndex({ refs: new Set(), records: new Map() })).toBe('version: 1\n')
  })

  it.each([
    ['a non-mapping root', 'just a string\n', /must be a mapping/],
    ['a sequence root', '- DEEPSEEK_API_KEY\n', /must be a mapping/],
    ['no version', 'refs:\n  DEEPSEEK_API_KEY: true\n', /has no version/],
    ['a future version', 'version: 2\nrefs: {}\n', /this build reads version 1/],
    ['an unknown top-level key', 'version: 1\nsecrets: {}\n', /unknown top-level key "secrets"/],
    ['a non-mapping refs section', 'version: 1\nrefs: nope\n', /"refs" .* must be a mapping/],
    ['a sequence refs section', 'version: 1\nrefs: []\n', /"refs" .* must be a mapping/],
    ['a non-true ref marker', 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: sk-live\n', /must be true/],
    ['a key that is not a POSIX identifier', 'version: 1\nrefs:\n  not-a-ref: true\n', /credential ref/],
    ['a record key that is not scoped', 'version: 1\nrecords:\n  codex: grant\n', /must be "<scope>\/<id>"/],
    ['an unknown record kind', 'version: 1\nrecords:\n  llm-pi-ai/codex: token\n', /unknown kind "token"/],
    ['malformed yaml', 'refs: "unterminated\n', /invalid index/],
  ])('rejects %s', (_case, text, message) => {
    expect(() => parseCredentialsOsIndex(text, '/index.yaml')).toThrow(message)
  })
})

describe('os backend layering and writes', () => {
  it('treats an absent index as an empty writable store', async () => {
    const dir = await tempDir()
    const ctx = await boot({ dshHome: dir })
    expect(await ctx.credentials.resolve(KEY)).toBeUndefined()
    expect(await ctx.credentials.describe(KEY)).toEqual({ configured: false, writable: true })
    expect(await ctx.credentials.describeRecord(CODEX)).toEqual({ configured: false, writable: true })
    expect(await ctx.credentials.listRecords()).toEqual([])
  })

  it('stores secrets in the OS store and kinds in the index', async () => {
    const dir = await tempDir()
    const store = new MemoryOsSecretStore()
    const ctx = await boot({ dshHome: dir }, store)
    const seen = updates(ctx)
    await ctx.credentials.set(KEY, 'sk-live-secret')
    expect(await ctx.credentials.resolve(KEY)).toEqual({ value: 'sk-live-secret', source: 'keychain' })
    expect(await ctx.credentials.describe(KEY)).toEqual({ configured: true, source: 'keychain', writable: true })
    expect(await store.get('ref:DSH_CRED_OS')).toBe('sk-live-secret')
    const index = await readFile(join(dir, INDEX_FILENAME), 'utf8')
    expect(index).toContain('DSH_CRED_OS: true')
    expect(index).not.toContain('sk-live-secret')
    expect(seen).toEqual([KEY])

    const reread = await boot({ dshHome: dir }, store)
    expect(await reread.credentials.resolve(KEY)).toEqual({ value: 'sk-live-secret', source: 'keychain' })
  })

  it('unsets only the owning entry and stays silent on an absent unset', async () => {
    const dir = await tempDir()
    const ctx = await boot({ dshHome: dir })
    const seen = updates(ctx)
    await ctx.credentials.set(KEY, 'gone')
    await ctx.credentials.set(OTHER, 'stays')
    await ctx.credentials.unset(KEY)
    await ctx.credentials.unset(KEY)
    expect(await ctx.credentials.resolve(KEY)).toBeUndefined()
    expect(await ctx.credentials.resolve(OTHER)).toEqual({ value: 'stays', source: 'keychain' })
    expect(seen).toEqual([KEY, OTHER, KEY])
  })

  it('lets a non-empty process environment win read-only over the keychain', async () => {
    const dir = await tempDir()
    const ctx = new Context()
    ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([
      { source: 'process', values: { DSH_CRED_OS: 'from-shell' } },
      { source: 'user-env', path: '/home/.dsh/.env', values: { DSH_CRED_OS_OTHER: 'from-user' } },
    ]))
    class Injected extends OsCredentialProvider {
      constructor(c: Context, cfg: ConstructorParameters<typeof OsCredentialProvider>[1]) {
        super(c, cfg, new MemoryOsSecretStore())
      }
    }
    const fiber = ctx.plugin(Injected, { dshHome: dir })
    cleanups.push(async () => { await fiber.dispose() })
    await fiber

    expect(await ctx.credentials.resolve(KEY)).toEqual({ value: 'from-shell', source: 'env' })
    expect(await ctx.credentials.describe(KEY)).toEqual({ configured: true, source: 'env', writable: false })
    await expect(ctx.credentials.set(KEY, 'next')).rejects.toThrow(/launching environment/)
    expect(await ctx.credentials.resolve(OTHER)).toEqual({ value: 'from-user', source: 'user-env' })
    expect(await ctx.credentials.describe(OTHER)).toEqual({ configured: true, source: 'user-env', writable: true })
    await ctx.credentials.set(OTHER, 'rotated')
    expect(await ctx.credentials.resolve(OTHER)).toEqual({ value: 'rotated', source: 'keychain' })
  })

  it('treats an empty environment value as absent', async () => {
    const dir = await tempDir()
    const ctx = new Context()
    ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([
      { source: 'process', values: { DSH_CRED_OS: '' } },
      { source: 'project-env', path: '/work/.env', values: { DSH_CRED_OS: 'from-project' } },
    ]))
    class Injected extends OsCredentialProvider {
      constructor(c: Context, cfg: ConstructorParameters<typeof OsCredentialProvider>[1]) {
        super(c, cfg, new MemoryOsSecretStore())
      }
    }
    const fiber = ctx.plugin(Injected, { dshHome: dir })
    cleanups.push(async () => { await fiber.dispose() })
    await fiber
    expect(await ctx.credentials.resolve(KEY)).toEqual({ value: 'from-project', source: 'project-env' })
  })

  it('rejects empty values and chains past a rejected write', async () => {
    const dir = await tempDir()
    const ctx = await boot({ dshHome: dir })
    const bad = expect(ctx.credentials.set(KEY, '')).rejects.toThrow(/empty value/)
    const good = ctx.credentials.set(OTHER, 'lands')
    await bad
    await good
    expect(await ctx.credentials.resolve(OTHER)).toEqual({ value: 'lands', source: 'keychain' })
  })

  it('serializes concurrent writes so both land', async () => {
    const dir = await tempDir()
    const ctx = await boot({ dshHome: dir })
    await Promise.all([ctx.credentials.set(KEY, 'one'), ctx.credentials.set(OTHER, 'two')])
    expect(await ctx.credentials.resolve(KEY)).toEqual({ value: 'one', source: 'keychain' })
    expect(await ctx.credentials.resolve(OTHER)).toEqual({ value: 'two', source: 'keychain' })
  })

  it('refuses writes after disposal', async () => {
    const dir = await tempDir()
    const ctx = new Context()
    class Injected extends OsCredentialProvider {
      constructor(c: Context, cfg: ConstructorParameters<typeof OsCredentialProvider>[1]) {
        super(c, cfg, new MemoryOsSecretStore())
      }
    }
    const fiber = ctx.plugin(Injected, { dshHome: dir })
    await fiber
    const credentials = ctx.credentials
    await fiber.dispose()
    await expect(credentials.set(KEY, 'late')).rejects.toThrow(/disposed/)
    await expect(credentials.modifyRecord(CODEX, () => Promise.resolve({ kind: 'api-key' }))).rejects.toThrow(/disposed/)
    await expect(credentials.deleteRecord(CODEX)).rejects.toThrow(/disposed/)
  })
})

describe('os backend records', () => {
  it('returns a grant payload exactly as its owner wrote it', async () => {
    const dir = await tempDir()
    const ctx = await boot({ dshHome: dir })
    const payload = { type: 'oauth', access: 'at', refresh: 'rt', expires: 1786000000000 }
    await put(ctx, CODEX, { kind: 'grant', payload })
    expect(await ctx.credentials.readRecord(CODEX)).toEqual({ kind: 'grant', payload })
    const index = await readFile(join(dir, INDEX_FILENAME), 'utf8')
    expect(index).toContain('llm-pi-ai/openai-codex: grant')
    expect(index).not.toContain('at')
    expect(index).not.toContain('rt')
  })

  it('stores api-key records with a key, env, both, or neither', async () => {
    const dir = await tempDir()
    const ctx = await boot({ dshHome: dir })
    await put(ctx, BEDROCK, { kind: 'api-key' })
    expect(await ctx.credentials.describeRecord(BEDROCK)).toEqual({
      configured: true, kind: 'api-key', writable: true,
    })
    await put(ctx, CODEX, { kind: 'api-key', key: 'sk-azure', env: { AWS_PROFILE: 'prod' } })
    expect(await ctx.credentials.readRecord(CODEX)).toEqual({
      kind: 'api-key', key: 'sk-azure', env: { AWS_PROFILE: 'prod' },
    })
    expect(await ctx.credentials.listRecords()).toEqual([
      { key: BEDROCK, kind: 'api-key' },
      { key: CODEX, kind: 'api-key' },
    ])
  })

  it('shows the mutation the record as it stands and leaves it when declined', async () => {
    const dir = await tempDir()
    const ctx = await boot({ dshHome: dir })
    await put(ctx, CODEX, { kind: 'grant', payload: { expires: 1 } })
    const seen = recordUpdates(ctx)
    const next = await ctx.credentials.modifyRecord(CODEX, (current) => {
      expect(current).toEqual({ kind: 'grant', payload: { expires: 1 } })
      return Promise.resolve({ kind: 'grant', payload: { expires: 2 } })
    })
    expect(next).toEqual({ kind: 'grant', payload: { expires: 2 } })
    const declined = await ctx.credentials.modifyRecord(CODEX, () => Promise.resolve(undefined))
    expect(declined).toEqual({ kind: 'grant', payload: { expires: 2 } })
    expect(seen).toEqual([CODEX])
  })

  it('announces a committed write and a committed delete, and stays silent on an absent delete', async () => {
    const dir = await tempDir()
    const ctx = await boot({ dshHome: dir })
    const seen = recordUpdates(ctx)
    await put(ctx, CODEX, { kind: 'grant', payload: 1 })
    await ctx.credentials.deleteRecord(CODEX)
    await ctx.credentials.deleteRecord(CODEX)
    expect(seen).toEqual([CODEX, CODEX])
    expect(await ctx.credentials.readRecord(CODEX)).toBeUndefined()
  })

  it('refuses a payload this store could not read back', async () => {
    const dir = await tempDir()
    const ctx = await boot({ dshHome: dir })
    const cyclic: Record<string, unknown> = {}
    cyclic['self'] = cyclic
    for (const payload of [
      { at: new Date(0) }, { size: 1n }, { run: () => undefined }, { ratio: Number.NaN }, cyclic,
    ]) {
      await expect(put(ctx, CODEX, { kind: 'grant', payload }))
        .rejects.toThrow(/record "llm-pi-ai\/openai-codex" payload/)
    }
    await put(ctx, CODEX, { kind: 'grant', payload: [1, { ok: true }] })
    expect(await ctx.credentials.readRecord(CODEX)).toEqual({ kind: 'grant', payload: [1, { ok: true }] })
  })

  it('refuses an api-key record this store could not read back', async () => {
    const dir = await tempDir()
    const ctx = await boot({ dshHome: dir })
    await expect(put(ctx, CODEX, { kind: 'api-key', key: '' })).rejects.toThrow(/empty key/)
    await expect(put(ctx, CODEX, { kind: 'api-key', env: { 'not a name': 'value' } })).rejects.toThrow(/must match/)
    await expect(put(ctx, CODEX, { kind: 'api-key', env: { AWS_REGION: '' } })).rejects.toThrow(/non-empty string/)
    expect(await ctx.credentials.readRecord(CODEX)).toBeUndefined()
  })
})

describe('os backend boot validation', () => {
  it('fails boot when the index exists but cannot be read', async () => {
    const dir = await tempDir()
    const path = join(dir, INDEX_FILENAME)
    await mkdir(path, { mode: 0o700 })
    const ctx = new Context()
    await expect(ctx.plugin(OsCredentialProvider, { path, backend: 'os' })).rejects.toThrow()
  })

  it('fails boot when a parent of the index is not a directory', async () => {
    const dir = await tempDir()
    const parent = join(dir, 'blocked')
    await writeFile(parent, 'not-a-directory\n')
    await expect(boot({ path: join(parent, INDEX_FILENAME) })).rejects.toThrow()
  })

  it('fails a write when the index path has become unreadable', async () => {
    const dir = await tempDir()
    const ctx = await boot({ dshHome: dir })
    await ctx.credentials.set(KEY, 'first')
    const path = join(dir, INDEX_FILENAME)
    await rm(path)
    await mkdir(path, { mode: 0o700 })
    await expect(ctx.credentials.set(OTHER, 'second')).rejects.toThrow()
  })

  it('boots an api-key record that carries a key and env', async () => {
    const dir = await tempDir()
    const store = new MemoryOsSecretStore()
    await store.set('record:llm-pi-ai/openai-codex', JSON.stringify({
      kind: 'api-key', key: 'sk-azure', env: { AWS_PROFILE: 'prod' },
    }))
    await writeFile(
      join(dir, INDEX_FILENAME),
      'version: 1\nrecords:\n  llm-pi-ai/openai-codex: api-key\n',
      { mode: 0o600 },
    )
    const ctx = await boot({ dshHome: dir }, store)
    expect(await ctx.credentials.readRecord(CODEX)).toEqual({
      kind: 'api-key', key: 'sk-azure', env: { AWS_PROFILE: 'prod' },
    })
  })

  it.skipIf(process.platform === 'win32')('refuses an index other OS users can read', async () => {
    const dir = await tempDir()
    const path = join(dir, INDEX_FILENAME)
    await writeFile(path, 'version: 1\nrefs:\n  DSH_CRED_OS: true\n', { mode: 0o644 })
    const ctx = new Context()
    await expect(ctx.plugin(OsCredentialProvider, { path, backend: 'os' }))
      .rejects.toThrow(/readable beyond its owner \(mode 644\)/)
  })

  it('fails boot when the index lists a missing secret', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, INDEX_FILENAME), 'version: 1\nrefs:\n  DSH_CRED_OS: true\n', { mode: 0o600 })
    await expect(boot({ dshHome: dir })).rejects.toThrow(/index lists "DSH_CRED_OS" but the OS store has no secret/)
  })

  it('fails boot when the index lists a missing record payload', async () => {
    const dir = await tempDir()
    await writeFile(
      join(dir, INDEX_FILENAME),
      'version: 1\nrecords:\n  llm-pi-ai/openai-codex: grant\n',
      { mode: 0o600 },
    )
    await expect(boot({ dshHome: dir })).rejects.toThrow(/index lists record .* but the OS store has no payload/)
  })

  it('fails boot when the stored record kind disagrees with the index', async () => {
    const dir = await tempDir()
    const store = new MemoryOsSecretStore()
    await store.set('record:llm-pi-ai/openai-codex', JSON.stringify({ kind: 'api-key' }))
    await writeFile(
      join(dir, INDEX_FILENAME),
      'version: 1\nrecords:\n  llm-pi-ai/openai-codex: grant\n',
      { mode: 0o600 },
    )
    await expect(boot({ dshHome: dir }, store)).rejects.toThrow(/as grant but the OS store holds api-key/)
  })

  it.each([
    ['not JSON', 'nope', /is not JSON/],
    ['a sequence', '[]', /must be a mapping/],
    ['no kind', '{}', /has no kind/],
    ['unknown kind', '{"kind":"token"}', /unknown kind "token"/],
    ['unknown api-key field', '{"kind":"api-key","extra":1}', /unknown field "extra"/],
    ['empty api-key', '{"kind":"api-key","key":""}', /non-string or empty key/],
    ['non-mapping env', '{"kind":"api-key","env":"nope"}', /non-mapping env/],
    ['empty env value', '{"kind":"api-key","env":{"AWS_PROFILE":""}}', /must be a non-empty string/],
    ['invalid env name', '{"kind":"api-key","env":{"not-a-name":"x"}}', /must match/],
    ['non-finite payload', '{"kind":"grant","payload":1e999}', /non-finite number/],
    ['unknown grant field', '{"kind":"grant","payload":1,"extra":2}', /unknown field "extra"/],
    ['grant without payload', '{"kind":"grant"}', /has no payload/],
  ])('fails boot when a stored record is %s', async (_case, raw, message) => {
    const dir = await tempDir()
    const store = new MemoryOsSecretStore()
    await store.set('record:llm-pi-ai/openai-codex', raw)
    await writeFile(
      join(dir, INDEX_FILENAME),
      'version: 1\nrecords:\n  llm-pi-ai/openai-codex: grant\n',
      { mode: 0o600 },
    )
    await expect(boot({ dshHome: dir }, store)).rejects.toThrow(message)
  })

  it('fails a write loud when the on-disk index became invalid', async () => {
    const dir = await tempDir()
    const ctx = await boot({ dshHome: dir })
    await writeFile(join(dir, INDEX_FILENAME), 'refs: "unterminated\n', { mode: 0o600 })
    await expect(ctx.credentials.set(OTHER, 'lands')).rejects.toThrow(/invalid index/)
  })
})

describe('MemoryOsSecretStore', () => {
  it('round-trips and deletes secrets', async () => {
    const store = new MemoryOsSecretStore()
    expect(await store.get('a')).toBeUndefined()
    await store.set('a', 'one')
    expect(await store.get('a')).toBe('one')
    await store.delete('a')
    expect(await store.get('a')).toBeUndefined()
    await store.delete('a')
  })
})

describe('platform OS stores', () => {
  function withPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
    Object.defineProperty(process, 'platform', { configurable: true, value: platform })
    try {
      return run()
    } finally {
      Reflect.deleteProperty(process, 'platform')
    }
  }

  function execOk(stdout = ''): void {
    childMocks.execFile.mockImplementation((
      _file: string,
      _args: readonly string[],
      optionsOrCb: unknown,
      maybeCb?: ExecFileCallback,
    ) => {
      const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb
      queueMicrotask(() => cb?.(null, stdout, ''))
    })
  }

  function execFail(message: string): void {
    childMocks.execFile.mockImplementation((
      _file: string,
      _args: readonly string[],
      optionsOrCb: unknown,
      maybeCb?: ExecFileCallback,
    ) => {
      const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb
      queueMicrotask(() => cb?.(new Error(message)))
    })
  }

  it('uses an in-memory store on non-Windows, non-macOS platforms', async () => {
    const store = withPlatform('linux', () => createPlatformOsSecretStore('svc'))
    await store.set('acct', 'secret')
    expect(await store.get('acct')).toBe('secret')
    await store.delete('acct')
    expect(await store.get('acct')).toBeUndefined()
  })

  it('reads, writes, and deletes macOS keychain secrets through security', async () => {
    const store = withPlatform('darwin', () => createPlatformOsSecretStore('dsh-test'))
    execOk('stored-secret\n')
    expect(await store.get('acct')).toBe('stored-secret')
    execOk('')
    expect(await store.get('acct')).toBeUndefined()
    childMocks.execFile.mockImplementation((
      _file: string,
      _args: readonly string[],
      optionsOrCb: unknown,
      maybeCb?: ExecFileCallback,
    ) => {
      const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb
      queueMicrotask(() => cb?.(null))
    })
    expect(await store.get('acct')).toBeUndefined()
    execFail('could not be found in keychain')
    expect(await store.get('acct')).toBeUndefined()
    childMocks.execFile.mockImplementation((
      _file: string,
      _args: readonly string[],
      optionsOrCb: unknown,
      maybeCb?: ExecFileCallback,
    ) => {
      const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb
      queueMicrotask(() => cb?.('could not be found in keychain'))
    })
    expect(await store.get('acct')).toBeUndefined()
    execFail('permission denied')
    await expect(store.get('acct')).rejects.toThrow(/permission denied/)

    execOk()
    await store.set('acct', 'next')
    expect(childMocks.execFile.mock.calls.at(-1)?.[1]).toEqual([
      'add-generic-password', '-U', '-s', 'dsh-test', '-a', 'acct', '-w', 'next',
    ])

    execFail('cannot find the item')
    await store.delete('acct')
    execFail('unexpected failure')
    await expect(store.delete('acct')).rejects.toThrow(/unexpected failure/)
  })

  it('stores Windows secrets as DPAPI-protected files under LocalAppData', async () => {
    const dir = await tempDir()
    osMocks.homedir.mockReturnValue(dir)
    const store = withPlatform('win32', () => createPlatformOsSecretStore('svc/name'))
    expect(await store.get('acct')).toBeUndefined()
    await store.delete('acct')

    childMocks.execFile.mockImplementation((
      file: string,
      args: readonly string[],
      optionsOrCb: unknown,
      maybeCb?: ExecFileCallback,
    ) => {
      const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb
      const script = String(args[2] ?? '')
      const stdout = script.includes(']::Protect(') ? 'ZW5jb2RlZA==' : 'decoded-secret'
      queueMicrotask(() => cb?.(null, `${stdout}\n`, ''))
      void file
    })
    await store.set('acct/one', 'plain')
    const encoded = await readFile(join(dir, 'AppData', 'Local', 'dsh-studio-creds', 'svc_name', 'acct_one.bin'), 'utf8')
    expect(encoded).toBe('ZW5jb2RlZA==')
    expect(await store.get('acct/one')).toBe('decoded-secret')

    childMocks.execFile.mockImplementation((
      _file: string,
      _args: readonly string[],
      optionsOrCb: unknown,
      maybeCb?: ExecFileCallback,
    ) => {
      const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb
      queueMicrotask(() => cb?.(null, '\n', ''))
    })
    expect(await store.get('acct/one')).toBeUndefined()
    await store.delete('acct/one')
    expect(await store.get('acct/one')).toBeUndefined()
  })

  it('propagates Windows filesystem errors other than absence', async () => {
    const dir = await tempDir()
    osMocks.homedir.mockReturnValue(dir)
    const store = withPlatform('win32', () => createPlatformOsSecretStore('svc'))
    await mkdir(join(dir, 'AppData', 'Local', 'dsh-studio-creds', 'svc', 'acct.bin'), { recursive: true })
    await expect(store.get('acct')).rejects.toThrow()
    await expect(store.delete('acct')).rejects.toThrow()
  })

  it('propagates Windows DPAPI subprocess failures', async () => {
    const dir = await tempDir()
    osMocks.homedir.mockReturnValue(dir)
    const store = withPlatform('win32', () => createPlatformOsSecretStore('svc'))
    await mkdir(join(dir, 'AppData', 'Local', 'dsh-studio-creds', 'svc'), { recursive: true })
    await writeFile(join(dir, 'AppData', 'Local', 'dsh-studio-creds', 'svc', 'acct.bin'), 'ZW5j', { mode: 0o600 })
    execFail('Unprotect failed')
    await expect(store.get('acct')).rejects.toThrow(/Unprotect failed/)
    execFail('Protect failed')
    await expect(store.set('acct', 'next')).rejects.toThrow(/Protect failed/)
  })
})
