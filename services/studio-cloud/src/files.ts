/** Account-owned immutable file parts. Database rows reserve quota before any bytes are accepted. */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { Readable } from 'node:stream'
import { transaction } from './db.js'
import { identity, fail, type Services } from './common.js'
import { policies } from './settings.js'

const hash = z.string().regex(/^[a-f0-9]{64}$/)
const params = z.object({ id: z.uuid() })
/** Resolve a validated account-local content address; caller validates persisted and wire identifiers. */
export function partPath(s: Services, user: string, sha256: string): string {
 return join(resolve(s.config.DATA_DIR), 'files', z.uuid().parse(user), hash.parse(sha256))
}
/** Read a durable part, reporting missing cloud content as a recoverable integrity failure. */
export async function readPart(s: Services, user: string, sha256: string): Promise<Buffer> {
 try { return await readFile(partPath(s,user,sha256)) }
 catch (error) {
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') fail(409,'FILE_DAMAGED','云端文件缺失，请恢复备份')
  throw error
 }
}
/** Register resumable uploads; completed files and their parts cannot be modified. */
export async function fileRoutes(app: FastifyInstance, s: Services) {
 app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: s.config.FILE_PART_BYTES }, (_req, body, done) => done(null, body))
 app.post('/v1/files', async req => {
  const u = await identity(s, req)
  const b = z.object({ id: z.uuid(), bytes: z.number().int().min(1).max(s.config.FILE_MAX_BYTES), sha256: hash }).strict().parse(req.body)
  const p = await policies(s)
  return transaction(s.db, async c => {
   const user = (await c.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [u.id])).rows[0]
   const session = await c.query('SELECT id FROM auth_sessions WHERE id=$1 AND NOT revoked AND access_expires>now() AND refresh_expires>now()',[u.session_id])
   if (user.disabled || !session.rowCount) fail(401,'UNAUTHORIZED','登录已失效，请重新登录')
   if (user.encryption_mode !== 'plain') fail(409, 'E2EE_UNSUPPORTED', '此客户端不支持当前空间的端到端加密')
   const existing = (await c.query('SELECT * FROM cloud_files WHERE user_id=$1 AND id=$2', [u.id,b.id])).rows[0]
   if (existing) {
    if (Number(existing.bytes) !== b.bytes || existing.sha256 !== b.sha256) fail(409, 'FILE_ID_CONFLICT', '文件 ID 已用于不同内容')
    return { id:b.id, partBytes:existing.part_bytes, complete:existing.complete }
   }
   const used = (await c.query(`SELECT COALESCE((SELECT sum(bytes) FROM sync_objects WHERE user_id=$1),0)+
    COALESCE((SELECT sum(bytes) FROM sync_changes WHERE user_id=$1),0)+
    COALESCE((SELECT sum(bytes) FROM cloud_files WHERE user_id=$1),0) AS bytes`, [u.id])).rows[0]
   if (Number(used.bytes)+b.bytes > Number(user.quota_bytes ?? p.defaultQuotaBytes)) fail(413, 'QUOTA_EXCEEDED', '个人存储额度不足')
   await c.query('INSERT INTO cloud_files(user_id,id,bytes,sha256,part_bytes) VALUES($1,$2,$3,$4,$5)', [u.id,b.id,b.bytes,b.sha256,s.config.FILE_PART_BYTES])
   return { id:b.id, partBytes:s.config.FILE_PART_BYTES, complete:false }
  })
 })
 app.get('/v1/files/:id', async req => {
  const u = await identity(s, req), {id} = params.parse(req.params)
  const file = (await s.db.query('SELECT * FROM cloud_files WHERE user_id=$1 AND id=$2', [u.id,id])).rows[0]
  if (!file) fail(404, 'FILE_NOT_FOUND', '文件不存在')
  const parts = (await s.db.query('SELECT part,sha256,bytes FROM cloud_file_parts WHERE user_id=$1 AND file_id=$2 ORDER BY part', [u.id,id])).rows
  return { id, bytes:Number(file.bytes), sha256:file.sha256, partBytes:file.part_bytes, complete:file.complete, parts }
 })
 app.put('/v1/files/:id/parts/:part', async req => {
  const u = await identity(s, req)
  const {id,part} = params.extend({ part:z.coerce.number().int().nonnegative() }).parse(req.params)
  if (!Buffer.isBuffer(req.body)) fail(400, 'FILE_BODY_REQUIRED', '请使用二进制文件内容')
  const body = req.body, sha256 = createHash('sha256').update(body).digest('hex')
  return transaction(s.db, async c => {
   await c.query('SELECT pg_advisory_xact_lock_shared(702120)')
   // The account lock also excludes account revocation and quota mutations during a write.
   const account = (await c.query('SELECT disabled FROM users WHERE id=$1 FOR UPDATE', [u.id])).rows[0]
   const session = await c.query('SELECT id FROM auth_sessions WHERE id=$1 AND NOT revoked AND access_expires>now() AND refresh_expires>now()',[u.session_id])
   if (account.disabled || !session.rowCount) fail(401,'UNAUTHORIZED','登录已失效，请重新登录')
   const file = (await c.query('SELECT * FROM cloud_files WHERE user_id=$1 AND id=$2 FOR UPDATE', [u.id,id])).rows[0]
   if (!file) fail(404, 'FILE_NOT_FOUND', '文件不存在')
   const size = Math.min(file.part_bytes,Number(file.bytes)-part*file.part_bytes)
   if (size <= 0 || body.length !== size) fail(400, 'FILE_PART_SIZE', '文件分块大小或序号不正确')
   const prior = (await c.query('SELECT sha256 FROM cloud_file_parts WHERE user_id=$1 AND file_id=$2 AND part=$3', [u.id,id,part])).rows[0]
   if (prior) {
    if (prior.sha256 !== sha256) fail(409, 'FILE_PART_CONFLICT', '同一分块不能替换为不同内容')
    return { sha256 }
   }
   if (file.complete) fail(409, 'FILE_IMMUTABLE', '文件已经完成')
   const path = partPath(s,u.id,sha256)
   await mkdir(resolve(path,'..'),{ recursive:true, mode:0o700 })
   // Publish a complete part atomically while other files may read the same content address.
   const temporary = `${path}.${randomUUID()}.tmp`
   try {
    await writeFile(temporary,body,{ mode:0o600, flag:'wx' })
    await rename(temporary,path)
   } finally {await rm(temporary,{ force:true })}
   await c.query('INSERT INTO cloud_file_parts(user_id,file_id,part,sha256,bytes) VALUES($1,$2,$3,$4,$5)', [u.id,id,part,sha256,body.length])
   return { sha256 }
  })
 })
 app.post('/v1/files/:id/complete', async req => {
  const u = await identity(s, req), {id} = params.parse(req.params)
  return transaction(s.db, async c => {
   const account = (await c.query('SELECT disabled FROM users WHERE id=$1 FOR UPDATE', [u.id])).rows[0]
   const session = await c.query('SELECT id FROM auth_sessions WHERE id=$1 AND NOT revoked AND access_expires>now() AND refresh_expires>now()',[u.session_id])
   if (account.disabled || !session.rowCount) fail(401,'UNAUTHORIZED','登录已失效，请重新登录')
   const file = (await c.query('SELECT * FROM cloud_files WHERE user_id=$1 AND id=$2 FOR UPDATE', [u.id,id])).rows[0]
   if (!file) fail(404, 'FILE_NOT_FOUND', '文件不存在')
   const parts = (await c.query('SELECT * FROM cloud_file_parts WHERE user_id=$1 AND file_id=$2 ORDER BY part', [u.id,id])).rows
   if (parts.length !== Math.ceil(Number(file.bytes)/file.part_bytes)) fail(409, 'FILE_INCOMPLETE', '文件分块尚未上传完整')
   const checksum = createHash('sha256')
   for (const part of parts) checksum.update(await readPart(s,u.id,part.sha256))
   if (checksum.digest('hex') !== file.sha256) fail(409, 'FILE_CHECKSUM', '文件完整性校验失败')
   await c.query('UPDATE cloud_files SET complete=true WHERE user_id=$1 AND id=$2', [u.id,id])
   return { id, bytes:Number(file.bytes), sha256:file.sha256 }
  })
 })
 app.get('/v1/files/:id/content', async (req,reply) => {
  const u = await identity(s, req), {id} = params.parse(req.params)
  const client=await s.db.connect()
  let releasing:Promise<void>|undefined
  const release=()=>releasing ??= (async()=>{
   try {await client.query('SELECT pg_advisory_unlock_shared(702120)');client.release()}
   catch(error) {client.release(true);throw error}
  })()
  try {
   await client.query('SELECT pg_advisory_lock_shared(702120)')
   const file = (await client.query('SELECT * FROM cloud_files WHERE user_id=$1 AND id=$2 AND complete', [u.id,id])).rows[0]
   if (!file) fail(404, 'FILE_NOT_FOUND', '文件不存在或尚未完成')
   const parts = (await client.query('SELECT * FROM cloud_file_parts WHERE user_id=$1 AND file_id=$2 ORDER BY part', [u.id,id])).rows
   for (const part of parts) {
    const bytes = await readPart(s,u.id,part.sha256)
    if (bytes.length !== part.bytes || createHash('sha256').update(bytes).digest('hex') !== part.sha256) fail(409, 'FILE_DAMAGED', '云端文件缺失或损坏，请恢复备份')
   }
   reply.type('application/octet-stream').header('Content-Length',String(file.bytes)).header('X-Content-SHA256',file.sha256)
   const stream=Readable.from((async function* () {
    try {for (const part of parts)yield await readPart(s,u.id,part.sha256)}
    finally {await release()}
   })())
   stream.once('close',()=>{void release().catch((_releaseFailure:unknown)=>{app.log.error('File download connection cleanup failed')})})
   reply.raw.once('close',()=>stream.destroy())
   return reply.send(stream)
  } catch(error) {await release();throw error}
 })
}
