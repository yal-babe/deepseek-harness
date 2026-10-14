/**
 * OS-keychain credentials provider, with a file backend that fully delegates
 * to {@link LocalCredentialProvider}.
 *
 * ```text
 * inherited process environment      (read-only, wins)
 * > OS keychain / file store         (provider-managed, writable)
 * > <invocation cwd>/.env            (read-only fallback)
 * > $DSH_HOME/.env                   (read-only fallback)
 * ```
 *
 * The OS backend stores secret values in {@link OsSecretStore} and a YAML
 * index of reference names and record kinds (never secret values) at
 * `$DSH_HOME/.credentials-os-index.yaml`. Managed source id is `keychain`.
 * @module @deepseek-ai/dsh-credentials-os
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { canonicalizeWatchPath, resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import {
  CredentialProvider, credentialRef, parseCredentialKey,
} from '@deepseek-ai/dsh-credentials'
import type {
  ApiKeyRecord,
  CredentialInfo,
  CredentialKey,
  CredentialRecord,
  CredentialRecordEntry,
  CredentialRecordInfo,
  CredentialRef,
  ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import type { LaunchEnvironmentEntry } from '@deepseek-ai/dsh-launch-environment'
import LocalCredentialProvider, { CREDENTIALS_FILENAME } from '@deepseek-ai/dsh-credentials-local'
import {
  INDEX_FILENAME, INDEX_VERSION, parseCredentialsOsIndex, renderCredentialsOsIndex,
  type CredentialsOsIndex,
} from './index-file.ts'
import {
  createPlatformOsSecretStore, MemoryOsSecretStore, type OsSecretStore,
} from './os-store.ts'

export { INDEX_FILENAME, INDEX_VERSION, parseCredentialsOsIndex, renderCredentialsOsIndex }
export type { CredentialsOsIndex }
export { MemoryOsSecretStore }
export type { OsSecretStore }

/** Isolate label so the file backend can register `credentials` without replacing this provider. */
const FILE_BACKEND_SCOPE = Symbol('credentials-os.file')

/** Account prefix for reference secrets in the OS store. */
const REF_ACCOUNT_PREFIX = 'ref:'

/** Account prefix for record JSON in the OS store. */
const RECORD_ACCOUNT_PREFIX = 'record:'

/** Default OS service / keychain name. */
export const DEFAULT_SERVICE = 'dsh-studio'

/** Plugin config: backend selection, OS service name, and file-backend location. */
export interface Config {
  /** Secret backend; defaults to `os`. `file` fully delegates to {@link LocalCredentialProvider}. */
  backend?: 'os' | 'file'
  /** Keychain / credential-manager service name; defaults to `dsh-studio`. */
  service?: string
  /** Credentials document (file) or index (os) path; defaults under the harness home. */
  path?: string
  /** Harness home used when `path` is omitted; defaults to `$DSH_HOME` or `~/.dsh`. */
  dshHome?: string
  /** Watch the file document and hot-publish external edits; file backend only, defaults to true. */
  watch?: boolean
  /** Watcher write-settle window in milliseconds; file backend only, defaults to 100. */
  debounceMs?: number
}

/** Fully resolved provider parameters; defaulting happens here, never inline. */
interface ResolvedSpec {
  backend: 'os' | 'file'
  service: string
  filename: string
  watch: boolean
  debounceMs: number
}

/**
 * Resolve the runtime spec from plugin config: an explicit `path` wins,
 * otherwise the OS index lives at `<harness home>/.credentials-os-index.yaml`
 * and the file document uses {@link LocalCredentialProvider}'s default.
 * @param config - raw plugin config.
 * @returns the resolved backend, service, file location, and watch behavior.
 */
export function resolveSpec(config: Config): ResolvedSpec {
  const backend = config.backend ?? 'os'
  if (backend !== 'os' && backend !== 'file') {
    throw new Error('credentials-os: backend must be "os" or "file"')
  }
  return {
    backend,
    service: config.service ?? DEFAULT_SERVICE,
    filename: resolve(config.path ?? join(
      resolveDshHome(config.dshHome),
      backend === 'os' ? INDEX_FILENAME : CREDENTIALS_FILENAME,
    )),
    watch: config.watch ?? true,
    debounceMs: config.debounceMs ?? 100,
  }
}

/** Permission bits outside the owner; an index must have none of them. */
const GROUP_OTHER_BITS = 0o077

/**
 * How long an index write waits for the cross-process writer lock. A record
 * mutation runs its caller's decision while holding the lock, and that
 * decision may include a network round trip.
 */
