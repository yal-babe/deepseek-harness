/** Independent-passphrase encryption for explicitly selected model credentials. */
import { createCipheriv, createDecipheriv, createHash, scrypt, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { credentialKey, credentialRef, parseCredentialKey, type CredentialProvider, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { SyncContribution } from './sync-engine.ts'
import { CloudError } from './transport.ts'

const categories = ['deepseek', 'codex', 'antigravity', 'api-keys'] as const
type Category = typeof categories[number]
const record = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('grant'), payload: z.json() }).strict(),
  z.object({ kind: z.literal('api-key'), key: z.string().min(1) }).strict(),
])
const contents = z.object({
  records: z.array(z.object({ key: z.string(), record }).strict()),
  references: z.array(z.object({ ref: z.string(), value: z.string().min(1) }).strict()),
}).strict()
const envelope = z.object({
  format: z.literal(1), cipher: z.literal('aes-256-gcm'), kdf: z.literal('scrypt-32768-8-1'),
  nonce: z.string().regex(/^[A-Za-z0-9+/]{16}$/), body: z.string().min(24),
}).strict()
const addresses = {
  deepseek: credentialKey('deepseek-account-platform', 'default'),
  codex: credentialKey('llm-pi-ai', 'openai-codex'),
  antigravity: credentialKey('llm-antigravity', 'default'),
}

/** Holds encryption keys only for the current signed-in Host lifetime. */
export class CredentialSync {
  private key: Buffer | undefined
  private account = ''
  private readonly cache = new Map<Category, { digest: string; payload: z.infer<typeof envelope> }>()
  /** @param provider - local credential store. @param references - configured API key references, excluding ambient environment. */
  constructor(private readonly provider: CredentialProvider, private readonly references: () => CredentialRef[]) {}
  /** Whether credential restoration requires a passphrase. */
  get locked(): boolean { return !this.key }
  /** Forget key material and encrypted export caches. */
  clear(): void { this.key?.fill(0); this.key = undefined; this.cache.clear() }
  /** Bind encryption to one Studio issuer and account.
   * @param account - stable server origin and user identifier.
   */
  bind(account: string): void {
    if (account !== this.account) { this.clear(); this.account = account }
  }
  /** Derive a transient local encryption key.
   * @param passphrase - independent secret, never sent to the Studio server.
   */
  async unlock(passphrase: string): Promise<void> {
    if (passphrase.length < 12 || passphrase.length > 1024) throw new CloudError('CREDENTIALS_PASSPHRASE_LENGTH')
    const account = this.account
    const key = await new Promise<Buffer>((resolve, reject) => scrypt(passphrase, `dsh-studio-credentials-v1:${account}`, 32,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)))
    if (account !== this.account) { key.fill(0); throw new CloudError('CANCELLED') }
    this.clear(); this.key = key
  }
  private allowed(category: Category, key: string, kind: string): boolean {
    return category === 'api-keys' ? key.startsWith('llm-pi-ai/') && kind === 'api-key' : key === addresses[category] && kind === 'grant'
  }
  private async read(category: Category): Promise<z.infer<typeof contents>> {
    const result: z.infer<typeof contents> = { records: [], references: [] }
    for (const entry of await this.provider.listRecords()) {
      if (!this.allowed(category, entry.key, entry.kind)) continue
      const value = await this.provider.readRecord(entry.key)
      if (!value) continue
      if (value.kind === 'api-key') {
        if (value.key) result.records.push({ key: entry.key, record: { kind: 'api-key', key: value.key } })
      } else result.records.push({ key: entry.key, record: record.parse(value) })
    }
    if (category === 'api-keys') for (const ref of [...new Set(this.references())].sort()) {
      const value = await this.provider.resolve(ref)
      if (value && ['file', 'keychain'].includes(value.source)) result.references.push({ ref, value: value.value })
    }
    result.records.sort((a, b) => a.key.localeCompare(b.key))
    return result
  }
  private decrypt(category: Category, item: import('./sync-engine.ts').ObjectValue) {
    if (!this.key) throw new CloudError('CREDENTIALS_LOCKED')
    if (item.id !== `credential:${category}` || item.deleted) throw new CloudError('UNSUPPORTED_PAYLOAD')
    const payload = envelope.parse(item.payload), body = Buffer.from(payload.body, 'base64')
    let plain: Buffer
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(payload.nonce, 'base64'))
      decipher.setAAD(Buffer.from(`${this.account}:${category}:v1`))
      decipher.setAuthTag(body.subarray(-16))
      plain = Buffer.concat([decipher.update(body.subarray(0, -16)), decipher.final()])
    } catch (_error) {
      this.clear()
      throw new CloudError('CREDENTIALS_KEY_INVALID')
    }
    const restored = contents.parse(JSON.parse(plain.toString('utf8')))
    plain.fill(0)
    return { restored, payload }
  }
  /** Create independently selectable model credential exporters.
   * @returns four encrypted contributions.
   */
  contributions(): SyncContribution[] {
    return categories.map(category => ({
      namespace: `studio.credentials.${category}`, version: 1,
      fields: ['format', 'cipher', 'kdf', 'nonce', 'body'],
      export: async () => {
        if (!this.key) return []
        const key = this.key, account = this.account
        const plain = JSON.stringify(await this.read(category))
        if (key !== this.key || account !== this.account) throw new CloudError('CANCELLED')
        const digest = createHash('sha256').update(plain).digest('hex')
        let cached = this.cache.get(category)
        if (cached?.digest !== digest) {
          const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce)
          cipher.setAAD(Buffer.from(`${account}:${category}:v1`))
          const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]).toString('base64')
          cached = { digest, payload: { format: 1, cipher: 'aes-256-gcm', kdf: 'scrypt-32768-8-1', nonce: nonce.toString('base64'), body } }
          this.cache.set(category, cached)
        }
        if (!cached) throw new CloudError('CREDENTIALS_LOCKED')
        return [{ id: `credential:${category}`, kind: 'plugin', payload: cached.payload }]
      },
      validate: async (item) => { this.decrypt(category, item) },
      import: async (item, signal) => {
        const { restored, payload } = this.decrypt(category, item)
        const refs = new Set(this.references())
        for (const entry of restored.records) {
          if (!this.allowed(category, entry.key, entry.record.kind)) throw new CloudError('UNSUPPORTED_PAYLOAD')
          if (!(await this.provider.describeRecord(parseCredentialKey(entry.key))).writable) throw new CloudError('LOCAL_READ_ONLY')
        }
        for (const entry of restored.references) {
          const ref = credentialRef(entry.ref)
          if (category !== 'api-keys' || !refs.has(ref)) throw new CloudError('UNSUPPORTED_PAYLOAD')
          if (!(await this.provider.describe(ref)).writable) throw new CloudError('LOCAL_READ_ONLY')
        }
        for (const entry of restored.records) {
          signal.throwIfAborted()
          await this.provider.modifyRecord(parseCredentialKey(entry.key), async () => entry.record)
        }
        for (const entry of restored.references) {
          signal.throwIfAborted()
          await this.provider.set(credentialRef(entry.ref), entry.value)
        }
        const digest = createHash('sha256').update(JSON.stringify(await this.read(category))).digest('hex')
        this.cache.set(category, { digest, payload })
      },
    }))
  }
}
