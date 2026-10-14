import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import { createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import type { CredentialKey, CredentialRef } from '@deepseek-ai/dsh-credentials'
import OsCredentialProvider, { MemoryOsSecretStore, resolveSpec } from '../src/index.ts'

const KEY = credentialRef('DSH_CRED_OS_FILE')
const OTHER = credentialRef('DSH_CRED_OS_OTHER')
const CODEX = credentialKey('llm-pi-ai', 'openai-codex')

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  vi.unstubAllEnvs()
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-credentials-os-file-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function boot(
  config: ConstructorParameters<typeof OsCredentialProvider>[1],
  store?: MemoryOsSecretStore,
): Promise<Context> {
  const ctx = new Context()
  const Plugin = store === undefined ? OsCredentialProvider : class extends OsCredentialProvider {
    constructor(c: Context, cfg: ConstructorParameters<typeof OsCredentialProvider>[1]) {
      super(c, cfg, store)
    }
  }
  const fiber = ctx.plugin(Plugin, config)
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

describe('resolveSpec file backend', () => {
  it('defaults the credentials document under the harness home', () => {
    expect(resolveSpec({ backend: 'file', dshHome: '/custom/home' })).toEqual({
      backend: 'file',
      service: 'dsh-studio',
      filename: resolve('/custom/home/.credentials.yaml'),
      watch: true,
      debounceMs: 100,
    })
  })

  it('lets an explicit path win and refuses an unknown backend', () => {
    expect(resolveSpec({
      backend: 'file', path: '/etc/dsh/creds.yaml', dshHome: '/ignored', watch: false, debounceMs: 5,
    })).toEqual({
      backend: 'file',
      service: 'dsh-studio',
      filename: resolve('/etc/dsh/creds.yaml'),
      watch: false,
      debounceMs: 5,
    })
    expect(() => resolveSpec({ backend: 'kms' as 'os' })).toThrow(/backend must be "os" or "file"/)
  })
})

describe('file backend delegates to LocalCredentialProvider', () => {
  it('treats an absent file as an empty writable store', async () => {
    const dir = await tempDir()
    const ctx = await boot({ backend: 'file', path: join(dir, '.credentials.yaml'), watch: false })
    expect(await ctx.credentials.resolve(KEY)).toBeUndefined()
    expect(await ctx.credentials.describe(KEY)).toEqual({ configured: false, writable: true })
  })

  it('ignores an injected OS store and writes the YAML document', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const store = new MemoryOsSecretStore()
    const ctx = await boot({ backend: 'file', path, watch: false }, store)
    const seen = updates(ctx)
    await ctx.credentials.set(KEY, 'sk-file')
    expect(await ctx.credentials.resolve(KEY)).toEqual({ value: 'sk-file', source: 'file' })
    expect(await ctx.credentials.describe(KEY)).toEqual({ configured: true, source: 'file', writable: true })
    expect(await readFile(path, 'utf8')).toContain('sk-file')
    expect(await store.get('ref:DSH_CRED_OS_FILE')).toBeUndefined()
    expect(seen).toEqual([KEY])
  })

  it('unsets, layers the inherited environment, and serves dotenv fallbacks', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const ctx = new Context()
    ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([
      { source: 'process', values: { DSH_CRED_OS_OTHER: 'from-shell' } },
      { source: 'project-env', path: '/work/.env', values: { DSH_CRED_OS_FILE: 'from-project' } },
    ]))
    const fiber = ctx.plugin(OsCredentialProvider, { backend: 'file', path, watch: false })
    cleanups.push(async () => { await fiber.dispose() })
    await fiber

    expect(await ctx.credentials.resolve(KEY)).toEqual({ value: 'from-project', source: 'project-env' })
    expect(await ctx.credentials.describe(KEY)).toEqual({ configured: true, source: 'project-env', writable: true })
    expect(await ctx.credentials.resolve(OTHER)).toEqual({ value: 'from-shell', source: 'env' })
    expect(await ctx.credentials.describe(OTHER)).toEqual({ configured: true, source: 'env', writable: false })
    await ctx.credentials.set(KEY, 'stored')
    expect(await ctx.credentials.resolve(KEY)).toEqual({ value: 'stored', source: 'file' })
    await ctx.credentials.unset(KEY)
    expect(await ctx.credentials.resolve(KEY)).toEqual({ value: 'from-project', source: 'project-env' })
    await expect(ctx.credentials.set(OTHER, 'nope')).rejects.toThrow(/launching environment/)
  })

  it('delegates record operations and commit events', async () => {
    const dir = await tempDir()
    const ctx = await boot({ backend: 'file', path: join(dir, '.credentials.yaml'), watch: false })
    const seen = recordUpdates(ctx)
    await ctx.credentials.modifyRecord(CODEX, () => Promise.resolve({ kind: 'grant', payload: { token: 't' } }))
    expect(await ctx.credentials.readRecord(CODEX)).toEqual({ kind: 'grant', payload: { token: 't' } })
    expect(await ctx.credentials.describeRecord(CODEX)).toEqual({ configured: true, kind: 'grant', writable: true })
    expect(await ctx.credentials.listRecords()).toEqual([{ key: CODEX, kind: 'grant' }])
    expect(seen).toEqual([CODEX])
    await ctx.credentials.deleteRecord(CODEX)
    expect(await ctx.credentials.readRecord(CODEX)).toBeUndefined()
    expect(await ctx.credentials.describeRecord(CODEX)).toEqual({ configured: false, writable: true })
  })

  it('refuses writes after disposal', async () => {
    const dir = await tempDir()
    const ctx = new Context()
    const fiber = ctx.plugin(OsCredentialProvider, {
      backend: 'file', path: join(dir, '.credentials.yaml'), watch: false,
    })
    await fiber
    const credentials = ctx.credentials
    await fiber.dispose()
    await expect(credentials.set(KEY, 'late')).rejects.toThrow(/disposed/)
  })
})
