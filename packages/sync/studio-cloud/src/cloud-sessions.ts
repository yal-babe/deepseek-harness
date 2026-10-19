import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { SessionStore } from '@deepseek-ai/dsh-session'
import type { AttachmentStore, FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { AttachmentId, isAttachmentError } from '@deepseek-ai/dsh-attachment'
import { collectSessionAttachments } from '@deepseek-ai/dsh-session-log-export'
import { buildForkSeed } from '@deepseek-ai/dsh-session/fork'
import { SessionId, SessionSeq, SessionLogOffset, SESSION_FORMAT_VERSION, type SessionHeader, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { CloudFiles, cloudFileSchema, type CloudFileRef } from './cloud-files.ts'
import { encodeCompletedSession, restoreCloudSession } from './session-codec.ts'
import type { SyncConnection, SyncContribution } from './sync-engine.ts'
import { CloudError } from './transport.ts'
import type { StudioHistoryView, StudioHistoryItem, StudioTokenActivity, StudioContinuationResult } from './types.ts'
import { calculateTokenActivity } from './token-usage.ts'
import { resolveUsageSources, type UsageSourceLog, type UsageSourceRange } from '@deepseek-ai/dsh-token-meter'

import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-working-directory'

const imageRef=z.object({ attachmentId:z.string().min(1).transform(AttachmentId),mediaType:z.enum(['image/png','image/jpeg','image/webp','image/gif']),
  bytes:z.number().int().nonnegative(),width:z.number().int().positive(),height:z.number().int().positive(),name:z.string().optional(),
  originalDimensions:z.object({ width:z.number().int().positive(),height:z.number().int().positive() }).optional(),
}).strict()
const fileRef = z.object({
  attachmentId: z.string().min(1).transform(AttachmentId),
  name: z.string(),
  bytes: z.number().int().nonnegative(),
}).strict()
const attachment = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('image'), ref: imageRef, chunks: z.array(cloudFileSchema), unavailable: z.string().optional() }).strict(),
  z.object({ kind: z.literal('file'), ref: fileRef, chunks: z.array(cloudFileSchema), unavailable: z.string().optional() }).strict(),
])
/** Version-one selected conversation payload; all file locations are account-owned cloud IDs. */
const legacyCloudSessionSchema = z.object({
  format: z.literal('dsh-session-1'),
  sessionFormatVersion: z.number().int().nonnegative(),
  sourceSessionId: z.string().min(1),
  parentSourceSessionId: z.string().nullable(),
  inheritedEventCount: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  throughSeq: z.number().int().nonnegative(),
  title: z.string(),
  chunks: z.array(cloudFileSchema).min(1),
  attachments: z.array(attachment),
}).strict()
const attributedCloudSessionSchema = legacyCloudSessionSchema.extend({
  format: z.literal('dsh-session-2'),
  sourceRanges: z.array(z.object({
    end: z.number().int().positive(), sessionId: z.string().min(1).nullable(),
  }).strict()).min(1),
}).superRefine((manifest, ctx) => {
  let previous = 0
  if (manifest.inheritedEventCount > manifest.throughSeq + 1) {
    ctx.addIssue({ code: 'custom', message: 'Inherited prefix exceeds the exported log' })
  }
  for (const range of manifest.sourceRanges) {
    if (range.end <= previous || range.end > manifest.throughSeq + 1
      || (range.end > manifest.inheritedEventCount && range.sessionId !== manifest.sourceSessionId)) {
      ctx.addIssue({ code: 'custom', message: 'Invalid usage source ranges' })
    }
    previous = range.end
  }
  if (previous !== manifest.throughSeq + 1) ctx.addIssue({ code: 'custom', message: 'Incomplete usage source ranges' })
})
/** Selected conversation payloads retain their original Session data and versioned usage attribution. */
export const cloudSessionSchema = z.discriminatedUnion('format', [legacyCloudSessionSchema, attributedCloudSessionSchema])
type Manifest = z.infer<typeof cloudSessionSchema>
const row = z.object({
  objectId: z.string(),
  version: z.number().int().positive(),
  manifest: cloudSessionSchema,
  missing: z.array(z.object({ name: z.string(), code: z.string() })),
})
const document = z.object({ version: z.literal(1), histories: z.record(z.string(), row) })
const objectId = (source: string) => `conversation:${createHash('sha256').update(source).digest('hex')}`
const json = (value: object) => z.record(z.string(), z.json()).parse(value)
const offline: SyncConnection = { signal: new AbortController().signal, request: () => Promise.reject(new CloudError('OFFLINE')) }

