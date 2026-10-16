import { mkdir, writeFile, readFile, unlink, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { transaction } from './db.js'
import { policies, secretSetting, storageSchema, s3 } from './settings.js'
import { seal, unseal } from './security.js'
import { fail, audit, type Services } from './common.js'
import { partPath } from './files.js'

const legacyTables = ['users','settings','sync_objects','sync_changes','audit_events'] as const
const tables = [...legacyTables,'cloud_files','cloud_file_parts'] as const
const legacyArchiveSchema = z.object({ format: z.literal(1), createdAt: z.string(), tables: z.object({
 users: z.array(z.record(z.string(),z.unknown())), settings: z.array(z.record(z.string(),z.unknown())),
 sync_objects: z.array(z.record(z.string(),z.unknown())), sync_changes: z.array(z.record(z.string(),z.unknown())),
 audit_events: z.array(z.record(z.string(),z.unknown())),
}).strict() }).strict()
const archiveSchema = z.union([legacyArchiveSchema, z.object({
 format:z.literal(2), createdAt:z.string(), tables:legacyArchiveSchema.shape.tables.extend({
  cloud_files:z.array(z.record(z.string(),z.unknown())), cloud_file_parts:z.array(z.record(z.string(),z.unknown())),
 }), files:z.array(z.object({ user:z.uuid(),sha256:z.string().regex(/^[a-f0-9]{64}$/),content:z.string() }).strict()),
}).strict()])
const backupPath = (s: Services, id: string) => join(resolve(s.config.DATA_DIR), 'backups', `${id}.json.enc`)

/** Backups include cloud file parts from the same database snapshot; missing content fails the backup. */
export async function createBackup(s: Services, actor: string | null) {
 const p = await policies(s), id = randomUUID()
 const client = await s.db.connect()
 let locked = false
 try {
  locked = (await client.query('SELECT pg_try_advisory_lock(702118) AS locked')).rows[0].locked
  if (!locked) fail(409, 'BACKUP_BUSY', '备份或恢复正在运行')
  await client.query('SELECT pg_advisory_lock_shared(702120)')
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  const data: Record<string, unknown[]> = {}
  let totalBytes = 0
  for (const table of tables) {
   data[table] = []
   // Fetch bounded pages from one consistent snapshot instead of a single unbounded result.
   await client.query(`DECLARE backup_rows NO SCROLL CURSOR FOR SELECT row_to_json(t) AS row FROM ${table} t`)
   while (true) {
    const rows = (await client.query('FETCH 10 FROM backup_rows')).rows
    if (!rows.length) break
    for (const row of rows) {
     totalBytes += Buffer.byteLength(JSON.stringify(row.row))
     if (totalBytes > p.backupMaxBytes) fail(413, 'BACKUP_TOO_LARGE', '备份超过当前大小限制，请调整策略或使用数据库原生备份')
     data[table]!.push(row.row)
    }
   }
   await client.query('CLOSE backup_rows')
  }
  const files: { user:string; sha256:string; content:string }[] = []
  const seen = new Set<string>()
  for (const row of data.cloud_file_parts!) {
   const part = z.object({ user_id:z.uuid(),sha256:z.string().regex(/^[a-f0-9]{64}$/) }).parse(row)
   const key = `${part.user_id}:${part.sha256}`
   if (seen.has(key)) continue
   seen.add(key)
   const bytes = await readFile(partPath(s,part.user_id,part.sha256))
   if (createHash('sha256').update(bytes).digest('hex') !== part.sha256) fail(409,'FILE_DAMAGED','备份失败：文件完整性校验失败')
   totalBytes += bytes.length
   if (totalBytes > p.backupMaxBytes) fail(413,'BACKUP_TOO_LARGE','备份包含的文件超过大小限制')
   files.push({ user:part.user_id,sha256:part.sha256,content:bytes.toString('base64') })
  }
  await client.query('COMMIT')
  const archive = seal({ format: 2, createdAt: new Date().toISOString(), tables: data, files }, s.config.MASTER_KEY)
  await mkdir(resolve(s.config.DATA_DIR,'backups'), { recursive: true, mode: 0o700 })
  await writeFile(backupPath(s,id), archive, { mode: 0o600, flag: 'wx' })
  // An optional remote copy supplements the local recovery file; failure is explicit and retryable.
  let remote = false
  if (await secretSetting(s,'storage',storageSchema)) {
   const { client: store, bucket } = await s3(s)
   try {
    await store.send(new PutObjectCommand({ Bucket: bucket, Key: `dsh-studio/backups/${id}.json.enc`, Body: archive, ContentType: 'application/octet-stream' }))
    remote = true
   } catch {
    await unlink(backupPath(s,id))
    fail(502, 'BACKUP_UPLOAD_FAILED', '备份未完成：S3 上传失败，请检查存储配置后重试')
   } finally { store.destroy() }
  }
  await s.db.query('INSERT INTO backups(id,filename,bytes,remote) VALUES($1,$2,$3,$4)', [id,`${id}.json.enc`,Buffer.byteLength(archive),remote])
  await audit(s.db,actor,'backup.created',id)
  return { id, remoteCopy: remote }
 } catch (error) {
  await client.query('ROLLBACK')
  throw error
 } finally {
  if (locked) {
   await client.query('SELECT pg_advisory_unlock_shared(702120)')
   await client.query('SELECT pg_advisory_unlock(702118)')
  }
  client.release()
 }
}

/** Restore is transactional and invalidates all sessions and sync cursors. The file requires the original master key. */
export async function restoreBackup(s: Services, id: string) {
 const archive = archiveSchema.parse(unseal(await readFile(backupPath(s,id),'utf8'),s.config.MASTER_KEY))
 if (archive.format === 2) {
  for (const file of archive.files) {
   const bytes = Buffer.from(file.content,'base64')
   if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) fail(409,'FILE_DAMAGED','备份文件完整性校验失败')
  }
  for (const file of archive.files) {
   const path = partPath(s,file.user,file.sha256)
   await mkdir(resolve(path,'..'),{recursive:true,mode:0o700})
   await writeFile(path,Buffer.from(file.content,'base64'),{mode:0o600})
  }
 }
 await transaction(s.db, async c => {
  await c.query('SELECT pg_advisory_xact_lock(702118)')
  await c.query('TRUNCATE users,settings,audit_events CASCADE')
  for (const table of archive.format === 1 ? legacyTables : tables) {
   let rows = table === 'cloud_files' || table === 'cloud_file_parts'
    ? archive.format === 2 ? archive.tables[table] : []
    : archive.tables[table]
   if (archive.format === 1 && table === 'sync_objects') rows = rows.map(row => ({...row,file_refs:[]}))
   if (rows.length) await c.query(`INSERT INTO ${table} OVERRIDING SYSTEM VALUE SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`, [JSON.stringify(rows)])
  }
  await c.query('UPDATE users SET sync_epoch=gen_random_uuid()')
  await c.query("SELECT setval(pg_get_serial_sequence('audit_events','id'),COALESCE((SELECT max(id) FROM audit_events),1),EXISTS(SELECT 1 FROM audit_events))")
  await audit(c,null,'backup.restored',id)
 })
}

