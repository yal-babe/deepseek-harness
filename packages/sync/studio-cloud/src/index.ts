/** Independent Studio account service. Device grants remain in the Host credential provider. */
import { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { join } from 'node:path'
import { hostname } from 'node:os'
import { readFile } from 'node:fs/promises'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { createHash, randomUUID } from 'node:crypto'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { CredentialSync } from './credential-sync.ts'
import type {} from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { CloudSessions } from './cloud-sessions.ts'
import type { SessionSyncServices } from './cloud-sessions.ts'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-session'
import { CloudProjects } from './projects.ts'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { PersonalSync, type SyncConnection, type SyncContribution } from './sync-engine.ts'
import type {} from '@deepseek-ai/dsh-settings'
import { syncCategorySchema } from './sync-options.ts'
import { cloudOrigin, cloudRequest, cloudDownload, CloudError } from './transport.ts'
import type {
  StudioIdentity,
  StudioSyncCategory,
  StudioState,
  StudioPreviewRow,
  StudioHistoryItem,
  StudioHistoryView,
  StudioTokenActivity,
  StudioRestoredPlugin,
  StudioContinuationResult,
  PluginInventoryLike,
} from './types.ts'
export type * from './types.ts'
export type { SyncContribution } from './sync-engine.ts'

const key = credentialKey('studio-cloud', 'connection')
const identitySchema = z.object({
  id: z.uuid().transform(value => value as StudioIdentity['id']),
  username: z.string(),
  email: z.string().nullable(),
  displayName: z.string(),
  mustChangePassword: z.boolean(),
})
const stored = z.object({
  version: z.literal(1),
  origin: z.url(),
  identity: identitySchema,
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  refreshPending: z.boolean().default(false),
})
const tokens = z.object({ accessToken: z.string().min(1), refreshToken: z.string().min(1), expiresIn: z.number() })
const okay = z.object({ ok: z.literal(true) })
const capability = z.object({
  protocolVersion: z.literal(1),
  payloadVersions: z.array(z.number()),
  encryption: z.array(z.string()),
})
const storage = z.object({ usedBytes: z.number(), quotaBytes: z.number(), encryptionMode: z.enum(['plain', 'e2ee']) })

/** Deployment options; the service origin itself is selected by the login form. */
export interface Config {
  /** Per-request deadline, including account and sync reads. */
  requestTimeoutMs?: number
  /** Private account-scoped queue root; omission uses the Studio subdirectory of DSH_HOME. */
  stateDirectory?: string
  /** Continuous sync interval after explicit selection. */
  syncIntervalMs?: number
  /** Maximum bytes per immutable Session or attachment chunk. */
  sessionChunkBytes?: number
}
/** Request deadlines validated at plugin load. */
export const Config = Schema.object({
  requestTimeoutMs: Schema.number().min(1).max(120000).default(30000),
  stateDirectory: Schema.string().default(''),
  syncIntervalMs: Schema.number().min(1000).max(3600000).default(30000),
  sessionChunkBytes:Schema.number().min(65536).max(4194304).step(1).default(1048576),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    studioCloud: StudioCloud
  }
}

// Custom provider headers may contain credentials without schema secret annotations.
function syncPreference(value: z.infer<ReturnType<typeof z.json>>): z.infer<ReturnType<typeof z.json>> {
  if (Array.isArray(value)) return value.map(syncPreference)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value)
    .filter(([name]) => {
      const excluded =
        /^(?:headers|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization|private[_-]?key|env|environment)$/i
      return !excluded.test(name)
    })
    .map(([name, entry]) => [name, syncPreference(entry)]))
}