const INDEX_LOCK_WAIT_MS = 30_000

/**
 * Reject an index other OS users can read, before its contents are read.
 * POSIX only: Windows has no mode to inspect, so the check is skipped.
 * @param filename - absolute path of the index.
 * @throws when the path hierarchy is invalid or the file exists with group or other permission bits set.
 */
async function assertOwnerOnly(filename: string): Promise<void> {
  let mode: number
  try {
    mode = (await stat(filename)).mode
  } catch (error) {
    if (!isENOENT(error)) throw error
    await canonicalizeWatchPath(filename)
    return
  }
  /* v8 ignore next -- POSIX coverage cannot take the Windows peer; native Windows coverage does. */
  if (process.platform === 'win32') return
  /* v8 ignore start -- Windows has no POSIX mode enforcement; POSIX behavior tests enforce this peer. */
  const offending = mode & GROUP_OTHER_BITS
  if (offending === 0) return
  throw new Error(
    `credentials-os: ${filename} is readable beyond its owner (mode ${(mode & 0o777).toString(8)});`
    + ` run "chmod 600 ${filename}" before starting again`,
  )
  /* v8 ignore stop */
}

/** Whether a filesystem error means absence; every non-ENOENT failure must surface. */
function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/**
 * Refuse an api-key record the read path could not admit, before it is stored.
 * @param key - the record's credential key, for the failure message.
 * @param record - the api-key record a mutation returned.
 */
function assertStorableApiKey(key: CredentialKey, record: ApiKeyRecord): void {
  if (record.key !== undefined && record.key.length === 0) {
    throw new TypeError(`credentials-os: record "${key}" has an empty key; omit the field instead`)
  }
  for (const [name, value] of Object.entries(record.env ?? {})) {
    credentialRef(name)
    if (value.length === 0) {
      throw new TypeError(`credentials-os: record "${key}" env "${name}" must be a non-empty string`)
    }
  }
}

/**
 * Reject a payload that cannot survive a JSON round trip.
 * @param where - the subject named in a diagnostic, already free of any value.
 * @param value - the payload or nested value to admit.
 * @param seen - objects on the current path, for cycle detection.
 */
function assertJsonValue(where: string, value: unknown, seen: Set<object>): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return
    throw new TypeError(`credentials-os: ${where} holds a non-finite number`)
  }
  if (typeof value === 'object') {
    if (seen.has(value)) throw new TypeError(`credentials-os: ${where} is cyclic`)
    if (Object.getPrototypeOf(value) === Object.prototype || Array.isArray(value)) {
      seen.add(value)
      for (const nested of Object.values(value)) assertJsonValue(where, nested, seen)
      seen.delete(value)
      return
    }
  }
  throw new TypeError(`credentials-os: ${where} holds a value JSON cannot represent`)
}

/**
 * Admit one JSON-stored record. Unknown kinds or fields fail rather than drop.
 * @param key - the record address, quoted in errors.
 * @param raw - JSON text from the OS store.
 * @returns the admitted record.
 */
function parseStoredRecord(key: string, raw: string): CredentialRecord {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error(`credentials-os: stored record "${key}" is not JSON`)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`credentials-os: stored record "${key}" must be a mapping`)
  }
  const fields = value as Record<string, unknown>
  const kind = fields['kind']
  if (kind === 'api-key') {
    for (const field of Object.keys(fields)) {
      if (field !== 'kind' && field !== 'key' && field !== 'env') {
        throw new Error(`credentials-os: stored record "${key}" has unknown field "${field}"`)
      }
    }
    const apiKey = fields['key']
    if (apiKey !== undefined && (typeof apiKey !== 'string' || apiKey.length === 0)) {
      throw new TypeError(`credentials-os: stored record "${key}" has a non-string or empty key`)
    }
    const env = parseStoredEnv(key, fields['env'])
    return {
      kind: 'api-key',
      ...apiKey === undefined ? {} : { key: apiKey },
      ...env === undefined ? {} : { env },
    }
  }
  if (kind === 'grant') {
    for (const field of Object.keys(fields)) {
      if (field !== 'kind' && field !== 'payload') {
        throw new Error(`credentials-os: stored record "${key}" has unknown field "${field}"`)
      }
    }
    if (!('payload' in fields)) {
      throw new Error(`credentials-os: stored record "${key}" has no payload`)
    }
    assertJsonValue(`record "${key}" payload`, fields['payload'], new Set())
    return { kind: 'grant', payload: fields['payload'] }
  }
  if (kind === undefined) throw new Error(`credentials-os: stored record "${key}" has no kind`)
  throw new Error(`credentials-os: stored record "${key}" has unknown kind ${JSON.stringify(kind)}`)
}

