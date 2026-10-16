import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { transaction } from './db.js'
import { policies, secretSetting, storageSchema, s3 } from './settings.js'
import { seal, unseal } from './security.js'
import { fail, audit, type Services } from './common.js'

const tables = ['users','settings','sync_objects','sync_changes','audit_events'] as const
const archiveSchema = z.object({ format: z.literal(1), createdAt: z.string(), tables: z.object({
 users: z.array(z.record(z.string(),z.unknown())), settings: z.array(z.record(z.string(),z.unknown())),
 sync_objects: z.array(z.record(z.string(),z.unknown())), sync_changes: z.array(z.record(z.string(),z.unknown())),
 audit_events: z.array(z.record(z.string(),z.unknown())),
}).strict() }).strict()
const backupPath = (s: Services, id: string) => join(resolve(s.config.DATA_DIR), 'backups', `${id}.json.enc`)

/** Backups contain database state only; no live model credentials or client files are collected. */
export async function createBackup(s: Services, actor: string | null) {
 const p = await policies(s), id = randomUUID()
 const client = await s.db.connect()
 let locked = false
 try {
  locked = (await client.query('SELECT pg_try_advisory_lock(702118) AS locked')).rows[0].locked
  if (!locked) fail(409, 'BACKUP_BUSY', '备份或恢复正在运行')
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
  await client.query('COMMIT')
  const archive = seal({ format: 1, createdAt: new Date().toISOString(), tables: data }, s.config.MASTER_KEY)
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
  if (locked) await client.query('SELECT pg_advisory_unlock(702118)')
  client.release()
 }
}

/** Restore is transactional and invalidates all sessions and sync cursors. The file requires the original master key. */
export async function restoreBackup(s: Services, id: string) {
 const archive = archiveSchema.parse(unseal(await readFile(backupPath(s,id),'utf8'),s.config.MASTER_KEY))
 await transaction(s.db, async c => {
  await c.query('SELECT pg_advisory_xact_lock(702118)')
  await c.query('TRUNCATE users,settings,audit_events CASCADE')
  for (const table of tables) {
   if (archive.tables[table].length) await c.query(`INSERT INTO ${table} OVERRIDING SYSTEM VALUE SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`, [JSON.stringify(archive.tables[table])])
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
   await c.query(`UPDATE sync_objects SET payload=NULL,bytes=4 WHERE user_id=$1 AND deleted_at<now()-make_interval(days=>$2)`, [user.id,p.deletionDays])
   await c.query("DELETE FROM sync_requests WHERE user_id=$1 AND created_at<now()-make_interval(days=>$2)", [user.id,p.changeDays])
  }
  await c.query('DELETE FROM sync_snapshots WHERE expires_at<now()')
  await c.query("DELETE FROM action_tokens WHERE expires_at<now()-interval '1 day'")
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
