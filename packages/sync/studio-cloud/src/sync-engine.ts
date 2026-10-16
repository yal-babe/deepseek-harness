/** Durable, account-scoped object synchronization; initial selection and conflicts always require a choice. */
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { redactJsonValue } from '@deepseek-ai/dsh-sync-protocol'
import { CloudError } from './transport.ts'
import type { StudioPreviewRow } from './types.ts'

const object = z.object({
  id: z.string(),
  kind: z.enum(['profile', 'preference', 'project', 'conversation', 'plugin']),
  parentId: z.string().nullable(),
  namespace: z.string().nullable(),
  version: z.number().int(),
  formatVersion: z.number().int(),
  encrypted: z.boolean(),
  payload: z.json(),
  deleted: z.boolean(),
  fileRefs: z.array(z.string()).default([]),
})
/** Deserialized object record payload. */
export type ObjectValue = z.infer<typeof object>
const stateSchema = z.object({
  version: z.literal(1),
  enabled: z.boolean(),
  selected: z.array(z.string()),
  cursor: z.string().nullable(),
  known: z.record(z.string(), object),
  queue: z.array(
    z.object({
      requestId: z.uuid(),
      changes: z.array(object.omit({ version: true }).extend({ baseVersion: z.number().int() })),
    }),
  ),
})
type State = z.infer<typeof stateSchema>
/** Owner-declared data that can be exported and imported independently of device secrets. */
export interface SyncContribution {
  /** Stable namespace identifying the data owner, never a filesystem path. */
  namespace: string
  /** Payload version accepted by import; unknown versions are not imported. */
  version: number
  /** Exact top-level fields allowed to leave the device. */
  fields: readonly string[]
  /** @returns complete local objects containing only this owner's data. */
  export: (ids?:readonly string[],signal?:AbortSignal) => Promise<
    { id: string; kind: ObjectValue['kind']; blocked?:boolean; fileRefs?:string[]; payload: Record<string, z.infer<ReturnType<typeof z.json>>> }[]
  >
  /** Prepare files only after selection; references become publishable after complete integrity checks.
   * @param value - allowlisted local object selected for upload.
   * @param connection - account-bound transport.
   * @returns after all referenced files are complete; the queued request itself stays unchanged.
   */
  prepare?: (value:ObjectValue,connection:SyncConnection)=>Promise<void>
  /** @param value - validated supported-version cloud object selected by the user. */
  import: (value: ObjectValue, signal: AbortSignal, connection?:SyncConnection) => Promise<void>
}
/** Local and cloud values are both retained in the preview until the user chooses. */
export type PreviewRow = StudioPreviewRow
/** Transport already bound to one origin, account, and cancellation lifetime. */
export interface SyncConnection {
  request: <T>(path: string, schema: z.ZodType<T>, options?: { method?: string; body?: object }) => Promise<T>
  signal: AbortSignal
  download?:(path:string,maxBytes:number)=>Promise<Uint8Array>
}