/** Admit an api-key record's provider environment from stored JSON. */
function parseStoredEnv(key: string, env: unknown): Record<string, string> | undefined {
  if (env === undefined) return undefined
  if (typeof env !== 'object' || env === null || Array.isArray(env)) {
    throw new TypeError(`credentials-os: stored record "${key}" has a non-mapping env`)
  }
  const parsed: Record<string, string> = {}
  for (const [name, value] of Object.entries(env as Record<string, unknown>)) {
    credentialRef(name)
    if (typeof value !== 'string' || value.length === 0) {
      throw new TypeError(`credentials-os: stored record "${key}" env "${name}" must be a non-empty string`)
    }
    parsed[name] = value
  }
  return parsed
}

/** OS-keychain credentials provider (`backend: os`), or file-store delegate (`backend: file`). */
export class OsCredentialProvider extends CredentialProvider {
  static Config: z<Config> = z.object({
    backend: z.union(['os', 'file'] as const).default('os'),
    service: z.string().default(DEFAULT_SERVICE),
    path: z.string(),
    dshHome: z.string(),
    watch: z.boolean().default(true),
    debounceMs: z.number().min(0).default(100),
  })

  private readonly spec: ResolvedSpec
  /** File-backend delegate; constructed only when `backend === 'file'`. */
  private readonly file: LocalCredentialProvider | undefined
  /** OS secret store; constructed only when `backend === 'os'`. */
  private readonly store: OsSecretStore | undefined
  /** Parsed reference snapshot for the OS backend. */
  private values = new Map<string, string>()
  /** Parsed record snapshot for the OS backend. */
  private records = new Map<string, CredentialRecord>()
  /** Exclusive operation chain for the OS backend. */
  private operations: Promise<void> = Promise.resolve()
  /** Set at dispose: refuse new writes and let in-flight work no-op. */
  private closed = false

  /**
   * @param ctx - plugin context.
   * @param config - plugin config; programmatic construction may bypass Schemastery.
   * @param store - OS secret store; tests inject {@link MemoryOsSecretStore}. Ignored when `backend === 'file'`.
   */
  constructor(ctx: Context, public config: Config, store?: OsSecretStore) {
    super(ctx)
    this.spec = resolveSpec(config)
    if (this.spec.backend === 'file') {
      this.file = new LocalCredentialProvider(ctx.isolate('credentials', FILE_BACKEND_SCOPE), {
        path: this.spec.filename,
        ...config.dshHome === undefined ? {} : { dshHome: config.dshHome },
        watch: this.spec.watch,
        debounceMs: this.spec.debounceMs,
      })
    } else {
      this.store = store ?? createPlatformOsSecretStore(this.spec.service)
    }
  }

  /** Opaque read of {@link closed}: control flow cannot narrow it across awaits. */
  private isClosed(): boolean {
    return this.closed
  }

  /** The inherited-environment value for a reference, or `undefined` when empty or unset. */
  private inherited(ref: CredentialRef): string | undefined {
    const entry = launchEnvironmentOf(this.ctx).getFrom(ref, ['process'])
    return entry !== undefined && entry.value.length > 0 ? entry.value : undefined
  }

  /**
   * The `.env` fallback for a reference — below the managed store, never above
   * it. The invoking project ranks over the user's home file.
   */
  private dotenvFallback(ref: CredentialRef): LaunchEnvironmentEntry | undefined {
    const entry = launchEnvironmentOf(this.ctx).getFrom(ref, ['project-env', 'user-env'])
    return entry !== undefined && entry.value.length > 0 ? entry : undefined
  }

  async* [Service.init](): AsyncGenerator<() => Promise<void> | void, void, void> {
    if (this.file !== undefined) {
      yield* this.file[Service.init]()
      return
    }
    yield async () => {
      this.closed = true
      await this.operations
    }
    await this.loadInitial()
  }