interface ContinuationReceipt {
  requestId: string
  childSessionId: string
  historyId: string
  version: number
  workspaceId: string
  preset?: string
}

/** Services used to capture local completed logs and materialize immutable attachment objects. */
export interface SessionSyncServices {
  persistence:SessionPersistence
  attachments:AttachmentStore
  sessions:SessionStore|undefined
}
/** Account-owned downloaded history; it never enters the writable Session store. */
export class CloudSessions {
  private readonly files:CloudFiles
  private state:z.infer<typeof document>|undefined
  private readonly exported=new Map<string,{ revision:string;value:Manifest }>()
  /**
   * @param directory - private origin/account-scoped local root.
   * @param services - local persistence and attachment owners.
   * @param chunkBytes - deployment-selected immutable chunk size.
   */
  constructor(private readonly directory:string,private readonly services:SessionSyncServices,private readonly chunkBytes:number) {
    this.files=new CloudFiles(directory)
  }
  private async load():Promise<z.infer<typeof document>> {
    if(this.state)return this.state
    try {this.state=document.parse(JSON.parse(await readFile(join(this.directory,'histories.json'),'utf8')))}
    catch(error){if(!(error instanceof Error && 'code' in error && error.code==='ENOENT'))throw error;this.state={ version:1,histories:{} }}
    return this.state
  }
  private async save():Promise<void> {await writeFileAtomic(join(this.directory,'histories.json'),`${JSON.stringify(this.state)}\n`,{ mode:0o600,dirMode:0o700 })}
  private async chunks(source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, signal?: AbortSignal): Promise<CloudFileRef[]> {
    const chunks: CloudFileRef[] = []
    let buffer = new Uint8Array(this.chunkBytes), used = 0
    for await (const bytes of source) {
      signal?.throwIfAborted()
      let offset = 0
      while (offset < bytes.byteLength) {
        signal?.throwIfAborted()
        const length = Math.min(this.chunkBytes - used, bytes.byteLength - offset)
        buffer.set(bytes.subarray(offset, offset + length), used)
        used += length
        offset += length
        if (used === this.chunkBytes) {
          chunks.push(await this.files.stage(buffer))
          buffer = new Uint8Array(this.chunkBytes)
          used = 0
        }
      }
    }
    if (used) chunks.push(await this.files.stage(buffer.subarray(0, used)))
    return chunks
  }
  private stageBytes(bytes: Uint8Array, signal?: AbortSignal): Promise<CloudFileRef[]> { return this.chunks([bytes], signal) }
  private usageLog(manifest: Manifest, restored: ReturnType<typeof restoreCloudSession>): UsageSourceLog {
    return {
      sessionId: manifest.sourceSessionId, parentSessionId: manifest.parentSourceSessionId,
      inheritedEventCount: restored.session.inheritedEventCount, events: restored.events,
      ...(restored.storedVersion !== restored.session.header.version
        ? { sourceRanges: [{ end: restored.events.length, sessionId: null }] }
        : manifest.format === 'dsh-session-2' ? { sourceRanges: manifest.sourceRanges } : {}),
    }
  }

  private async usageSources(header: SessionHeader, events: readonly SessionEvent[], inheritedEventCount: number,
    signal?: AbortSignal): Promise<readonly UsageSourceRange[]> {
    const current: UsageSourceLog = {
      sessionId: String(header.id), parentSessionId: header.parentSession ?? null, inheritedEventCount, events,
    }
    const logs = new Map<string, UsageSourceLog>([[current.sessionId, current]])
    let parentId = header.parentSession
    while (parentId !== undefined && !logs.has(String(parentId))) {
      signal?.throwIfAborted()
      const stat = await this.services.persistence.stat(parentId, signal === undefined ? {} : { signal })
      if (stat === undefined) {
        const history = Object.values((await this.load()).histories).find(item => item.manifest.sourceSessionId === parentId)
        if (history === undefined) break
        const restored = await this.artifact(history.manifest)
        logs.set(String(parentId), this.usageLog(history.manifest, restored))
        parentId = restored.session.header.parentSession
      } else {
        await using handle = await this.services.persistence.open(parentId, 'read', signal === undefined ? {} : { signal })
        const snapshot = await handle.read(0, undefined, signal === undefined ? {} : { signal })
        logs.set(String(parentId), {
          sessionId: String(parentId), parentSessionId: handle.header.parentSession ?? null,
          inheritedEventCount: handle.inheritedEventCount, events: snapshot.events,
        })
        parentId = handle.header.parentSession
      }
    }
    return resolveUsageSources(current, logs)
  }