/** Account-isolated durable engine. Caller serializes methods and owns periodic scheduling. */
export class PersonalSync {
  private state: State | undefined
  private previewObjects = new Map<string, ObjectValue>()
  private previewLocal=new Map<string,ObjectValue>()
  private previewCursor:string|null=null
  private readonly blockedLocal=new Set<string>()
  /**
   * @param directory - private local root.
   * @param origin - issuer origin.
   * @param user - issuer account.
   * @param owners - live contribution registry.
   */
  constructor(
    private readonly directory: string,
    private readonly origin: string,
    private readonly user: string,
    private readonly owners: ReadonlyMap<string, SyncContribution>,
  ) {}
  private path(): string {
    return join(
      this.directory,
      createHash('sha256')
        .update(JSON.stringify([this.origin, this.user]))
        .digest('hex'),
      'state.json',
    )
  }
  private async load(): Promise<State> {
    if (this.state) return this.state
    try {
      this.state = stateSchema.parse(JSON.parse(await readFile(this.path(), 'utf8')))
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      this.state = { version: 1, enabled: false, selected: [], cursor: null, known: {}, queue: [] }
    }
    return this.state
  }
  private async save(): Promise<void> {
    await writeFileAtomic(this.path(), `${JSON.stringify(this.state)}\n`, { mode: 0o600, dirMode: 0o700 })
  }
  /**
   * Read the current sync engine status.
   * @returns Durable opt-in and pending operation counts without making network requests.
   */
  async status(): Promise<{ enabled: boolean; pending: number; selectedCount: number }> {
    const state = await this.load()
    return { enabled: state.enabled, pending: state.queue.length, selectedCount: state.selected.length }
  }
  private async local(ids?:readonly string[],signal?:AbortSignal): Promise<Map<string, ObjectValue>> {
    const local = new Map<string, ObjectValue>()
    this.blockedLocal.clear()
    for (const owner of this.owners.values())
      for (const item of await owner.export(ids,signal)) {
        const payload: Record<string, z.infer<ReturnType<typeof z.json>>> = {}
        for (const field of owner.fields) {
          const value = item.payload[field]
          if (Object.hasOwn(item.payload, field) && value !== undefined) payload[field] = value
        }
        const filtered = z.json().parse(redactJsonValue(payload))
        if(item.blocked===true)this.blockedLocal.add(item.id)
        local.set(item.id, {
          id:item.id,kind:item.kind,
          namespace: owner.namespace,
          parentId: null,
          version: 0,
          formatVersion: owner.version,
          encrypted: false,
          payload: filtered,
          deleted: false,
          fileRefs: item.fileRefs ?? [],
        })
      }
    return local
  }
  private async cloud(connection: SyncConnection): Promise<{ objects: Map<string, ObjectValue>; cursor: string }> {
    const objects = new Map<string, ObjectValue>()
    let query = '?limit=1',
      cursor = '',
      more = true,
      after: string | null = null
    while (more) {
      const page = await connection.request(
        `/v1/sync/snapshot${query}`,
        z.object({
          snapshot: z.uuid(),
          items: z.array(object),
          hasMore: z.boolean(),
          after: z.string().nullable(),
          cursor: z.string(),
        }),
      )
      for (const item of page.items) objects.set(item.id, item)
      if (page.hasMore && (page.after === null || page.after === after)) throw new CloudError('INVALID_RESPONSE')
      after = page.after
      more = page.hasMore
      cursor = page.cursor
      query = `?snapshot=${page.snapshot}&after=${encodeURIComponent(page.after ?? '')}&limit=1`
      if (connection.signal.aborted) throw new CloudError('CANCELLED')
    }
    return { objects, cursor }
  }
  private async import(owner: SyncContribution, value: ObjectValue, signal: AbortSignal,connection:SyncConnection): Promise<void> {
    const fields = z.record(z.string(), z.json()).parse(value.payload)
    const payload: Record<string, z.infer<ReturnType<typeof z.json>>> = {}
    for (const field of owner.fields) {
      const entry = fields[field]
      if (Object.hasOwn(fields, field) && entry !== undefined) payload[field] = entry
    }
    if (signal.aborted) throw new CloudError('CANCELLED')
    await owner.import({ ...value, payload }, signal,connection)
  }
  private async incremental(
    connection: SyncConnection,
    state: State,
  ): Promise<{ objects: Map<string, ObjectValue>; cursor: string }> {
    if (state.cursor === null) return this.cloud(connection)
    const objects = new Map(Object.entries(state.known))
    let cursor = state.cursor,
      more = true
    while (more) {
      const page = await connection.request(
        `/v1/sync/pull?cursor=${encodeURIComponent(cursor)}`,
        z.object({
          changes: z.array(z.object({ value: object })),
          hasMore: z.boolean(),
          cursor: z.string(),
        }),
      )
      for (const change of page.changes) objects.set(change.value.id, change.value)
      cursor = page.cursor
      more = page.hasMore
      if (connection.signal.aborted) throw new CloudError('CANCELLED')
    }
    return { objects, cursor }
  }
  /**
   * Download a consistent snapshot before presenting local/cloud values; never writes local owner data.
   * @param connection - current account transport.
   * @returns selectable rows; unsupported payload versions remain visible but cannot be imported.
   */
  async preview(connection: SyncConnection): Promise<PreviewRow[]> {
    const local = await this.local(undefined,connection.signal),
      cloud = await this.cloud(connection)
    this.previewObjects = cloud.objects
    this.previewLocal=local
    this.previewCursor=cloud.cursor
    const rows: PreviewRow[] = []
    for (const id of new Set([...local.keys(), ...cloud.objects.keys()])) {
      const here = local.get(id),
        there = cloud.objects.get(id),
        value = here ?? there
      if (value === undefined) throw new CloudError('INVALID_RESPONSE')
      const owner = this.owners.get(value.namespace ?? '')
      rows.push({
        id,
        kind: value.kind,
        namespace: value.namespace,
        local: here ? JSON.stringify(here.payload) : null,
        cloud: there ? JSON.stringify(there.payload) : null,
        version: there?.version ?? 0,
        conflict:
          here !== undefined && there !== undefined && JSON.stringify(here.payload) !== JSON.stringify(there.payload),
        supported:
          owner !== undefined && !this.blockedLocal.has(id) && (!there || (!there.encrypted && there.formatVersion === owner.version)),
      })
    }
    return rows
  }
  /**
   * Apply an explicit selection against the previewed cloud versions; 409 leaves the request queued for conflict resolution.
   * @param choices - each object chooses local upload or cloud import; omitted objects stay unsynchronized.
   * @param connection - account-bound transport.
   * @returns after selected imports and durable uploads have completed.
   */
  async select(
    choices: { id: string; source: 'local' | 'cloud'; version: number }[],
    connection: SyncConnection,
  ): Promise<void> {
    if(this.previewCursor===null)throw new CloudError('PREVIEW_REQUIRED')
    const state = await this.load(),
      local = await this.local(undefined,connection.signal)
    for(const choice of choices) {
      if(JSON.stringify(this.previewLocal.get(choice.id)?.payload)!==JSON.stringify(local.get(choice.id)?.payload))throw new CloudError('PREVIEW_STALE')
    }
    state.cursor=null
    state.enabled = false
    state.queue = []
    state.selected = []
    await this.save()
    const selected: string[] = []
    for (const choice of choices) {
      const there = this.previewObjects.get(choice.id)
      if ((there?.version ?? 0) !== choice.version) throw new CloudError('PREVIEW_STALE')
      const value = choice.source === 'cloud' ? there : local.get(choice.id)
      if (!value) throw new CloudError('PREVIEW_STALE')
      if(choice.source==='local' && this.blockedLocal.has(choice.id))throw new CloudError('LOCAL_SESSION_MIGRATION_REQUIRED')
      const owner = this.owners.get(value.namespace ?? '')
      if (!owner || value.encrypted || value.formatVersion !== owner.version)
        throw new CloudError('UNSUPPORTED_PAYLOAD')
      if (connection.signal.aborted) throw new CloudError('CANCELLED')
      if (choice.source === 'cloud') {
        await this.import(owner, value, connection.signal,connection)
        state.known[value.id] = value
      } else {
        const { version: _local, ...change } = value
        state.queue.push({ requestId: randomUUID(), changes: [{ ...change, baseVersion: choice.version }] })
      }
      selected.push(choice.id)
      await this.save()
    }
    state.selected = selected
    state.enabled = true
    await this.save()
    await this.flush(connection)
    state.cursor=this.previewCursor
    await this.save()
  }
  private async flush(connection: SyncConnection): Promise<void> {
    const state = await this.load()
    while (state.queue.length) {
      const [request] = state.queue
      if (request === undefined) throw new CloudError('INVALID_QUEUE')
      for(const change of request.changes) {
        const owner=this.owners.get(change.namespace ?? '')
        if(owner===undefined || owner.version!==change.formatVersion)throw new CloudError('LOCAL_COMPONENT_MISSING')
        if(owner.prepare!==undefined)await owner.prepare({ ...change,version:change.baseVersion },connection)
      }
      const result = await connection.request(
        '/v1/sync/push',
        z.object({ versions: z.array(z.object({ id: z.string(), version: z.number() })), cursor: z.string() }),
        { method: 'POST', body: request },
      )
      if (connection.signal.aborted) throw new CloudError('CANCELLED')
      for (const change of request.changes) {
        const version = result.versions.find(value => value.id === change.id)?.version
        if (version === undefined) throw new CloudError('INVALID_RESPONSE')
        const { baseVersion: _base, ...value } = change
        state.known[change.id] = { ...value, version }
      }
      state.queue.shift()
      // Upload cursors never skip cloud changes this device has not imported.
      await this.save()
    }
  }
  /**
   * Synchronize opted-in objects. Conflicting local/cloud edits stop before either is overwritten.
   * @param connection - current account transport.
   * @returns after imports and queued uploads; failure retains the previous cursor and immutable requests.
   */
  async synchronize(connection: SyncConnection): Promise<void> {
    const state = await this.load()
    if (!state.enabled) return
    await this.flush(connection)
    const local = await this.local(state.selected,connection.signal),
      cloud = await this.incremental(connection, state)
    for (const id of state.selected) {
      if (connection.signal.aborted) throw new CloudError('CANCELLED')
      const here = local.get(id),
        there = cloud.objects.get(id),
        known = state.known[id]
      const localChanged = here !== undefined && JSON.stringify(here.payload) !== JSON.stringify(known?.payload)
      const remoteChanged = there !== undefined && there.version !== (known?.version ?? 0)
      if (localChanged && remoteChanged && JSON.stringify(here.payload) === JSON.stringify(there.payload)) {
        state.known[id] = there
        await this.save()
        continue
      }
      if (localChanged && remoteChanged) throw new CloudError('VERSION_CONFLICT', 409)
      if (remoteChanged) {
        const owner = this.owners.get(there.namespace ?? '')
        if (!owner || there.formatVersion !== owner.version || there.encrypted)
          throw new CloudError('UNSUPPORTED_PAYLOAD')
        await this.import(owner, there, connection.signal,connection)
        state.known[id] = there
        await this.save()
      } else if (localChanged) {
        const { version: _version, ...value } = here
        state.queue.push({ requestId: randomUUID(), changes: [{ ...value, baseVersion: known?.version ?? 0 }] })
        await this.save()
      }
    }
    await this.flush(connection)
    state.cursor = cloud.cursor
    await this.save()
  }
  /**
   * Pause or resume synchronization.
   * @param paused - Stop or resume future synchronization without deleting data.
   */
  async pause(paused: boolean): Promise<void> {
    const state = await this.load()
    if (!paused && !state.selected.length) throw new CloudError('PREVIEW_REQUIRED')
    state.enabled = !paused
    await this.save()
  }
}