  override resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    if (this.file !== undefined) return this.file.resolve(ref)
    const inherited = this.inherited(ref)
    if (inherited !== undefined) return Promise.resolve({ value: inherited, source: 'env' })
    const stored = this.values.get(ref)
    if (stored !== undefined) return Promise.resolve({ value: stored, source: 'keychain' })
    const fallback = this.dotenvFallback(ref)
    if (fallback !== undefined) return Promise.resolve({ value: fallback.value, source: fallback.source })
    return Promise.resolve(undefined)
  }

  override describe(ref: CredentialRef): Promise<CredentialInfo> {
    if (this.file !== undefined) return this.file.describe(ref)
    if (this.inherited(ref) !== undefined) {
      return Promise.resolve({ configured: true, source: 'env', writable: false })
    }
    const stored = this.values.get(ref)
    if (stored !== undefined) return Promise.resolve({ configured: true, source: 'keychain', writable: true })
    const fallback = this.dotenvFallback(ref)
    if (fallback !== undefined) return Promise.resolve({ configured: true, source: fallback.source, writable: true })
    return Promise.resolve({ configured: false, writable: true })
  }

  override async set(ref: CredentialRef, value: string): Promise<void> {
    if (this.file !== undefined) {
      await this.file.set(ref, value)
      return
    }
    if (value.length === 0) {
      throw new Error(`credentials-os: an empty value cannot be stored for "${ref}"; use unset`)
    }
    await this.writeRef(ref, value)
  }

  override async unset(ref: CredentialRef): Promise<void> {
    if (this.file !== undefined) {
      await this.file.unset(ref)
      return
    }
    await this.writeRef(ref, undefined)
  }

  override readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> {
    if (this.file !== undefined) return this.file.readRecord(key)
    return Promise.resolve(this.records.get(key))
  }

  override describeRecord(key: CredentialKey): Promise<CredentialRecordInfo> {
    if (this.file !== undefined) return this.file.describeRecord(key)
    const stored = this.records.get(key)
    if (stored === undefined) return Promise.resolve({ configured: false, writable: true })
    return Promise.resolve({ configured: true, kind: stored.kind, writable: true })
  }

  override listRecords(): Promise<readonly CredentialRecordEntry[]> {
    if (this.file !== undefined) return this.file.listRecords()
    return Promise.resolve([...this.records].map(([key, record]) => ({
      key: parseCredentialKey(key),
      kind: record.kind,
    })))
  }

  override async modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    if (this.file !== undefined) return this.file.modifyRecord(key, mutate)
    if (this.isClosed()) throw new Error(`credentials-os is disposed: cannot modify "${key}"`)
    return this.enqueue(async () => {
      if (this.isClosed()) {
        throw new Error(`credentials-os was disposed before the queued "${key}" modify ran`)
      }
      await mkdir(dirname(this.spec.filename), { recursive: true, mode: 0o700 })
      return withFileLock(this.spec.filename, async () => {
        await this.reconcileFromDisk()
        const current = this.records.get(key)
        const next = await mutate(current)
        if (next === undefined) return current
        if (next.kind === 'grant') assertJsonValue(`record "${key}" payload`, next.payload, new Set())
        else assertStorableApiKey(key, next)
        const store = this.requireStore()
        await store.set(`${RECORD_ACCOUNT_PREFIX}${key}`, JSON.stringify(next))
        this.records.set(key, next)
        await this.persistIndex()
        this.notifyRecordUpdated(key)
        return next
      }, { waitMs: INDEX_LOCK_WAIT_MS })
    })
  }

  override async deleteRecord(key: CredentialKey): Promise<void> {
    if (this.file !== undefined) {
      await this.file.deleteRecord(key)
      return
    }
    if (this.isClosed()) throw new Error(`credentials-os is disposed: cannot delete "${key}"`)
    await this.enqueue(async () => {
      if (this.isClosed()) {
        throw new Error(`credentials-os was disposed before the queued "${key}" delete ran`)
      }
      await mkdir(dirname(this.spec.filename), { recursive: true, mode: 0o700 })
      await withFileLock(this.spec.filename, async () => {
        await this.reconcileFromDisk()
        if (!this.records.has(key)) return
        this.records.delete(key)
        await this.persistIndex()
        await this.requireStore().delete(`${RECORD_ACCOUNT_PREFIX}${key}`)
        this.notifyRecordUpdated(key)
      }, { waitMs: INDEX_LOCK_WAIT_MS })
    })
  }

  /** Queue one exclusive index operation behind every earlier one. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.operations.then(operation)
    this.operations = task.then(() => undefined, () => undefined)
    return task
  }

  /** The OS store; only called on the OS backend after construction. */
  private requireStore(): OsSecretStore {
    /* v8 ignore next -- OS backend always assigns store in the constructor */
    if (this.store === undefined) throw new Error('credentials-os: OS store is not active')
    return this.store
  }

  /** Queue one reference edit; entry checks reject early, the queue re-judges them at run time. */
  private async writeRef(ref: CredentialRef, value: string | undefined): Promise<void> {
    const verb = value === undefined ? 'unset' : 'set'
    if (this.isClosed()) {
      throw new Error(`credentials-os is disposed: cannot ${verb} "${ref}"`)
    }
    this.assertUnshadowed(ref, verb)
    return this.enqueue(async () => {
      if (this.isClosed()) {
        throw new Error(`credentials-os was disposed before the queued "${ref}" ${verb} ran`)
      }
      this.assertUnshadowed(ref, verb)
      await mkdir(dirname(this.spec.filename), { recursive: true, mode: 0o700 })
      await withFileLock(this.spec.filename, async () => {
        await this.reconcileFromDisk()
        const existing = this.values.get(ref)
        if (value === undefined && existing === undefined) return
        const store = this.requireStore()
        const account = `${REF_ACCOUNT_PREFIX}${ref}`
        if (value === undefined) {
          this.values.delete(ref)
          await this.persistIndex()
          await store.delete(account)
        } else {
          await store.set(account, value)
          this.values.set(ref, value)
          await this.persistIndex()
        }
        this.notifyUpdated(ref)
      }, { waitMs: INDEX_LOCK_WAIT_MS })
    })
  }

  /**
   * Reject a write the inherited environment would shadow into apparent
   * no-effect.
   */
  private assertUnshadowed(ref: CredentialRef, verb: 'set' | 'unset'): void {
    if (this.inherited(ref) !== undefined) {
      throw new Error(
        `credentials-os: "${ref}" is supplied read-only by the launching environment, so ${verb} would be`
        + ' shadowed; unset it in the shell you start dsh from instead',
      )
    }
  }

  /**
   * Boot read: an absent index is an empty store; an invalid one fails the
   * plugin's activation. Every indexed secret must still be present in the
   * OS store — an index that names a missing secret is not an empty store.
   */
  private async loadInitial(): Promise<void> {
    await assertOwnerOnly(this.spec.filename)
    let text: string
    try {
      text = await readFile(this.spec.filename, 'utf8')
    } catch (error) {
      if (!isENOENT(error)) throw error
      return
    }
    await this.applyIndex(parseCredentialsOsIndex(text, this.spec.filename))
  }

  /**
   * Re-read the index after a write lock is held, then reload secrets for
   * indexed entries from the OS store. Absence publishes the empty store.
   */
  private async reconcileFromDisk(): Promise<void> {
    await assertOwnerOnly(this.spec.filename)
    let text: string | undefined
    try {
      text = await readFile(this.spec.filename, 'utf8')
    } catch (error) {
      if (!isENOENT(error)) throw error
      text = undefined
    }
    /* v8 ignore next -- dispose drains the in-flight persist that already passed this check. */
    if (this.isClosed()) return
    const next = text === undefined
      ? { refs: new Set<string>(), records: new Map<string, CredentialRecord['kind']>() }
      : parseCredentialsOsIndex(text, this.spec.filename)
    await this.applyIndex(next)
  }

  /**
   * Replace in-memory snapshots from one parsed index plus OS-store reads.
   * @param index - reference names and record kinds currently on disk.
   */
  private async applyIndex(index: CredentialsOsIndex): Promise<void> {
    const store = this.requireStore()
    const values = new Map<string, string>()
    for (const name of index.refs) {
      const secret = await store.get(`${REF_ACCOUNT_PREFIX}${name}`)
      if (secret === undefined) {
        throw new Error(`credentials-os: index lists "${name}" but the OS store has no secret for it`)
      }
      values.set(name, secret)
    }
    const records = new Map<string, CredentialRecord>()
    for (const [key, kind] of index.records) {
      const raw = await store.get(`${RECORD_ACCOUNT_PREFIX}${key}`)
      if (raw === undefined) {
        throw new Error(`credentials-os: index lists record "${key}" but the OS store has no payload for it`)
      }
      const record = parseStoredRecord(key, raw)
      if (record.kind !== kind) {
        throw new Error(
          `credentials-os: index lists record "${key}" as ${kind} but the OS store holds ${record.kind}`,
        )
      }
      records.set(key, record)
    }
    this.values = values
    this.records = records
  }

  /**
   * Persist the current in-memory index. Secrets must already be in the OS
   * store for every listed entry; the index is written after those commits.
   */
  private async persistIndex(): Promise<void> {
    const index: CredentialsOsIndex = {
      refs: new Set(this.values.keys()),
      records: new Map([...this.records].map(([key, record]) => [key, record.kind])),
    }
    const text = renderCredentialsOsIndex(index)
    await writeFileAtomic(this.spec.filename, text, { mode: 0o600, dirMode: 0o700 })
  }
}

export default OsCredentialProvider