  private refs(manifest:Manifest):CloudFileRef[] {
    return [...new Map([...manifest.chunks,...manifest.attachments.flatMap(item=>item.chunks)].map(ref=>[ref.id,ref])).values()]
  }
  private async artifact(manifest:Manifest,connection:SyncConnection=offline):Promise<ReturnType<typeof restoreCloudSession>> {
    const bytes:Uint8Array[]=[]
    for(const chunk of manifest.chunks)bytes.push(await this.files.read(chunk,connection))
    const text=Buffer.concat(bytes.map(value=>Buffer.from(value))).toString('utf8')
    const restored=restoreCloudSession(text)
    if(String(restored.session.id)!==manifest.sourceSessionId || restored.storedVersion!==manifest.sessionFormatVersion
       || (restored.session.header.parentSession ?? null)!==manifest.parentSourceSessionId
      || (restored.storedVersion===restored.session.header.version && (restored.events.at(-1)?.seq!==manifest.throughSeq
      || restored.session.inheritedEventCount!==manifest.inheritedEventCount)))throw new CloudError('SESSION_DAMAGED')
    return restored
  }
  /**
   * Produce the session sync contribution descriptor.
   * @returns An owner declaration that stages during preview and uploads files only from the durable selected queue.
   */
  contribution():SyncContribution {
    return { namespace:'studio.sessions',version:1,fields:['format','sessionFormatVersion','sourceSessionId','parentSourceSessionId',
      'inheritedEventCount','createdAt','throughSeq','title','chunks','attachments','sourceRanges'],
    export:async (ids,signal)=>{
      const options=signal===undefined?{}:{ signal }
      const values:{ id:string;kind:'conversation';blocked?:boolean;payload:ReturnType<typeof json>;fileRefs:string[] }[]=[]
      const snapshots=await this.services.persistence.list(options)
      for(const snapshot of snapshots) {
        signal?.throwIfAborted()
        const id=objectId(String(snapshot.header.id))
        if(ids!==undefined && !ids.includes(id))continue
        if(snapshot.formatStatus==='migration-required') {
          values.push({ id,kind:'conversation',blocked:true,payload:{ format:'unavailable',sourceSessionId:String(snapshot.header.id),reason:'LOCAL_SESSION_MIGRATION_REQUIRED' },fileRefs:[] })
          continue
        }
        const live=this.services.sessions?.get(snapshot.header.id)
        if(live!==undefined)await this.services.sessions?.flush(live)
        const fresh=await this.services.persistence.stat(snapshot.header.id,options)
        if(fresh===undefined)throw new CloudError('LOCAL_SESSION_MISSING')
        const cached=this.exported.get(id)
        let manifest:Manifest
        if(cached?.revision===String(fresh.revision))manifest=cached.value
        else {
          await using handle=await this.services.persistence.open(snapshot.header.id,'read',options)
          const { events }=await handle.read(0,undefined,options)
          const artifact=encodeCompletedSession(handle.header,events,handle.inheritedEventCount)
          if(artifact===null)continue
          const refs=collectSessionAttachments(events.slice(0,artifact.throughSeq+1))
          const attachments:Manifest['attachments']=[]
          for(const image of refs.images) {
            try {
              const stored=await this.services.attachments.readImage(image,signal)
              attachments.push({ kind:'image',ref:image,chunks:await this.stageBytes(stored.data,signal) })
            } catch(error) {
              if(!isAttachmentError(error))throw error
              attachments.push({ kind:'image',ref:image,chunks:[],unavailable:error.code })
            }
          }
          for(const file of refs.files) {
            try {attachments.push({ kind:'file',ref:file,chunks:await this.chunks(this.services.attachments.readFileStream(file,signal),signal) })}
            catch(error) {
              if(!isAttachmentError(error))throw error
              attachments.push({ kind:'file',ref:file,chunks:[],unavailable:error.code })
            }
          }
          manifest={ format:'dsh-session-2',sessionFormatVersion:handle.header.version,sourceSessionId:String(handle.id),
            sourceRanges:[...await this.usageSources(
              handle.header,events.slice(0,artifact.throughSeq+1),handle.inheritedEventCount,signal,
            )],
            parentSourceSessionId:handle.header.parentSession ?? null,inheritedEventCount:handle.inheritedEventCount,
            createdAt:handle.header.createdAt,throughSeq:artifact.throughSeq,title:String(handle.id),
            chunks:await this.stageBytes(Buffer.from(artifact.text),signal),attachments,
          }
          if(!attachments.some(item=>item.unavailable!==undefined)
             && manifest.sourceRanges.every(range=>range.sessionId!==null)) {
            this.exported.set(id,{ revision:String(fresh.revision),value:manifest })
          }
        }
        values.push({ id,kind:'conversation',payload:json(manifest),fileRefs:this.refs(manifest).map(ref=>ref.id) })
      }
      return values
    },
    prepare:async(value,connection)=>{
      const manifest=cloudSessionSchema.parse(value.payload)
      for(const ref of this.refs(manifest))await this.files.upload(ref,connection)
    },
    import:async(value,signal,connection)=>{
      if(connection===undefined)throw new CloudError('FILE_TRANSPORT_UNSUPPORTED')
      if(value.deleted)throw new CloudError('LOCAL_DELETE_CONFIRMATION_REQUIRED')
      const manifest=cloudSessionSchema.parse(value.payload)
      await this.artifact(manifest,connection)
      const missing:{ name:string;code:string }[]=[]
      for(const item of manifest.attachments) {
        signal.throwIfAborted()
        if(item.unavailable!==undefined){missing.push({ name:item.ref.name ?? item.ref.attachmentId,code:item.unavailable });continue}
        try {
          await this.restoreAttachment(item, connection)
        } catch (error) {
          if (!(error instanceof CloudError) && !isAttachmentError(error)) throw error
          missing.push({ name: item.ref.name ?? item.ref.attachmentId, code: error.code })
        }
      }
      const state = await this.load(), saved = { objectId: value.id, version: value.version, manifest, missing }
      const digest = createHash('sha256').update(JSON.stringify(saved)).digest('hex')
      await writeFileAtomic(join(this.directory, 'history-snapshots', `${digest}.json`), `${JSON.stringify(saved)}\n`, { mode: 0o600, dirMode: 0o700 })
      signal.throwIfAborted()
      state.histories[value.id] = saved
      await this.save()
      if (missing.length) throw new CloudError('ATTACHMENTS_MISSING')
    },
    }
  }
  private async restoreAttachment(item: Manifest['attachments'][number], connection: SyncConnection): Promise<void> {
    const files = this.files
    const source = (async function*() { for (const ref of item.chunks) yield await files.read(ref, connection) })()
    if (item.kind === 'file') {
      const ref = await this.services.attachments.saveFileStream({ data: source, name: item.ref.name, signal: connection.signal })
      this.matchFile(item.ref, ref)
    } else {
      const chunks: Uint8Array[] = []
      for await (const bytes of source) chunks.push(bytes)
      const ref = await this.services.attachments.saveImage({
        data: Buffer.concat(chunks.map(bytes => Buffer.from(bytes))),
        mediaType: item.ref.mediaType,
        ...(item.ref.name === undefined ? {} : { name: item.ref.name }),
      })
      this.matchImage(item.ref, ref)
    }
  }
  private matchFile(expected: FileAttachmentRef, actual: FileAttachmentRef): void {
    if (expected.attachmentId !== actual.attachmentId || expected.bytes !== actual.bytes || expected.name !== actual.name) throw new CloudError('ATTACHMENT_POLICY_MISMATCH')
  }
  private matchImage(expected: Pick<ImageAttachmentRef, 'attachmentId' | 'bytes' | 'width' | 'height'>, actual: ImageAttachmentRef): void {
    if (expected.attachmentId !== actual.attachmentId || expected.bytes !== actual.bytes || expected.width !== actual.width || expected.height !== actual.height) throw new CloudError('ATTACHMENT_POLICY_MISMATCH')
  }
  /**
   * List downloaded cloud history items.
   * @returns Downloaded histories and missing attachment requirements; no Agent or writable Session is created.
   */
  async list(): Promise<StudioHistoryItem[]> {
    const state = await this.load()
    return Object.values(state.histories).map(item => ({
      id: item.objectId,
      version: item.version,
      title: item.manifest.title,
      sourceSessionId: item.manifest.sourceSessionId,
      throughSeq: item.manifest.throughSeq,
      missing: item.missing,
    }))
  }
  /**
   * Read verified downloaded history through the installed Session message projection.
   * @param id - previously imported cloud object identity.
   * @returns immutable displayed messages and restoration requirements, usable offline.
   */
  async read(id: string): Promise<StudioHistoryView> {
    const state = await this.load(), stored = state.histories[id]
    if (stored === undefined) throw new CloudError('LOCAL_HISTORY_MISSING')
    const { session } = await this.artifact(stored.manifest)
    return {
      id,
      version: stored.version,
      title: stored.manifest.title,
      sourceSessionId: stored.manifest.sourceSessionId,
      throughSeq: stored.manifest.throughSeq,
      missing: stored.missing,
      messages: session.deriveMessages().map(message => ({
        id: String(message.id),
        role: message.role,
        content: message.content.map(block => block.type === 'text' ? block.text : JSON.stringify(block)).join('\n'),
      })),
    }
  }