/** Purge requires an explicit admin action; background tasks never shorten deletion windows silently. */
export async function cleanup(s: Services) {
 const p = await policies(s)
 await transaction(s.db, async c => {
  await c.query('SELECT pg_advisory_xact_lock(702119)')
  await c.query('SELECT pg_advisory_xact_lock(702120)')
  const users = (await c.query('SELECT id FROM users ORDER BY id FOR UPDATE')).rows
  for (const user of users) {
   const cutoff = (await c.query(`SELECT max(seq) AS floor FROM sync_changes WHERE user_id=$1 AND
    (created_at<now()-make_interval(days=>$2) OR object_id IN
     (SELECT id FROM sync_objects WHERE user_id=$1 AND deleted_at<now()-make_interval(days=>$3)))`, [user.id,p.changeDays,p.deletionDays])).rows[0].floor
   if (cutoff !== null) {
    await c.query('UPDATE users SET sync_floor=greatest(sync_floor,$1) WHERE id=$2', [cutoff,user.id])
    await c.query('DELETE FROM sync_changes WHERE user_id=$1 AND seq<=$2', [user.id,cutoff])
   }
   // Keep compact tombstones indefinitely so a device cannot recreate a purged ID.
   await c.query(`UPDATE sync_objects SET payload=NULL,bytes=4,file_refs='[]'::jsonb WHERE user_id=$1 AND deleted_at<now()-make_interval(days=>$2)`, [user.id,p.deletionDays])
   await c.query("DELETE FROM sync_requests WHERE user_id=$1 AND created_at<now()-make_interval(days=>$2)", [user.id,p.changeDays])
  }
  await c.query('DELETE FROM sync_snapshots WHERE expires_at<now()')
  await c.query(`DELETE FROM cloud_files f WHERE created_at<now()-make_interval(days=>$1)
   AND NOT EXISTS(SELECT 1 FROM sync_objects o WHERE o.user_id=f.user_id AND o.file_refs ? f.id::text)
   AND NOT EXISTS(SELECT 1 FROM sync_changes h WHERE h.user_id=f.user_id AND h.value->'fileRefs' ? f.id::text)
   AND NOT EXISTS(SELECT 1 FROM sync_snapshot_items i JOIN sync_snapshots p ON p.id=i.snapshot_id
    WHERE p.user_id=f.user_id AND i.value->'fileRefs' ? f.id::text)`,[p.deletionDays])
  await c.query("DELETE FROM action_tokens WHERE expires_at<now()-interval '1 day'")
 })
 await transaction(s.db,async c=>{
  await c.query('SELECT pg_advisory_xact_lock(702120)')
  const directory=resolve(s.config.DATA_DIR,'files')
  let accounts:string[] = []
  try { accounts=await readdir(directory) }
  catch(error) { if(!(error instanceof Error && 'code' in error && error.code==='ENOENT'))throw error }
  for(const account of accounts) {
   if(!z.uuid().safeParse(account).success)continue
   const parts=await readdir(join(directory,account))
   for(const part of parts) {
    if(!/^[a-f0-9]{64}$/.test(part))continue
    const retained=await c.query('SELECT 1 FROM cloud_file_parts WHERE user_id=$1 AND sha256=$2 LIMIT 1',[account,part])
    if(!retained.rowCount)await unlink(partPath(s,account,part))
   }
  }
 })
 // Delete both copies before dropping their tracking row; failed storage operations remain retryable.
 const old = (await s.db.query(`SELECT id,remote FROM backups WHERE created_at<now()-make_interval(days=>$1)
  OR id IN (SELECT id FROM backups ORDER BY created_at DESC OFFSET $2)`, [p.backupDays,p.maxBackups])).rows
 for (const row of old) {
  if (row.remote) {
   const { client, bucket } = await s3(s)
   try { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: `dsh-studio/backups/${row.id}.json.enc` })) }
   finally { client.destroy() }
  }
  try { await unlink(backupPath(s,row.id)) }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
  await s.db.query('DELETE FROM backups WHERE id=$1', [row.id])
 }
 return { ok: true, localBackupsRemoved: old.length }
}
