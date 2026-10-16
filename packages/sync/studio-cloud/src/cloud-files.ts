/** Private staging and account-scoped resumable transfer of immutable file chunks. */
import { createHash,randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { SyncConnection } from './sync-engine.ts'
import { CloudError } from './transport.ts'

/** Validated immutable chunk descriptor; names and device paths are deliberately absent. */
export const cloudFileSchema=z.object({ id:z.uuid(),sha256:z.string().regex(/^[a-f0-9]{64}$/),bytes:z.number().int().positive() }).strict()
/** One manifest reference to a verified immutable chunk. */
export type CloudFileRef=z.infer<typeof cloudFileSchema>
const indexSchema=z.object({ version:z.literal(1),files:z.record(z.string(),cloudFileSchema) })
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')

/** File cache for one account directory. Callers serialize mutations with the account sync queue. */
export class CloudFiles {
  private index:z.infer<typeof indexSchema>|undefined
  /** @param directory - private, already origin/account-isolated directory. */
  constructor(private readonly directory:string) {}
  private async load():Promise<z.infer<typeof indexSchema>> {
    if(this.index)return this.index
    try {this.index=indexSchema.parse(JSON.parse(await readFile(join(this.directory,'files.json'),'utf8')))}
    catch(error){if(!(error instanceof Error && 'code' in error && error.code==='ENOENT'))throw error;this.index={ version:1,files:{} }}
    return this.index
  }
  private path(sha256:string):string {
    return join(this.directory,'chunks',z.string().regex(/^[a-f0-9]{64}$/).parse(sha256))
  }
  /**
   * Stage a local chunk without making any network request; repeated content retains its immutable ID.
   * @param bytes - bounded bytes owned by an allowlisted data exporter.
   * @returns a durable descriptor reusable after restart or an unknown upload outcome.
   */
  async stage(bytes:Uint8Array):Promise<CloudFileRef> {
    if(!bytes.byteLength)throw new CloudError('FILE_SIZE')
    const index=await this.load(),sha256=digest(bytes)
    const prior=index.files[sha256]
    if(prior!==undefined) {
      this.check(prior,bytes)
      await writeFileAtomic(this.path(sha256),bytes,{ mode:0o600,dirMode:0o700 })
      return prior
    }
    const ref={ id:randomUUID(),sha256,bytes:bytes.byteLength }
    await writeFileAtomic(this.path(sha256),bytes,{ mode:0o600,dirMode:0o700 })
    index.files[sha256]=ref
    await writeFileAtomic(join(this.directory,'files.json'),`${JSON.stringify(index)}\n`,{ mode:0o600,dirMode:0o700 })
    return ref
  }
  private check(ref:CloudFileRef,bytes:Uint8Array):void {
    if(bytes.byteLength!==ref.bytes || digest(bytes)!==ref.sha256)throw new CloudError('FILE_DAMAGED')
  }
  /**
   * Resume an explicitly selected upload and confirm the complete file before publishing its reference.
   * @param ref - staged immutable chunk descriptor.
   * @param connection - current account transport.
   * @returns after the server confirms byte length and SHA-256; interruption preserves the same ID and parts.
   */
  async upload(ref:CloudFileRef,connection:SyncConnection):Promise<void> {
    const bytes=await readFile(this.path(ref.sha256))
    this.check(ref,bytes)
    const created=await connection.request('/v1/files',z.object({ id:z.uuid(),partBytes:z.number().int().positive().max(4194304),complete:z.boolean() }),{ method:'POST',body:ref })
    if(created.id!==ref.id)throw new CloudError('INVALID_RESPONSE')
    if(created.complete) {
      const completed=await connection.request(`/v1/files/${ref.id}/complete`,cloudFileSchema,{ method:'POST',body:{} })
      if(completed.id!==ref.id || completed.bytes!==ref.bytes || completed.sha256!==ref.sha256)throw new CloudError('FILE_DAMAGED')
      return
    }
    const status=await connection.request(`/v1/files/${ref.id}`,z.object({ parts:z.array(z.object({ part:z.number().int().nonnegative(),sha256:z.string() })) }))
    for(let offset=0;offset<bytes.length;offset+=created.partBytes) {
      connection.signal.throwIfAborted()
      const part=offset/created.partBytes,data=bytes.subarray(offset,offset+created.partBytes),sha256=digest(data)
      const prior=status.parts.find(value=>value.part===part)
      if(prior!==undefined){if(prior.sha256!==sha256)throw new CloudError('FILE_PART_CONFLICT');continue}
      const result=await connection.request(`/v1/files/${ref.id}/parts/${part}`,z.object({ sha256:z.string() }),{ method:'PUT',body:data })
      if(result.sha256!==sha256)throw new CloudError('FILE_DAMAGED')
    }
    const completed=await connection.request(`/v1/files/${ref.id}/complete`,cloudFileSchema,{ method:'POST',body:{} })
    if(completed.id!==ref.id || completed.bytes!==ref.bytes || completed.sha256!==ref.sha256)throw new CloudError('FILE_DAMAGED')
  }
  /**
   * Read a verified local chunk or download it from its account; a failed download never publishes partial bytes.
   * @param input - untrusted manifest reference.
   * @param connection - account-bound transport supporting file downloads.
   * @returns verified bytes, persisted privately for offline reading.
   */
  async read(input:CloudFileRef,connection:SyncConnection):Promise<Uint8Array> {
    const ref=cloudFileSchema.parse(input)
    try {
      const bytes=await readFile(this.path(ref.sha256));this.check(ref,bytes);return bytes
    } catch(error){if(!(error instanceof Error && 'code' in error && error.code==='ENOENT'))throw error}
    if(connection.download===undefined)throw new CloudError('FILE_TRANSPORT_UNSUPPORTED')
    const bytes=await connection.download(`/v1/files/${ref.id}/content`,ref.bytes)
    this.check(ref,bytes)
    connection.signal.throwIfAborted()
    await writeFileAtomic(this.path(ref.sha256),bytes,{ mode:0o600,dirMode:0o700 })
    return bytes
  }
}
