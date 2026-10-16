import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto'
import { transaction } from './db.js'
import { identity, fail, objectId, audit, type Services } from './common.js'
import { digest } from './security.js'
import { policies } from './settings.js'

const base64 = z.string().max(6000000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
const encryptedPayload = z.object({ algorithm: z.literal('AES-256-GCM'), keyVersion: z.number().int().positive(),
 nonce: base64.refine(v => Buffer.from(v, 'base64').length === 12), ciphertext: base64.refine(v => Buffer.from(v, 'base64').length >= 16) }).strict()
const changeSchema = z.object({ id: objectId, kind: z.enum(['profile','preference','project','conversation','plugin']),
 parentId: objectId.nullable().default(null), namespace: objectId.nullable().default(null),
 baseVersion: z.number().int().nonnegative().max(2147483646), formatVersion: z.number().int().positive().max(1000),
 fileRefs:z.array(z.uuid()).max(1000).default([]), encrypted: z.boolean(), payload: z.json().nullable(), deleted: z.boolean().default(false),
}).strict().refine(c => c.kind !== 'plugin' || c.namespace !== null, 'Plugin data requires namespace')
const pushSchema = z.object({ requestId: z.uuid(), changes: z.array(changeSchema).min(1).max(100) }).strict()
const cursorSchema = z.object({ user: z.uuid(), epoch: z.uuid(), seq: z.number().int().nonnegative().safe() }).strict()
const forbidden = /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization|private[_-]?key|env|environment)$/i
function noSecrets(value: unknown): boolean {
 if (Array.isArray(value)) return value.every(noSecrets)
 if (value !== null && typeof value === 'object') return Object.entries(value).every(([key,v]) => !forbidden.test(key) && noSecrets(v))
 return true
}
function cursor(s: Services, value: z.infer<typeof cursorSchema>): string {
 const data = Buffer.from(JSON.stringify(value)).toString('base64url')
 return `${data}.${createHmac('sha256', Buffer.from(s.config.MASTER_KEY, 'hex')).update(data).digest('base64url')}`
}
function readCursor(s: Services, raw: string) {
 const [data, signature] = raw.split('.')
 if (!data || !signature) fail(400, 'INVALID_CURSOR', '同步游标无效')
 const expected = createHmac('sha256', Buffer.from(s.config.MASTER_KEY, 'hex')).update(data).digest()
 const actual = Buffer.from(signature, 'base64url')
 if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) fail(400, 'INVALID_CURSOR', '同步游标无效')
 try { return cursorSchema.parse(JSON.parse(Buffer.from(data, 'base64url').toString('utf8'))) }
 catch { return fail(400, 'INVALID_CURSOR', '同步游标无效') }
}
export async function usage(s: Services, userId: string) {
 const row = (await s.db.query(`SELECT
 COALESCE((SELECT sum(bytes) FROM sync_objects WHERE user_id=$1),0)+
 COALESCE((SELECT sum(bytes) FROM sync_changes WHERE user_id=$1),0)+
 COALESCE((SELECT sum(bytes) FROM cloud_files WHERE user_id=$1),0) AS bytes`, [userId])).rows[0]
 return Number(row.bytes)
}
function view(row: Record<string, unknown>) {
 return { id: row.id, kind: row.kind, parentId: row.parent_id, namespace: row.namespace, version: row.version,
  formatVersion: row.format_version, encrypted: row.encrypted, payload: row.payload, fileRefs:row.file_refs, deleted: row.deleted_at !== null }
}
/** Serialize each user's writes with its ownership row, including quota checks and sequence allocation. */
export async function syncRoutes(app: FastifyInstance, s: Services) {
 app.get('/v1/me/storage', async req => {
  const u = await identity(s, req), p = await policies(s)
  const row = (await s.db.query('SELECT quota_bytes,encryption_mode FROM users WHERE id=$1', [u.id])).rows[0]
  return { usedBytes: await usage(s, u.id), quotaBytes: Number(row.quota_bytes ?? p.defaultQuotaBytes), encryptionMode: row.encryption_mode,
   accounting: 'current_objects_change_history_and_files' }
 })
 app.get('/v1/me/crypto', async req => {
  const u = await identity(s, req)
  const row = (await s.db.query('SELECT encryption_mode,crypto FROM users WHERE id=$1', [u.id])).rows[0]
  return { mode: row.encryption_mode, config: row.crypto }
 })
 app.put('/v1/me/crypto', async req => {
  const u = await identity(s, req)
  const b = z.object({ mode: z.enum(['plain','e2ee']), config: z.object({ keyVersion: z.number().int().positive(),
   wrappedKey: base64.refine(v => v.length > 20), recoveryWrappedKey: base64.refine(v => v.length > 20),
  }).strict().nullable() }).strict().parse(req.body)
  if ((b.mode === 'e2ee') !== (b.config !== null)) fail(400, 'INVALID_CRYPTO', '加密模式与封装密钥不一致')
  await transaction(s.db, async c => {
   await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [u.id])
   const objects = await c.query('SELECT id FROM sync_objects WHERE user_id=$1 LIMIT 1', [u.id])
   if (objects.rowCount) fail(409, 'CRYPTO_MIGRATION_REQUIRED', '只能为空同步空间设置加密模式，已有数据迁移尚不支持')
   await c.query('UPDATE users SET encryption_mode=$1,crypto=$2 WHERE id=$3', [b.mode, b.config, u.id])
   await audit(c, u.id, 'crypto.configured')
  }); return { ok: true }
 })
 const push = async (req: FastifyRequest) => {
  const u = await identity(s, req), b = pushSchema.parse(req.body), p = await policies(s)
  if (new Set(b.changes.map(v => v.id)).size !== b.changes.length) fail(400, 'DUPLICATE_OBJECT', '批次内对象 ID 不得重复')
  const requestDigest = digest(JSON.stringify(b))
  return transaction(s.db, async c => {
   const user = (await c.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [u.id])).rows[0]
   const session = await c.query('SELECT id FROM auth_sessions WHERE id=$1 AND NOT revoked AND access_expires>now()', [u.session_id])
   if (user.disabled || !session.rowCount) fail(401,'UNAUTHORIZED','登录已失效，请重新登录')
   const prior = (await c.query('SELECT digest,result FROM sync_requests WHERE user_id=$1 AND request_id=$2', [u.id,b.requestId])).rows[0]
   if (prior) {
    if (prior.digest !== requestDigest) fail(409, 'IDEMPOTENCY_CONFLICT', '同一请求 ID 的内容不同')
    return prior.result
   }
   let seq = Number(user.sync_seq)
   const versions: { id: string; version: number }[] = []
   for (const item of b.changes) {
    const existing = (await c.query('SELECT * FROM sync_objects WHERE user_id=$1 AND id=$2', [u.id,item.id])).rows[0]
    if ((existing?.version ?? 0) !== item.baseVersion) fail(409, 'VERSION_CONFLICT', `对象 ${item.id} 版本冲突，请下载最新数据后重试`)
    if (existing && (existing.kind !== item.kind || existing.namespace !== item.namespace || existing.parent_id !== item.parentId || existing.encrypted !== item.encrypted))
     fail(409, 'OBJECT_IDENTITY_CONFLICT', '不能改变已有对象的类型、父对象或插件标识')
    if (existing?.deleted_at && !item.deleted) fail(409, 'OBJECT_DELETED', '对象已删除，请使用新 ID 显式恢复')
    if (item.deleted && item.payload !== null) fail(400, 'INVALID_DELETE', '删除操作载荷必须为空')
    if (!item.deleted && item.encrypted !== (user.encryption_mode === 'e2ee')) fail(400, 'ENCRYPTION_REQUIRED', '载荷加密状态与账号设置不一致')
    if (!item.deleted && item.encrypted) {
     const encrypted = encryptedPayload.parse(item.payload)
     if (encrypted.keyVersion !== user.crypto?.keyVersion) fail(400, 'KEY_VERSION_INVALID', '加密密钥版本不匹配')
    } else if (!item.deleted && !noSecrets(item.payload)) fail(400, 'SECRET_FIELD', '不允许同步凭据字段')
    if (item.parentId) {
     const parent = (await c.query('SELECT kind,deleted_at FROM sync_objects WHERE user_id=$1 AND id=$2', [u.id,item.parentId])).rows[0]
     if (!parent || parent.kind !== 'project' || (!item.deleted && parent.deleted_at)) fail(400, 'PARENT_INVALID', '父项目不存在、已删除或不属于当前用户；请先提交项目')
    }
    if (item.kind === 'project' && item.deleted) {
     const children = await c.query('SELECT id FROM sync_objects WHERE user_id=$1 AND parent_id=$2 AND deleted_at IS NULL LIMIT 1', [u.id,item.id])
     if (children.rowCount) fail(409, 'PROJECT_NOT_EMPTY', '请先删除项目下的对象')
    }
    if (item.kind === 'profile' && item.id === 'studio-profile') {
     if (item.encrypted || item.deleted || item.formatVersion !== 1) fail(400,'PROFILE_FORMAT','个人资料需要普通同步版本 1')
     const profile = z.object({displayName:z.string().trim().max(120)}).strict().parse(item.payload)
     await c.query('UPDATE users SET display_name=$1 WHERE id=$2',[profile.displayName,u.id])
    }
    if (item.deleted && item.fileRefs.length) fail(400,'INVALID_DELETE','删除操作不能包含文件引用')
    for (const file of item.fileRefs) {
     const owned = await c.query('SELECT id FROM cloud_files WHERE user_id=$1 AND id=$2 AND complete',[u.id,file])
     if (!owned.rowCount) fail(400,'FILE_REFERENCE_INVALID','引用的文件不存在、尚未完成或不属于当前账号')
    }
    const bytes = Buffer.byteLength(JSON.stringify(item.payload))
    if (bytes > p.maxObjectBytes) fail(413, 'OBJECT_TOO_LARGE', '单个同步对象超过大小限制')
    const version = item.baseVersion + 1
    await c.query(`INSERT INTO sync_objects(user_id,id,kind,parent_id,namespace,version,format_version,encrypted,payload,bytes,deleted_at,file_refs)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $11 THEN now() ELSE NULL END,$12)
     ON CONFLICT(user_id,id) DO UPDATE SET version=excluded.version,format_version=excluded.format_version,
     payload=CASE WHEN $11 THEN sync_objects.payload ELSE excluded.payload END,
     bytes=CASE WHEN $11 THEN sync_objects.bytes ELSE excluded.bytes END,
     file_refs=CASE WHEN $11 THEN sync_objects.file_refs ELSE excluded.file_refs END,
     encrypted=excluded.encrypted,deleted_at=CASE WHEN $11 THEN COALESCE(sync_objects.deleted_at,now()) ELSE NULL END,updated_at=now()`,
     [u.id,item.id,item.kind,item.parentId,item.namespace,version,item.formatVersion,item.encrypted,item.payload,bytes,item.deleted,JSON.stringify(item.fileRefs)])
    const value = { ...item, version }
    await c.query('INSERT INTO sync_changes(user_id,seq,object_id,value,bytes) VALUES($1,$2,$3,$4,$5)',
     [u.id, ++seq, item.id, value, Buffer.byteLength(JSON.stringify(value))])
    versions.push({ id: item.id, version })
   }
   const used = (await c.query(`SELECT COALESCE((SELECT sum(bytes) FROM sync_objects WHERE user_id=$1),0)+
    COALESCE((SELECT sum(bytes) FROM sync_changes WHERE user_id=$1),0)+
 COALESCE((SELECT sum(bytes) FROM cloud_files WHERE user_id=$1),0) AS bytes`, [u.id])).rows[0]
   if (Number(used.bytes) > Number(user.quota_bytes ?? p.defaultQuotaBytes) && b.changes.some(v => !v.deleted))
    fail(413, 'QUOTA_EXCEEDED', '个人存储额度不足；可先下载或删除数据')
   await c.query('UPDATE users SET sync_seq=$1 WHERE id=$2', [seq,u.id])
   const result = { versions, cursor: cursor(s, { user: u.id, epoch: user.sync_epoch, seq }) }
   await c.query('INSERT INTO sync_requests(user_id,request_id,digest,result) VALUES($1,$2,$3,$4)', [u.id,b.requestId,requestDigest,result])
   return result
  })
 }
 app.post('/v1/sync/push',push)
 app.get('/v1/me/profile',async req => {
  const u = await identity(s,req)
  const row = (await s.db.query("SELECT version,payload FROM sync_objects WHERE user_id=$1 AND id='studio-profile' AND deleted_at IS NULL",[u.id])).rows[0]
  return { displayName:u.display_name, version:row?.version ?? 0 }
 })
 app.put('/v1/me/profile',async req => {
  const b = z.object({requestId:z.uuid(),baseVersion:z.number().int().nonnegative(),displayName:z.string().trim().max(120)}).strict().parse(req.body)
  req.body = {requestId:b.requestId,changes:[{id:'studio-profile',kind:'profile',baseVersion:b.baseVersion,formatVersion:1,encrypted:false,payload:{displayName:b.displayName}}]}
  return push(req)
 })
 app.get('/v1/sync/pull', async req => {
  const u = await identity(s, req)
  const q = z.object({ cursor: z.string().max(1000).optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }).strict().parse(req.query)
  return transaction(s.db, async c => {
  const user = (await c.query('SELECT sync_epoch,sync_seq,sync_floor FROM users WHERE id=$1 FOR UPDATE', [u.id])).rows[0]
  const pos = q.cursor ? readCursor(s, q.cursor) : { user: u.id, epoch: user.sync_epoch, seq: 0 }
  if (pos.user !== u.id) fail(403, 'CURSOR_OWNER', '游标不属于当前用户')
  if (pos.epoch !== user.sync_epoch || pos.seq < Number(user.sync_floor)) fail(410, 'SNAPSHOT_REQUIRED', '游标过期，需要重新获取完整快照')
  if (pos.seq > Number(user.sync_seq)) fail(400, 'INVALID_CURSOR', '游标超出当前进度')
  const rows = (await c.query('SELECT seq,value FROM sync_changes WHERE user_id=$1 AND seq>$2 ORDER BY seq LIMIT $3', [u.id,pos.seq,q.limit+1])).rows
  const more = rows.length > q.limit, changes = rows.slice(0,q.limit)
  const seq = changes.length ? Number(changes.at(-1)!.seq) : pos.seq
  return { changes, hasMore: more, cursor: cursor(s, { user: u.id, epoch: user.sync_epoch, seq }) }
  })
 })
 app.get('/v1/sync/snapshot', async req => {
  const u = await identity(s, req)
  const q = z.object({ snapshot: z.uuid().optional(), after: objectId.optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }).strict().parse(req.query)
  return transaction(s.db, async c => {
   const user = (await c.query('SELECT sync_seq,sync_epoch FROM users WHERE id=$1 FOR UPDATE', [u.id])).rows[0]
   let id = q.snapshot
   if (!id) {
    await c.query('DELETE FROM sync_snapshots WHERE user_id=$1', [u.id])
    id = randomUUID()
    await c.query('INSERT INTO sync_snapshots(id,user_id,seq,epoch) VALUES($1,$2,$3,$4)', [id,u.id,user.sync_seq,user.sync_epoch])
    await c.query(`INSERT INTO sync_snapshot_items(snapshot_id,id,value) SELECT $1,id,jsonb_build_object(
     'id',id,'kind',kind,'parentId',parent_id,'namespace',namespace,'version',version,'formatVersion',format_version,
     'fileRefs',file_refs,'encrypted',encrypted,'payload',CASE WHEN deleted_at IS NULL THEN payload ELSE NULL END,'deleted',deleted_at IS NOT NULL)
     FROM sync_objects WHERE user_id=$2`, [id,u.id])
   }
   const snapshot = (await c.query('SELECT * FROM sync_snapshots WHERE id=$1 AND user_id=$2 AND expires_at>now()', [id,u.id])).rows[0]
   if (!snapshot) fail(410, 'SNAPSHOT_EXPIRED', '快照已过期或被替换，请重新开始')
   const rows = (await c.query('SELECT id,value FROM sync_snapshot_items WHERE snapshot_id=$1 AND id>$2 ORDER BY id LIMIT $3', [id,q.after ?? '',q.limit+1])).rows
   const items = rows.slice(0,q.limit)
   return { snapshot: id, items: items.map(row => row.value), hasMore: rows.length>q.limit, after: items.at(-1)?.id ?? null,
    cursor: cursor(s, { user: u.id, epoch: snapshot.epoch, seq: Number(snapshot.seq) }) }
  })
 })
 app.get('/v1/data', async req => {
  const u = await identity(s, req)
  const q = z.object({ kind: z.enum(['profile','preference','project','conversation','plugin']).optional(), after: objectId.optional(),
   limit: z.coerce.number().int().min(1).max(100).default(50) }).strict().parse(req.query)
  const rows = (await s.db.query('SELECT * FROM sync_objects WHERE user_id=$1 AND id>$2 AND ($3::text IS NULL OR kind=$3) ORDER BY id LIMIT $4', [u.id,q.after ?? '',q.kind ?? null,q.limit])).rows
  return { items: rows.map(row => view({ ...row, payload: row.deleted_at ? null : row.payload })), after: rows.at(-1)?.id ?? null }
 })
}