/** Host owner for Studio device login; signing out retains all local Session and provider data. */
export class StudioCloud extends TypertRemoteService {
  static inject = ['credentials']
  static Config = Config
  private readonly credentialSync: CredentialSync
  private readonly timeout: number
  private readonly directory: string
  private readonly owners = new Map<string, SyncContribution>()
  private readonly engines = new Map<string, PersonalSync>()
  private readonly projects = new Map<string, CloudProjects>()
  private readonly histories=new Map<string,CloudSessions>()
  private readonly chunkBytes:number
  private syncTail: Promise<unknown> = Promise.resolve()
  private syncFailure: string | null = null
  private lifetime = new AbortController()
  private readonly tasks = new Set<Promise<unknown>>()
  private refresh: Promise<z.infer<typeof stored>> | undefined
  private closed = false
  private readonly listeners = new Set<() => void>()
  /** @param ctx - Host with credential storage. @param config - request deadline. */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'studioCloud')
    this.credentialSync = new CredentialSync(ctx.credentials, () => {
      const llm = ctx.get('llm'), settings = ctx.get('settings')
      if (!llm || !settings) return []
      return llm.listConfigurableProviders().flatMap((provider) => {
        let value: unknown = settings.describe({ redactSecrets: true }).find(item => item.ns === provider.settingsNs)?.value
        for (const segment of provider.settingsPath) {
          const parsed = z.record(z.string(), z.unknown()).safeParse(value)
          value = parsed.success ? parsed.data[segment] : undefined
        }
        const parsed = z.object({ apiKeyEnv: z.string().min(1) }).safeParse(value)
        return parsed.success ? [credentialRef(parsed.data.apiKeyEnv)] : []
      })
    })
    for (const contribution of this.credentialSync.contributions()) ctx.effect(() => this.register(contribution))
    const resolved = Config(config)
    this.timeout = resolved.requestTimeoutMs
    this.chunkBytes=resolved.sessionChunkBytes
    this.directory = resolved.stateDirectory || join(resolveDshHome(), 'studio-cloud')
    ctx.inject(['settings'], (scope) => {
      const fields: Record<string, readonly string[]> = {
        'ui-theme': [
          'preference',
          'fontSize',
          'codeFontSize',
          'terminalFontSize',
          'textFontFamily',
          'codeFontFamily',
          'terminalFontFamily',
        ],
        locale: ['preference'],
        'ui-chat': ['transcriptView', 'performanceUsage', 'linkOpening'],
        'ui-settings': ['enabled'],
        'llm-pi-ai': ['providers'],
        'llm-antigravity': ['baseURL', 'apiKeyEnv'],
      }
      scope.effect(
        () =>
          this.register({
            namespace: 'studio.preferences',
            version: 1,
            fields: ['namespace', 'values'],
            export: () =>
              Promise.resolve(
                scope.settings.describe({ redactSecrets: true }).flatMap((item) => {
                  const allowed = fields[item.ns]
                  if (!allowed) return []
                  const source = z.record(z.string(), z.json()).parse(item.value),
                    values: Record<string, z.infer<ReturnType<typeof z.json>>> = {}
                  for (const field of allowed) {
                    const value = source[field]
                    if (Object.hasOwn(source, field) && value !== undefined) values[field] = syncPreference(value)
                  }
                  return [{ id: `preference:${item.ns}`, kind: 'preference', payload: { namespace: item.ns, values } }]
                }),
              ),
            import: async (item, signal) => {
              if (item.deleted) throw new CloudError('LOCAL_DELETE_CONFIRMATION_REQUIRED')
              const payload = z
                .object({ namespace: z.string(), values: z.record(z.string(), z.json()) })
                .parse(item.payload)
              const allowed = fields[payload.namespace]
              if (!allowed) throw new CloudError('UNSUPPORTED_PAYLOAD')
              const descriptor = scope.settings
                .describe({ redactSecrets: true })
                .find(value => value.ns === payload.namespace)
              if (!descriptor) throw new CloudError('LOCAL_COMPONENT_MISSING')
              const values: Record<string, z.infer<ReturnType<typeof z.json>>> = {}
              for (const field of allowed) {
                const value = payload.values[field]
                if (Object.hasOwn(payload.values, field) && value !== undefined) values[field] = syncPreference(value)
              }
              if (signal.aborted) throw new CloudError('CANCELLED')
              if (payload.namespace === 'llm-pi-ai') {
                const local = z.object({
                  providers: z.record(z.string(), z.record(z.string(), z.json())).optional(),
                }).parse(descriptor.value)
                const incoming = z.record(z.string(), z.record(z.string(), z.json())).parse(values.providers)
                for (const [name, provider] of Object.entries(incoming)) {
                  const headers = local.providers?.[name]?.headers
                  if (headers !== undefined) provider.headers = headers
                }
                values.providers = { ...local.providers, ...incoming }
              }
              await scope.settings.update(payload.namespace, values, descriptor.revision)
            },
          }),
        'Studio preference contribution',
      )
    })
    ctx.inject(['workspaceRegistry'], (scope) => {
      scope.effect(
        () =>
          this.register({
            namespace: 'studio.projects',
            version: 1,
            fields: ['title', 'order', 'sessions'],
            export: async () => {
              const record = await this.record()
              if (!record) return []
              return this.projectOwner(scope.workspaceRegistry, record).contribution().export()
            },
            import: async (value, signal) => {
              const record = await this.record()
              if (!record || signal.aborted) throw new CloudError('CANCELLED')
              await this.projectOwner(scope.workspaceRegistry, record).contribution().import(value, signal)
            },
          }),
        'Studio project contribution',
      )
    })
    ctx.inject(['sessionPersistence','attachments'],(scope)=>{
      const owner=async()=>{
        const record=await this.record()
        if(record===null)throw new CloudError('REAUTH_REQUIRED')
        return this.sessionOwner(record,{ persistence:scope.sessionPersistence,attachments:scope.attachments,sessions:scope.get('sessions') })
      }
      scope.effect(()=>this.register({ namespace:'studio.sessions',version:1,fields:['format','sessionFormatVersion','sourceSessionId',
        'parentSourceSessionId','inheritedEventCount','createdAt','throughSeq','title','chunks','attachments'],
      export:async (ids,signal)=>(await owner()).contribution().export(ids,signal),
      prepare:async(value,connection)=>{
        const contribution=(await owner()).contribution()
        if(contribution.prepare===undefined)throw new CloudError('LOCAL_COMPONENT_MISSING')
        await contribution.prepare(value,connection)
      },
      import:async(value,signal,connection)=>{
        signal.throwIfAborted()
        const contribution=(await owner()).contribution()
        signal.throwIfAborted()
        await contribution.import(value,signal,connection)
      },
      }),'Studio Session contribution')
    })
    ctx.effect(
      () =>
        this.register({
          namespace: 'studio.profile',
          version: 1,
          fields: ['displayName'],
          export: async () => {
            const record = await this.record()
            if (!record) return []
            return [
              {
                id: 'studio-profile',
                kind: 'profile',
                payload: { displayName: record.identity.displayName },
              },
            ]
          },
          import: async (item, signal) => {
            if (item.deleted) throw new CloudError('LOCAL_DELETE_CONFIRMATION_REQUIRED')
            const payload = z.object({ displayName: z.string().trim().max(120) }).parse(item.payload)
            const record = await this.record()
            if (!record || signal.aborted) throw new CloudError('CANCELLED')
            const updated = { ...record, identity: { ...record.identity, displayName: payload.displayName } }
            await this.ctx.credentials.modifyRecord(key, (current) => {
              if (signal.aborted || current?.kind !== 'grant') throw new CloudError('CANCELLED')
              return Promise.resolve({ kind: 'grant', payload: updated })
            })
            this.changed()
          },
        }),
      'Studio profile contribution',
    )
    ctx.effect(
      () =>
        this.register({
          namespace: 'studio.plugins',
          version: 1,
          fields: ['plugins'],
          export: async () => {
            const inventory = this.ctx.get('pluginInventory') as PluginInventoryLike | undefined
            let plugins: { moduleName: string; enabled: boolean; version?: string }[] = []
            if (inventory) {
              try {
                const snapshot = await inventory.list()
                plugins = snapshot.entries.map((e: { moduleName: string; enabled: boolean; meta?: { version?: string } }) => ({
                  moduleName: e.moduleName,
                  enabled: e.enabled,
                  ...(e.meta?.version ? { version: e.meta.version } : {}),
                }))
              } catch {
                plugins = []
              }
            }
            return [
              {
                id: 'studio-plugins',
                kind: 'plugin',
                payload: { plugins },
              },
            ]
          },
          import: async (item, signal) => {
            if (item.deleted) throw new CloudError('LOCAL_DELETE_CONFIRMATION_REQUIRED')
            if (signal.aborted) throw new CloudError('CANCELLED')
            const payload = z
              .object({
                plugins: z.array(
                  z.object({
                    moduleName: z.string(),
                    enabled: z.boolean(),
                    version: z.string().optional(),
                  }),
                ),
              })
              .parse(item.payload)
            await writeFileAtomic(
              join(this.directory, 'plugins.json'),
              `${JSON.stringify(payload.plugins)}\n`,
              { mode: 0o600, dirMode: 0o700 },
            )
          },
        }),
      'Studio plugins contribution',
    )
    ctx.effect(() => {
      const timer = setInterval(() => {
        void this.task(async () => {
          const record = await this.record()
          if (record) {
            const state = await this.engine(record).status()
            if (state.enabled && state.automatic) await this.synchronize()
          }
        }).catch((_reportedFailure: unknown) => {
          /* The account status retains syncFailure for the Retry action. */
        })
      }, resolved.syncIntervalMs)
      return () => {
        clearInterval(timer)
      }
    }, 'Studio continuous sync')
    ctx.on('credentials/record-updated', (updated) => {
      if (updated === key) this.changed()
    })
    ctx.effect(
      () => async () => {
        this.credentialSync.clear()
        this.closed = true
        this.changed()
        this.lifetime.abort()
        await Promise.allSettled(this.tasks)
      },
      'Studio account requests',
    )
  }
  private assertActive(signal: AbortSignal): void {
    if (signal.aborted) throw new CloudError('CANCELLED')
  }
  private changed(): void {
    for (const listener of this.listeners) listener()
  }
  /**
   * Observe account and synchronization status without exposing credentials.
   * @param signal - subscriber lifetime; disconnecting does not sign the account out.
   * @returns complete safe snapshots, including the initial state.
   */
  @Remote({ mode: 'stream' })
  async *watch(signal: AbortSignal): AsyncIterable<StudioState> {
    let dirty = true,
      wake: (() => void) | undefined
    const changed = () => {
      dirty = true
      wake?.()
    }
    this.listeners.add(changed)
    signal.addEventListener('abort', changed, { once: true })
    try {
      while (!this.closed && !signal.aborted) {
        if (dirty) {
          dirty = false
          yield await this.getState()
          continue
        }
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    } finally {
      this.listeners.delete(changed)
      signal.removeEventListener('abort', changed)
    }
  }
  private async record(): Promise<z.infer<typeof stored> | null> {
    const record = await this.ctx.credentials.readRecord(key)
    if (record === undefined) return null
    const result = record.kind === 'grant' ? stored.safeParse(record.payload) : null
    if (!result?.success) throw new CloudError('CREDENTIAL_STORAGE')
    return result.data
  }
  private task<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed)
      return Promise.reject(new RemoteError('studio-cloud/failed', 'Studio cloud unavailable', { code: 'CANCELLED' }))
    const task = work().catch((error: unknown) => {
      if (error instanceof CloudError)
        throw new RemoteError('studio-cloud/failed', 'Studio cloud operation failed', { code: error.code })
      throw error
    })
    this.tasks.add(task)
    void task.then(
      () => this.tasks.delete(task),
      () => this.tasks.delete(task),
    )
    return task
  }
  private call<T>(
    origin: string,
    path: string,
    schema: z.ZodType<T>,
    options: { method?: string; body?: object; token?: string } = {},
    lifetime = this.lifetime,
  ): Promise<T> {
    return cloudRequest(origin, path, { ...options, signal: lifetime.signal, timeoutMs: this.timeout }, schema)
  }
  private authenticated<T>(path: string, schema: z.ZodType<T>, options: { method?: string; body?: object } = {}): Promise<T> {
    return this.credentialRequest((connection, life) =>
      this.call(connection.origin, path, schema, { ...options, token: connection.accessToken }, life),
    )
  }
  private async credentialRequest<T>(read:(connection:z.infer<typeof stored>,life:AbortController)=>Promise<T>):Promise<T> {
    const life = this.lifetime
    const connection = await this.record()
    this.assertActive(life.signal)
    if (!connection || connection.refreshPending) throw new CloudError('REAUTH_REQUIRED')
    try {
      return await read(connection,life)
    } catch (error) {
      if (!(error instanceof CloudError) || error.status !== 401) throw error
      if (!this.refresh) {
        const pending = this.rotate(connection, life)
        this.refresh = pending
        void pending.then(
          () => {
            if (this.refresh === pending) this.refresh = undefined
          },
          () => {
            if (this.refresh === pending) this.refresh = undefined
          },
        )
      }
      const renewed = await this.refresh
      this.assertActive(life.signal)
      return read(renewed,life)
    }
  }
  private async rotate(connection: z.infer<typeof stored>, life: AbortController): Promise<z.infer<typeof stored>> {
    this.assertActive(life.signal)
    await this.ctx.credentials.modifyRecord(key, (current) => {
      if (
        life.signal.aborted ||
        current?.kind !== 'grant' ||
        stored.parse(current.payload).identity.id !== connection.identity.id ||
        stored.parse(current.payload).origin !== connection.origin
      )
        throw new CloudError('CANCELLED')
      return Promise.resolve({ kind: 'grant', payload: { ...connection, refreshPending: true } })
    })
    const renewed = await this.call(
      connection.origin,
      '/v1/auth/refresh',
      tokens,
      { method: 'POST', body: { refreshToken: connection.refreshToken } },
      life,
    )
    const next = { ...connection, ...renewed, refreshPending: false }
    await this.ctx.credentials.modifyRecord(key, (current) => {
      if (
        life.signal.aborted ||
        current?.kind !== 'grant' ||
        stored.parse(current.payload).identity.id !== connection.identity.id ||
        stored.parse(current.payload).origin !== connection.origin
      )
        throw new CloudError('CANCELLED')
      return Promise.resolve({ kind: 'grant', payload: next })
    })
    return next
  }
  /**
   * Register an owner-declared allowlist and importer; undeclared plugin data is never exported.
   * @param contribution - versioned contribution owned by the registering plugin.
   * @returns disposer; callers register it through their Cordis effect.
   */
  register(contribution: SyncContribution): () => void {
    if (this.owners.has(contribution.namespace))
      throw new Error(`Duplicate Studio contribution: ${contribution.namespace}`)
    this.owners.set(contribution.namespace, contribution)
    return () => {
      if (this.owners.get(contribution.namespace) === contribution) this.owners.delete(contribution.namespace)
    }
  }
  private projectOwner(registry: WorkspaceRegistry, record: z.infer<typeof stored>): CloudProjects {
    const key = JSON.stringify([record.origin, record.identity.id])
    let projects = this.projects.get(key)
    if (!projects) {
      projects = new CloudProjects(registry, this.directory, record.origin, record.identity.id)
      this.projects.set(key, projects)
    }
    return projects
  }
  /**
   * Read restored project metadata and its per-device binding requirements.
   * @returns cloud project titles and local registry IDs, without directory paths.
   */
  @Remote
  projectsToBind(): Promise<{ id: string; title: string; localId: string | null }[]> {
    return this.task(async () => {
      const record = await this.record(),
        scope = this.ctx.get('workspaceRegistry')
      if (!record || !scope) return []
      return this.projectOwner(scope, record).list()
    })
  }
  /**
   * Bind one restored cloud project to an existing directory-backed local workspace.
   * @param id - selected cloud project ID.
   * @param localId - workspace selected on this device.
   * @returns after the mapping is stored; no cloud request contains the local path.
   */
  @Remote({ resources: { workspace: (_id: string, localId: WorkspaceId) => localId } })
  bindProject(id: string, localId: WorkspaceId): Promise<void> {
    const life = this.lifetime
    return this.task(async () => {
      const record = await this.record()
      if (!record || life.signal.aborted) throw new CloudError('CANCELLED')
      const registry = this.ctx.get('workspaceRegistry')
      if (!registry) throw new CloudError('LOCAL_COMPONENT_MISSING')
      await this.projectOwner(registry, record).bind(id, localId, life.signal)
    })
  }
  /**
   * Remove binding between a cloud project and a local workspace.
   * @param id - selected cloud project ID.
   * @returns after the mapping is cleared.
   */
  @Remote
  unbindProject(id: string): Promise<void> {
    const life = this.lifetime
    return this.task(async () => {
      const record = await this.record()
      if (!record || life.signal.aborted) throw new CloudError('CANCELLED')
      const registry = this.ctx.get('workspaceRegistry')
      if (!registry) throw new CloudError('LOCAL_COMPONENT_MISSING')
      await this.projectOwner(registry, record).unbind(id, life.signal)
    })
  }
  private sessionOwner(record:z.infer<typeof stored>,services:SessionSyncServices):CloudSessions {
    const key=JSON.stringify([record.origin,record.identity.id])
    let owner=this.histories.get(key)
    if(owner===undefined) {
      const directory=join(this.directory,createHash('sha256').update(key).digest('hex'))
      owner=new CloudSessions(directory,services,this.chunkBytes)
      this.histories.set(key,owner)
    }
    return owner
  }
  private async currentHistories():Promise<CloudSessions> {
    const record=await this.record(),persistence=this.ctx.get('sessionPersistence'),attachments=this.ctx.get('attachments')
    if(record===null)throw new CloudError('REAUTH_REQUIRED')
    if(persistence===undefined || attachments===undefined)throw new CloudError('LOCAL_COMPONENT_MISSING')
    return this.sessionOwner(record,{ persistence,attachments,sessions:this.ctx.get('sessions') })
  }
  /**
   * List explicitly downloaded histories without contacting the server or creating Agents.
   * @returns account-isolated history metadata and missing attachment requirements.
   */
  @Remote
  historiesList():Promise<StudioHistoryItem[]> {return this.task(async()=> (await this.currentHistories()).list())}
  /**
   * Read a downloaded immutable history, including its canonical projected model messages.
   * @param id - history chosen from this account's downloaded list.
   * @returns read-only messages and required local restoration actions.
   */
  @Remote
  readHistory(id:string):Promise<StudioHistoryView> {return this.task(async()=> (await this.currentHistories()).read(id))}
  /**
   * Fork an immutable downloaded history into a new local branch session within a selected workspace.
   * @param id - cloud history object ID.
   * @param workspaceId - existing local workspace ID.
   * @param preset - optional agent preset ID.
   * @param requestId - optional idempotent request UUID.
   * @returns newly created child Session ID.
   */
  @Remote({ resources: { workspace: (_id: string, workspaceId: WorkspaceId) => workspaceId } })
  forkHistory(
    id: string,
    workspaceId: WorkspaceId,
    preset?: string,
    requestId?: string,
  ): Promise<StudioContinuationResult> {
    return this.task(async () => {
      const life = this.lifetime
      this.assertActive(life.signal)
      const registry = this.ctx.get('workspaceRegistry')
      if (!registry) throw new CloudError('LOCAL_COMPONENT_MISSING')
      const workspace = registry.get(workspaceId)
      if (!workspace) throw new CloudError('PROJECT_BINDING_REQUIRED')
      const histories = await this.currentHistories()
      this.assertActive(life.signal)
      return histories.fork(id, {
        workspace,
        ...(preset ? { preset } : {}),
        requestId: requestId ?? randomUUID(),
      })
    })
  }
  /**
   * Read aggregate deduplicated token usage across synchronized sessions.
   * @returns token metrics and turn counts.
   */
  @Remote
  tokenActivity(): Promise<StudioTokenActivity> {
    return this.task(async () => {
      const histories = await this.currentHistories()
      return histories.tokenActivity()
    })
  }
  /**
   * Update the account display name and trigger synchronization.
   * @param displayName - new display name.
   * @returns after updating local credentials and queueing sync.
   */
  @Remote
  updateProfile(displayName: string): Promise<void> {
    return this.task(async () => {
      const life = this.lifetime
      this.assertActive(life.signal)
      const trimmed = displayName.trim()
      if (!trimmed || trimmed.length > 120) throw new CloudError('INVALID_RESPONSE')
      const record = await this.record()
      if (!record) throw new CloudError('REAUTH_REQUIRED')
      const updated = { ...record, identity: { ...record.identity, displayName: trimmed } }
      await this.ctx.credentials.modifyRecord(key, (current) => {
        this.assertActive(life.signal)
        if (!current || current.kind !== 'grant') throw new CloudError('REAUTH_REQUIRED')
        return Promise.resolve({ kind: 'grant', payload: updated })
      })
      this.changed()
      if ((await this.engine(updated).status()).enabled) {
        void this.synchronize().catch(() => {})
      }
    })
  }
  /**
   * Read restored plugins recorded from cloud sync for user review.
   * @returns restored plugin list compared with current local inventory.
   */
  @Remote
  restoredPlugins(): Promise<StudioRestoredPlugin[]> {
    return this.task(async () => {
      let restored: { moduleName: string; enabled: boolean; version?: string }[] = []
      try {
        restored = JSON.parse(await readFile(join(this.directory, 'plugins.json'), 'utf8')) as typeof restored
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
        return []
      }
      const inventory = this.ctx.get('pluginInventory') as PluginInventoryLike | undefined
      let localModules = new Set<string>()
      if (inventory) {
        try {
          const snapshot = await inventory.list()
          localModules = new Set(snapshot.entries.map((e: { moduleName: string }) => e.moduleName))
        } catch {
          // ignore inventory read errors
        }
      }
      return restored.map(p => ({
        moduleName: p.moduleName,
        enabled: p.enabled,
        installed: localModules.has(p.moduleName),
        ...(p.version ? { version: p.version } : {}),
      }))
    })
  }
  private engine(record: z.infer<typeof stored>): PersonalSync {
    const key = JSON.stringify([record.origin, record.identity.id])
    let engine = this.engines.get(key)
    if (!engine) {
      engine = new PersonalSync(this.directory, record.origin, record.identity.id, this.owners)
      this.engines.set(key, engine)
    }
    return engine
  }
  private serialized<T>(work: (engine: PersonalSync, connection: SyncConnection) => Promise<T>): Promise<T> {
    const life = this.lifetime
    const result = this.syncTail
      .then(async () => {
        this.assertActive(life.signal)
        const record = await this.record()
        if (!record) throw new CloudError('REAUTH_REQUIRED')
        this.credentialSync.bind(JSON.stringify([record.origin, record.identity.id]))
        const space = await this.authenticated('/v1/me/storage', storage)
        if (space.encryptionMode !== 'plain') throw new CloudError('E2EE_UNSUPPORTED')
        return work(this.engine(record), {
          signal: life.signal,
          download: async (path, maxBytes) => {
            this.assertActive(life.signal)
            const bytes = await this.credentialRequest((record, requestLife) =>
              cloudDownload(record.origin, path, record.accessToken, requestLife.signal, this.timeout, maxBytes),
            )
            this.assertActive(life.signal)
            return bytes
          },
          request: async (path, schema, options) => {
            this.assertActive(life.signal)
            const value = await this.authenticated(path, schema, options)
            this.assertActive(life.signal)
            return value
          },
        })
      })
      .catch((error: unknown) => {
        if (error instanceof CloudError && !life.signal.aborted) this.syncFailure = error.code
        throw error
      })
    void result.then(
      () => {
        this.changed()
      },
      () => {
        this.changed()
      },
    )
    this.syncTail = result.catch(() => undefined)
    return this.task(() => result)
  }
  /** Unlock encrypted model credentials locally, then retry deferred cloud downloads.
   * @param passphrase - independent sync secret; never transmitted to the server.
   */
  @Remote
  unlockCredentials(passphrase: string): Promise<void> {
    return this.serialized(async (engine, connection) => {
      await this.credentialSync.unlock(passphrase)
      if (connection.signal.aborted) { this.credentialSync.clear(); throw new CloudError('CANCELLED') }
      await engine.download(connection, true)
      if (this.credentialSync.locked) throw new CloudError('CREDENTIALS_KEY_INVALID')
      this.syncFailure = null
    })
  }
  /** Download cloud data without granting upload permission. */
  @Remote
  download(): Promise<void> {
    return this.serialized(async (engine, connection) => {
      await engine.download(connection)
      this.syncFailure = null
    })
  }
  /** Configure explicit upload categories and automatic synchronization.
   * @param categories - selected data owners allowed to upload.
   * @param automatic - whether the background timer may synchronize.
   */
  @Remote
  configureSync(categories: StudioSyncCategory[], automatic: boolean): Promise<void> {
    const selected = z.array(syncCategorySchema).parse(categories)
    return this.serialized(async (engine, connection) => {
      if (this.credentialSync.locked && selected.some(value => ['deepseek', 'codex', 'antigravity', 'api-keys'].includes(value))) throw new CloudError('CREDENTIALS_LOCKED')
      await engine.configure(selected, automatic, connection)
      this.syncFailure = null
    })
  }
  /**
   * Preview local allowlisted data and the current cloud snapshot without uploading.
   * @returns local/cloud values and supported-version markers for explicit selection.
   */
  @Remote
  preview(): Promise<StudioPreviewRow[]> {
    return this.serialized((engine, connection) => engine.preview(connection))
  }
  /**
   * Confirm the selected data and enable future sync for those objects only.
   * @param choices - preview object IDs, expected cloud versions, and chosen local or cloud source.
   * @returns after selected imports and uploads; conflicts retain both values.
   */
  @Remote
  select(choices: { id: string; source: 'local' | 'cloud'; version: number }[]): Promise<void> {
    return this.serialized(async (engine, connection) => {
      await engine.select(choices, connection)
      this.syncFailure = null
    })
  }
  /**
   * Retry queued immutable requests and synchronize opted-in objects.
   * @returns after the selected objects settle; failures remain visible in account status.
   */
  @Remote
  synchronize(): Promise<void> {
    return this.serialized(async (engine, connection) => {
      await engine.synchronize(connection)
      this.syncFailure = null
    })
  }
  /**
   * Pause or resume future syncing without deleting local or cloud data.
   * @param paused - whether syncing is stopped.
   * @returns after the choice is persisted for this account.
   */
  @Remote
  pause(paused: boolean): Promise<void> {
    return this.serialized(engine => engine.pause(paused))
  }
  /**
   * Read safe connection status; no local data is uploaded by this method.
   * @returns signed-out, preview-required, unsupported, or reauthentication state.
   */
  @Remote
  getState(): Promise<StudioState> {
    return this.task(async () => {
      const life = this.lifetime
      const record = await this.record()
      this.assertActive(life.signal)
      if (!record)
        return { origin: '', identity: null, phase: 'signed-out', usedBytes: null, quotaBytes: null, pending: 0 }
      if (record.refreshPending)
        return {
          origin: record.origin,
          identity: record.identity,
          phase: 'reauth-required',
          usedBytes: null,
          quotaBytes: null,
          pending: 0,
        }
      if (record.identity.mustChangePassword)
        return {
          origin: record.origin,
          identity: record.identity,
          phase: 'preview-required',
          usedBytes: null,
          quotaBytes: null,
          pending: 0,
        }
      const space = await this.authenticated('/v1/me/storage', storage)
      const sync = await this.engine(record).status()
      this.assertActive(life.signal)
      return {
        origin: record.origin,
        identity: record.identity,
        phase:
          space.encryptionMode !== 'plain'
            ? 'unsupported'
            : this.syncFailure === 'VERSION_CONFLICT'
              ? 'conflict'
              : sync.enabled
                ? 'ready'
                : sync.selectedCount
                  ? 'paused'
                  : 'preview-required',
        usedBytes: space.usedBytes,
        quotaBytes: space.quotaBytes,
        pending: sync.pending,
        uploadCategories: sync.categories,
        automatic: sync.automatic,
        credentialsLocked: this.credentialSync.locked,
        ...(this.syncFailure ? { failureCode: this.syncFailure } : {}),
      }
    })
  }
  /**
   * Sign in to an explicitly selected server; this never enables synchronization.
   * @param origin - root service URL.
   * @param login - username or verified email.
   * @param password - transient password, never persisted.
   * @param deviceName - name displayed in device management.
   * @param allowHttp - explicit acceptance of an unencrypted deployment connection.
   * @returns safe account identity; temporary accounts must change their password first.
   */
  @Remote
  signIn(
    origin: string,
    login: string,
    password: string,
    deviceName: string,
    allowHttp: boolean,
  ): Promise<StudioIdentity> {
    this.credentialSync.clear()
    this.lifetime.abort()
    this.lifetime = new AbortController()
    this.refresh = undefined
    const life = this.lifetime
    return this.task(async () => {
      const address = cloudOrigin(origin, allowHttp)
      await this.call(address, '/v1/capabilities', capability, {}, life)
      const grant = await this.call(
        address,
        '/v1/auth/login',
        tokens,
        { method: 'POST', body: { login, password, deviceName: deviceName.trim() || hostname(), client: 'device' } },
        life,
      )
      const user = await this.call(address, '/v1/auth/session', identitySchema, { token: grant.accessToken }, life)
      await this.ctx.credentials.modifyRecord(key, () => {
        this.assertActive(life.signal)
        return Promise.resolve({
          kind: 'grant',
          payload: { version: 1, origin: address, identity: user, ...grant, refreshPending: false },
        })
      })
      this.changed()
      if (!user.mustChangePassword) {
        try { await this.download() }
        catch (error) {
          this.syncFailure = error instanceof RemoteError ? 'DOWNLOAD_FAILED' : 'NETWORK'
          this.changed()
        }
      }
      return user
    })
  }
  /**
   * Stop outstanding account operations and remove the local grant before attempting remote revocation.
   * @returns whether server revocation was confirmed; false requires revoking this device from another login.
   */
  @Remote
  signOut(): Promise<{ revoked: boolean }> {
    this.credentialSync.clear()
    this.lifetime.abort()
    this.lifetime = new AbortController()
    const life = this.lifetime
    return this.task(async () => {
      const record = await this.record()
      this.assertActive(life.signal)
      await this.ctx.credentials.deleteRecord(key)
      if (!record) return { revoked: true }
      try {
        await this.call(
          record.origin,
          '/v1/auth/logout',
          okay,
          { method: 'POST', body: {}, token: record.accessToken },
          life,
        )
        return { revoked: true }
      } catch (error) {
        if (error instanceof CloudError) return { revoked: false }
        throw error
      }
    })
  }
  /**
   * Read authorized devices, including the current device marker.
   * @returns safe device records.
   */
  @Remote
  devices(): Promise<{ id: string; deviceName: string; current: boolean; lastSeen: string }[]> {
    return this.task(() =>
      this.authenticated(
        '/v1/me/devices',
        z.array(
          z
            .object({ id: z.uuid(), device_name: z.string(), current: z.boolean(), last_seen: z.string() })
            .transform(row => ({
              id: row.id,
              deviceName: row.device_name,
              current: row.current,
              lastSeen: row.last_seen,
            })),
        ),
      ),
    )
  }
  /**
   * Revoke one device; revoking this device also clears its local grant.
   * @param id - server-issued device ID selected from devices.
   * @returns after revocation is confirmed.
   */
  @Remote
  revokeDevice(id: string): Promise<void> {
    return this.task(async () => {
      const devices = await this.authenticated(
        '/v1/me/devices',
        z.array(z.object({ id: z.uuid(), current: z.boolean() })),
      )
      await this.authenticated(`/v1/me/devices/${z.uuid().parse(id)}`, okay, { method: 'DELETE' })
      if (devices.some(device => device.id === id && device.current)) {
        this.credentialSync.clear()
        this.lifetime.abort()
        this.lifetime = new AbortController()
        await this.ctx.credentials.deleteRecord(key)
      }
    })
  }
  /**
   * Accept an invitation without signing in or enabling sync.
   * @param origin - explicitly selected service URL.
   * @param token - single-use invitation token.
   * @param username - requested account name.
   * @param password - initial transient password.
   * @param allowHttp - explicit HTTP consent.
   * @returns after server acceptance.
   */
  @Remote
  acceptInvite(origin: string, token: string, username: string, password: string, allowHttp: boolean): Promise<void> {
    return this.task(async () => {
      await this.call(cloudOrigin(origin, allowHttp), '/v1/auth/accept-invite', okay, {
        method: 'POST',
        body: { token, username, password },
      })
    })
  }
  /**
   * Request a reset mail; the server deliberately does not reveal account existence.
   * @param origin - selected service URL.
   * @param email - verified address.
   * @param allowHttp - explicit HTTP consent.
   * @returns after the request is accepted.
   */
  @Remote
  forgotPassword(origin: string, email: string, allowHttp: boolean): Promise<void> {
    return this.task(async () => {
      await this.call(cloudOrigin(origin, allowHttp), '/v1/auth/forgot-password', okay, {
        method: 'POST',
        body: { email },
      })
    })
  }
  /**
   * Consume a password-reset token; existing sessions are revoked by the server.
   * @param origin - selected service URL.
   * @param token - one-time mail token.
   * @param password - replacement transient password.
   * @param allowHttp - explicit HTTP consent.
   * @returns after password reset is confirmed.
   */
  @Remote
  resetPassword(origin: string, token: string, password: string, allowHttp: boolean): Promise<void> {
    return this.task(async () => {
      await this.call(cloudOrigin(origin, allowHttp), '/v1/auth/reset-password', okay, {
        method: 'POST',
        body: { token, password },
      })
    })
  }
  /**
   * Verify a one-time email token at its explicitly selected issuer.
   * @param origin - selected service URL.
   * @param token - email verification token.
   * @param allowHttp - explicit HTTP consent.
   * @returns after email verification is confirmed.
   */
  @Remote
  verifyEmail(origin: string, token: string, allowHttp: boolean): Promise<void> {
    return this.task(async () => {
      await this.call(cloudOrigin(origin, allowHttp), '/v1/auth/verify-email', okay, {
        method: 'POST',
        body: { token },
      })
    })
  }
  /**
   * Request verification before changing the signed-in account email.
   * @param email - proposed address.
   * @param password - current transient password.
   * @returns after the verification request is accepted.
   */
  @Remote
  bindEmail(email: string, password: string): Promise<void> {
    return this.task(async () => {
      await this.authenticated('/v1/me/email', okay, { method: 'POST', body: { email, password } })
    })
  }
  /**
   * Change an initial or current password. Server success invalidates all device grants.
   * @param currentPassword - current transient password.
   * @param newPassword - replacement transient password.
   * @returns after local credentials are cleared; a lost response requires signing in again.
   */
  @Remote
  changePassword(currentPassword: string, newPassword: string): Promise<void> {
    return this.task(async () => {
      await this.authenticated('/v1/me/password', okay, { method: 'POST', body: { currentPassword, newPassword } })
      this.credentialSync.clear()
      this.lifetime.abort()
      this.lifetime = new AbortController()
      await this.ctx.credentials.deleteRecord(key)
    })
  }
}
export default StudioCloud
