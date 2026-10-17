import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { CredentialSync } from '../src/credential-sync.ts'
import type { ObjectValue } from '../src/sync-engine.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(cleanups.splice(0).map(dispose => dispose())) })
async function fixture() {
  const ctx = new Context()
  const plugin = ctx.plugin(MemoryCredentials); await plugin
  cleanups.push(async () => { await plugin.dispose() })
  const sync = new CredentialSync(ctx.credentials, () => [])
  sync.bind('test-server/account-one')
  return { ctx, sync }
}
const deepseek = credentialKey('deepseek-account-platform', 'default')
async function exported(sync: CredentialSync): Promise<ObjectValue> {
  const owner = sync.contributions()[0]!
  const value = (await owner.export())[0]!
  return {
    ...value, namespace: owner.namespace, parentId: null, version: 1, formatVersion: 1,
    encrypted: false, deleted: false, fileRefs: [],
  }
}
it('encrypts only allowed provider records, produces stable ciphertext and restores on another device', async () => {
  const a = await fixture(), b = await fixture()
  await a.ctx.credentials.modifyRecord(deepseek, async () => ({ kind: 'grant', payload: { accessToken: 'private-model-token' } }))
  await a.ctx.credentials.modifyRecord(credentialKey('studio-cloud', 'connection'), async () => ({ kind: 'grant', payload: 'studio-secret' }))
  await a.ctx.credentials.modifyRecord(credentialKey('deepseek-account-platform', 'device'), async () => ({ kind: 'grant', payload: 'device-secret' }))
  expect(await a.sync.contributions()[0]!.export()).toEqual([])
  await a.sync.unlock('independent-passphrase')
  const value = await exported(a.sync)
  expect(JSON.stringify(value)).not.toMatch(/private-model-token|studio-secret|device-secret|accessToken/)
  expect(await exported(a.sync)).toEqual(value)
  await b.sync.unlock('independent-passphrase')
  await b.sync.contributions()[0]!.import(value, new AbortController().signal)
  expect(await b.ctx.credentials.readRecord(deepseek)).toEqual(await a.ctx.credentials.readRecord(deepseek))
  expect((await b.ctx.credentials.listRecords()).map(item => item.key)).toEqual([deepseek])
  expect(await exported(b.sync)).toEqual(value)
})
it('rejects wrong passphrases and account substitution before writing credentials', async () => {
  const a = await fixture(), b = await fixture()
  await a.ctx.credentials.modifyRecord(deepseek, async () => ({ kind: 'grant', payload: { token: 'private' } }))
  await a.sync.unlock('independent-passphrase')
  const value = await exported(a.sync)
  await b.sync.unlock('incorrect-passphrase')
  await expect(b.sync.contributions()[0]!.import(value, new AbortController().signal)).rejects.toMatchObject({ code: 'CREDENTIALS_KEY_INVALID' })
  expect(b.sync.locked).toBe(true)
  expect(await b.ctx.credentials.listRecords()).toEqual([])
  b.sync.bind('different-account')
  await b.sync.unlock('independent-passphrase')
  await expect(b.sync.contributions()[0]!.import(value, new AbortController().signal)).rejects.toMatchObject({ code: 'CREDENTIALS_KEY_INVALID' })
  expect(await b.ctx.credentials.listRecords()).toEqual([])
})
it('clears secrets on account changes and refuses short passphrases', async () => {
  const { sync } = await fixture()
  await expect(sync.unlock('short')).rejects.toMatchObject({ code: 'CREDENTIALS_PASSPHRASE_LENGTH' })
  await sync.unlock('independent-passphrase')
  sync.bind('another-account')
  expect(sync.locked).toBe(true)
  expect(await sync.contributions()[0]!.export()).toEqual([])
})

it('syncs configured managed API keys but excludes ambient environment values', async () => {
  const a = await fixture(), b = await fixture(), ref = credentialRef('OPENAI_API_KEY')
  const resolve = vi.spyOn(a.ctx.credentials, 'resolve').mockResolvedValue({ source: 'env', value: 'ambient-secret' })
  const source = new CredentialSync(a.ctx.credentials, () => [ref])
  const target = new CredentialSync(b.ctx.credentials, () => [ref])
  source.bind('api-account'); target.bind('api-account')
  await source.unlock('independent-passphrase'); await target.unlock('independent-passphrase')
  const exportApi = async () => {
    const owner = source.contributions()[3]!, item = (await owner.export())[0]!
    return {
      ...item, namespace: owner.namespace, parentId: null, version: 1, formatVersion: 1,
      encrypted: false, deleted: false, fileRefs: [],
    }
  }
  await target.contributions()[3]!.import(await exportApi(), new AbortController().signal)
  expect(await b.ctx.credentials.resolve(ref)).toBeUndefined()
  resolve.mockResolvedValue({ source: 'file', value: 'managed-secret' })
  const value = await exportApi()
  expect(JSON.stringify(value)).not.toContain('managed-secret')
  await target.contributions()[3]!.import(value, new AbortController().signal)
  expect(await b.ctx.credentials.resolve(ref)).toMatchObject({ value: 'managed-secret' })
  resolve.mockRestore()
})
it('validates existing ciphertext without replacing a refreshed local provider grant', async () => {
  const a = await fixture()
  await a.ctx.credentials.modifyRecord(deepseek, async () => ({ kind: 'grant', payload: { token: 'old' } }))
  await a.sync.unlock('independent-passphrase')
  const value = await exported(a.sync)
  await a.ctx.credentials.modifyRecord(deepseek, async () => ({ kind: 'grant', payload: { token: 'refreshed' } }))
  await a.sync.contributions()[0]!.validate!(value, new AbortController().signal)
  expect(await a.ctx.credentials.readRecord(deepseek)).toMatchObject({ payload: { token: 'refreshed' } })
})
