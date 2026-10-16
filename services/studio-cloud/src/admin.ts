import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { passwordHash, token, digest } from './security.js'
import { username, password, email, identity, audit, fail, uuidParam, type Services } from './common.js'
import { transaction } from './db.js'
import { policies, policiesSchema, smtpSchema, storageSchema, secretSetting, saveSecret, mail, testStorage } from './settings.js'
import { createBackup, restoreBackup, cleanup } from './maintenance.js'

export async function adminRoutes(app: FastifyInstance, s: Services) {
 app.get('/v1/admin/overview', async req => {
  await identity(s,req,true)
  return (await s.db.query(`SELECT (SELECT count(*) FROM users) AS users,
   (SELECT count(*) FROM auth_sessions WHERE NOT revoked AND refresh_expires>now()) AS devices,
   (SELECT count(*) FROM sync_objects) AS objects,
   (SELECT COALESCE(sum(bytes),0) FROM sync_objects)+(SELECT COALESCE(sum(bytes),0) FROM sync_changes) AS bytes,
   (SELECT count(*) FROM backups) AS backups`)).rows[0]
 })
 app.get('/v1/admin/users', async req => {
  await identity(s,req,true)
  return (await s.db.query(`SELECT u.id,u.username,u.email,u.display_name,u.role,u.disabled,u.must_change_password,u.quota_bytes,u.encryption_mode,u.created_at,
   COALESCE((SELECT sum(bytes) FROM sync_objects WHERE user_id=u.id),0)+COALESCE((SELECT sum(bytes) FROM sync_changes WHERE user_id=u.id),0) AS used_bytes
   FROM users u ORDER BY u.created_at DESC LIMIT 500`)).rows
 })
 app.post('/v1/admin/users', async req => {
  const u = await identity(s,req,true)
  const b = z.object({ username, password, displayName: z.string().max(80).default('') }).strict().parse(req.body)
  const id = randomUUID()
  await transaction(s.db, async c => {
   await c.query('INSERT INTO users(id,username,password_hash,display_name,must_change_password,sync_epoch) VALUES($1,$2,$3,$4,true,$5)', [id,b.username,await passwordHash(b.password),b.displayName,randomUUID()])
   await audit(c,u.id,'user.created',id)
  }); return { id, mustChangePassword: true }
 })
 app.patch('/v1/admin/users/:id', async req => {
  const u = await identity(s,req,true), id = uuidParam(req)
  const b = z.object({ disabled: z.boolean().optional(), quotaBytes: z.number().int().min(0).max(1099511627776).nullable().optional(),
   password: password.optional(), revokeSessions: z.boolean().optional() }).strict().parse(req.body)
  if (id === u.id && (b.disabled || b.password)) fail(400,'ADMIN_SELF_CHANGE','请使用个人密码接口；不能禁用当前管理员')
  await transaction(s.db, async c => {
   const target = (await c.query('SELECT role FROM users WHERE id=$1 FOR UPDATE',[id])).rows[0]
   if (!target) fail(404,'NOT_FOUND','用户不存在')
   if (target.role === 'admin' && b.disabled) fail(400,'ADMIN_DISABLE','首版不支持禁用管理员账号')
   if (b.disabled !== undefined) await c.query('UPDATE users SET disabled=$1 WHERE id=$2',[b.disabled,id])
   if (b.quotaBytes !== undefined) await c.query('UPDATE users SET quota_bytes=$1 WHERE id=$2',[b.quotaBytes,id])
   if (b.password) {
    await c.query('UPDATE users SET password_hash=$1,must_change_password=true WHERE id=$2',[await passwordHash(b.password),id])
    await c.query('UPDATE action_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL',[id])
   }
   if (b.disabled || b.password || b.revokeSessions) await c.query('UPDATE auth_sessions SET revoked=true WHERE user_id=$1',[id])
   await audit(c,u.id,'user.updated',id)
  }); return { ok: true }
 })
 app.get('/v1/admin/invites', async req => {
  await identity(s,req,true)
  return (await s.db.query("SELECT token_hash AS id,email,expires_at,used_at,created_at FROM action_tokens WHERE kind='invite' ORDER BY created_at DESC LIMIT 200")).rows
 })
 app.post('/v1/admin/invites', async req => {
  const u = await identity(s,req,true)
  const b = z.object({ email: email.optional(), expiresHours: z.number().int().min(1).max(720).default(72), sendEmail: z.boolean().default(false) }).strict().parse(req.body)
  if (b.sendEmail && !b.email) fail(400,'EMAIL_REQUIRED','发送邀请需要邮箱')
  const raw = token(), id = digest(raw)
  await s.db.query("INSERT INTO action_tokens(token_hash,kind,email,expires_at) VALUES($1,'invite',$2,now()+make_interval(hours=>$3))",[id,b.email ?? null,b.expiresHours])
  const url = `${s.config.PUBLIC_URL}/account#action=invite&token=${raw}`
  if (b.sendEmail) await mail(s,b.email!,'DSH Studio 邀请',`你已获邀使用 DSH Studio，请在 ${b.expiresHours} 小时内打开：${url}`)
  await audit(s.db,u.id,'invite.created',id)
  return { id, url, token: raw }
 })
 app.delete('/v1/admin/invites/:id', async req => {
  const u = await identity(s,req,true)
  const id = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/) }).parse(req.params).id
  await s.db.query("UPDATE action_tokens SET used_at=now() WHERE token_hash=$1 AND kind='invite'",[id])
  await audit(s.db,u.id,'invite.revoked',id); return { ok: true }
 })
 app.get('/v1/admin/settings', async req => {
  await identity(s,req,true)
  const smtp = await secretSetting(s,'smtp',smtpSchema), storage = await secretSetting(s,'storage',storageSchema)
  return { policies: await policies(s), smtp: smtp ? { ...smtp,password: undefined } : null,
   storage: storage ? { ...storage,secretAccessKey: undefined,accessKeyId: undefined,credentialsConfigured: true } : null }
 })
 app.put('/v1/admin/settings/policies', async req => {
  const u = await identity(s,req,true)
  const input = z.object({ policies: policiesSchema, confirmShorterRetention: z.boolean().default(false) }).strict().parse(req.body)
  const b = input.policies, old = await policies(s)
  if (['deletionDays','changeDays','backupDays','maxBackups'].some(key => b[key as keyof typeof b] < old[key as keyof typeof old]) && !input.confirmShorterRetention)
   fail(409,'RETENTION_CONFIRMATION_REQUIRED','缩短保留期限可能永久清理数据，请确认后保存')
  await s.db.query("UPDATE settings SET value=$1 WHERE name='policies'",[b])
  await audit(s.db,u.id,'settings.policies_updated'); return { ok: true, cleanupRequiresConfirmation: false }
 })
 app.put('/v1/admin/settings/smtp', async req => {
  const u = await identity(s,req,true)
  const partial = smtpSchema.partial().parse(req.body)
  const b = smtpSchema.parse({ ...await secretSetting(s,'smtp',smtpSchema), ...partial })
  await saveSecret(s,'smtp',b); await audit(s.db,u.id,'settings.smtp_updated'); return { ok: true }
 })
 app.post('/v1/admin/settings/smtp/test', async req => {
  await identity(s,req,true)
  const b = z.object({ email }).strict().parse(req.body)
  await mail(s,b.email,'DSH Studio 邮件测试','邮件服务配置成功。'); return { ok: true }
 })
 app.put('/v1/admin/settings/storage', async req => {
  const u = await identity(s,req,true)
  const partial = z.object({ endpoint: z.url().optional(), region: z.string().optional(), bucket: z.string().optional(), accessKeyId: z.string().optional(), secretAccessKey: z.string().optional(), forcePathStyle: z.boolean().optional() }).strict().parse(req.body)
  const b = storageSchema.parse({ ...await secretSetting(s,'storage',storageSchema), ...partial })
  const old = await secretSetting(s,'storage',storageSchema)
  if (old && (old.endpoint !== b.endpoint || old.bucket !== b.bucket) && (await s.db.query('SELECT id FROM backups LIMIT 1')).rowCount)
   fail(409,'STORAGE_MIGRATION_REQUIRED','已有备份时不能直接更换存储位置，请先完成外部迁移')
  await saveSecret(s,'storage',b); await audit(s.db,u.id,'settings.storage_updated'); return { ok: true }
 })
 app.post('/v1/admin/settings/storage/test', async req => { await identity(s,req,true); await testStorage(s); return { ok: true } })
 app.get('/v1/admin/data', async req => {
  await identity(s,req,true)
  const q = z.object({ userId: z.uuid().optional() }).strict().parse(req.query)
  return (await s.db.query(`SELECT user_id,id,kind,parent_id,namespace,version,format_version,encrypted,bytes,deleted_at,updated_at
   FROM sync_objects WHERE ($1::uuid IS NULL OR user_id=$1) ORDER BY updated_at DESC LIMIT 500`,[q.userId ?? null])).rows
 })
 app.get('/v1/admin/audit', async req => { await identity(s,req,true); return (await s.db.query('SELECT * FROM audit_events ORDER BY id DESC LIMIT 200')).rows })
 app.get('/v1/admin/backups', async req => { await identity(s,req,true); return (await s.db.query('SELECT * FROM backups ORDER BY created_at DESC')).rows })
 app.post('/v1/admin/backups', async req => { const u = await identity(s,req,true); return createBackup(s,u.id) })
 app.post('/v1/admin/backups/:id/restore', async req => {
  const u = await identity(s,req,true), id = uuidParam(req)
  const b = z.object({ confirmation: z.literal('RESTORE'), password: z.string().max(256) }).strict().parse(req.body)
  const { passwordMatches } = await import('./security.js')
  const row = (await s.db.query('SELECT password_hash FROM users WHERE id=$1',[u.id])).rows[0]
  if (!await passwordMatches(b.password,row.password_hash)) fail(401,'PASSWORD_INVALID','管理员密码错误')
  if (!(await s.db.query('SELECT id FROM backups WHERE id=$1',[id])).rowCount) fail(404,'NOT_FOUND','备份不存在')
  await app.drain(req.id)
  try { await restoreBackup(s,id) }
  finally { app.maintenance = false }
  return { ok: true, loginRequired: true, syncResetRequired: true }
 })
 app.post('/v1/admin/cleanup', async req => {
  const u = await identity(s,req,true)
  z.object({ confirmation: z.literal('CLEANUP') }).strict().parse(req.body)
  const result = await cleanup(s); await audit(s.db,u.id,'retention.cleanup'); return result
 })
}