  private continuations: Record<string, ContinuationReceipt> | undefined
  private async loadContinuations(): Promise<Record<string, ContinuationReceipt>> {
    if (this.continuations) return this.continuations
    try {
      this.continuations = JSON.parse(await readFile(join(this.directory, 'continuations.json'), 'utf8')) as Record<string, ContinuationReceipt>
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      this.continuations = {}
    }
    return this.continuations
  }
  private async saveContinuations(): Promise<void> {
    await writeFileAtomic(join(this.directory, 'continuations.json'), `${JSON.stringify(this.continuations)}\n`, { mode: 0o600, dirMode: 0o700 })
  }
  /**
   * Fork an immutable downloaded history into a new local branch session within a selected workspace.
   * Does not create an Agent, issue model calls, or execute tasks.
   * @param id - cloud object ID of downloaded history.
   * @param options - target workspace, optional preset override, and stable idempotent requestId.
   * @returns newly created child Session ID.
   */
  async fork(id: string, options: { workspace: Workspace; preset?: string; requestId: string }): Promise<StudioContinuationResult> {
    const state = await this.load()
    const stored = state.histories[id]
    if (stored === undefined) throw new CloudError('LOCAL_HISTORY_MISSING')
    if (stored.missing.length > 0) throw new CloudError('ATTACHMENTS_MISSING')

    const continuations = await this.loadContinuations()
    const existing = continuations[options.requestId]
    if (existing !== undefined) {
      const stat = await this.services.persistence.stat(SessionId(existing.childSessionId))
      if (stat !== undefined) return { sessionId: existing.childSessionId }
    }

    const { events } = await this.artifact(stored.manifest)
    const boundary = SessionSeq(stored.manifest.throughSeq)
    const seed = buildForkSeed(events, boundary)
    const inheritedEventCount = SessionLogOffset(boundary + 1)
    const childId = SessionId(`session-${randomUUID()}`)
    const now = Date.now()

    let nextSeq = seed.length
    const extraEvents: SessionEvent[] = [
      {
        type: 'working-directory/change',
        seq: SessionSeq(nextSeq++),
        time: now,
        data: { cwd: options.workspace.path },
      },
    ]
    if (options.preset !== undefined && options.preset.length > 0) {
      extraEvents.push({
        type: 'agent-preset/selected',
        seq: SessionSeq(nextSeq++),
        time: now,
        data: { agentPreset: options.preset },
      })
    }

    const header: SessionHeader = {
      version: SESSION_FORMAT_VERSION,
      id: childId,
      createdAt: now,
      isSeeded: true,
      cwd: options.workspace.path,
      parentSession: SessionId(stored.manifest.sourceSessionId),
      ...(options.preset ? { agentPreset: options.preset } : {}),
    }

    const handle = await this.services.persistence.create(header, { inheritedEventCount })
    try {
      await handle.append([...seed, ...extraEvents])
      await handle.flush()
    } finally {
      await handle.close()
    }

    await options.workspace.attachSession(childId)

    continuations[options.requestId] = {
      requestId: options.requestId,
      childSessionId: String(childId),
      historyId: id,
      version: stored.version,
      workspaceId: String(options.workspace.id),
      ...(options.preset ? { preset: options.preset } : {}),
    }
    await this.saveContinuations()

    return { sessionId: String(childId) }
  }
  /**
   * Fold token usage across all downloaded immutable histories into a deduplicated aggregate.
   * Inherited turns from shared ancestors are counted exactly once.
   * @returns aggregate metrics and counts of turns and sessions.
   */
  async tokenActivity(): Promise<StudioTokenActivity> {
    const state = await this.load()
    const logs: UsageSourceLog[] = []
    for (const stored of Object.values(state.histories)) {
      const restored = await this.artifact(stored.manifest)
      logs.push(this.usageLog(stored.manifest, restored))
    }
    return calculateTokenActivity(logs)
  }
}
