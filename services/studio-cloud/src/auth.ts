import type { FastifyInstance, FastifyReply } from 'fastify'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { transaction } from './db.js'
import { passwordHash, passwordMatches, token, digest } from './security.js'
import { identity, username, password, email, fail, audit, setSessionCookies, clearSessionCookies, uuidParam, type Services } from './common.js'
import { mail, secretSetting, smtpSchema } from './settings.js'
import type { PoolClient } from 'pg'

const credentials = z.object({ login: z.string().trim().toLowerCase().min(1).max(254), password: z.string().max(256),
 deviceName: z.string().min(1).max(80).default('未命名设备'), client: z.enum(['web','device']).default('device') }).strict()
const loginLimit = { rateLimit: { max: 15, timeWindow: '15 minutes' } }

async function issue(c: PoolClient, s: Services, userId: string, deviceName: string) {
 const accessToken = token(), refreshToken = token(), csrf = token()
 await c.query(`INSERT INTO auth_sessions(id,user_id,device_name,access_hash,refresh_hash,csrf,access_expires,refresh_expires)
 VALUES($1,$2,$3,$4,$5,$6,now()+make_interval(secs=>$7),now()+make_interval(secs=>$8))`,
 [randomUUID(), userId, deviceName, digest(accessToken), digest(refreshToken), csrf, s.config.ACCESS_TTL_SECONDS,s.config.REFRESH_TTL_SECONDS])
 return { accessToken, refreshToken, csrf, expiresIn: s.config.ACCESS_TTL_SECONDS }
}
function loginResponse(reply: FastifyReply, s: Services, client: string, result: Awaited<ReturnType<typeof issue>>) {
 if (client === 'web') { setSessionCookies(reply, s.config, result.accessToken, result.refreshToken); return { csrf: result.csrf, expiresIn: result.expiresIn } }
 return result
}
/** Register only invitation-based onboarding; no public registration route exists. */
export async function authRoutes(app: FastifyInstance, s: Services) {
 const dummyHash = await passwordHash(token())
 app.post('/v1/auth/login', { config: loginLimit }, async (req, reply) => {
  const b = credentials.parse(req.body)
  const result = await transaction(s.db, async c => {
   const user = (await c.query('SELECT * FROM users WHERE username=$1 OR email=$1 FOR UPDATE', [b.login])).rows[0]
   const valid = await passwordMatches(b.password, user?.password_hash ?? dummyHash)
   if (!user || !valid || user.disabled) fail(401, 'LOGIN_FAILED', '账号或密码错误')
   const session = await issue(c, s, user.id, b.deviceName)
   await audit(c, user.id, 'auth.login')
   return session
  })
  return loginResponse(reply, s, b.client, result)
 })
 app.post('/v1/auth/refresh', { config: loginLimit }, async (req, reply) => {
  const web = Boolean(req.cookies.refresh)
  if (web && req.headers.origin !== s.config.PUBLIC_URL) fail(403, 'CSRF', '请求来源无效')
  const b = z.object({ refreshToken: z.string().max(128).optional() }).strict().parse(req.body ?? {})
  const hashed = digest(web ? req.cookies.refresh! : b.refreshToken ?? '')
  // Reuse revocation must commit even when the HTTP result is a rejection.
  const result = await transaction(s.db, async c => {
   const session = (await c.query(`SELECT a.*,u.disabled FROM auth_sessions a JOIN users u ON u.id=a.user_id
    WHERE a.refresh_hash=$1 OR a.previous_refresh_hash=$1 FOR UPDATE OF a,u`, [hashed])).rows[0]
   if (!session || session.disabled || session.revoked || new Date(session.refresh_expires).getTime() <= Date.now()) return null
   if (session.refresh_hash !== hashed) {
    await c.query('UPDATE auth_sessions SET revoked=true WHERE id=$1', [session.id]); return null
   }
   const accessToken = token(), refreshToken = token(), csrf = token()
   await c.query(`UPDATE auth_sessions SET access_hash=$1,previous_refresh_hash=refresh_hash,refresh_hash=$2,csrf=$3,
    access_expires=now()+make_interval(secs=>$5),last_seen=now() WHERE id=$4`, [digest(accessToken), digest(refreshToken), csrf, session.id,s.config.ACCESS_TTL_SECONDS])
   return { accessToken, refreshToken, csrf, expiresIn: s.config.ACCESS_TTL_SECONDS }
  })
  if (!result) { clearSessionCookies(reply); fail(401, 'UNAUTHORIZED', '登录已失效，请重新登录') }
  return loginResponse(reply, s, web ? 'web' : 'device', result)
 })
 app.get('/v1/auth/session', async req => {
  const u = await identity(s, req, false, true)
  return { id: u.id, username: u.username, email: u.email, displayName: u.display_name, role: u.role, csrf: u.csrf, mustChangePassword: u.must_change_password }
 })
 app.post('/v1/auth/logout', async (req, reply) => {
  const u = await identity(s, req, false, true)
  await s.db.query('UPDATE auth_sessions SET revoked=true WHERE id=$1', [u.session_id])
  clearSessionCookies(reply); return { ok: true }
 })
 app.post('/v1/auth/accept-invite', { config: loginLimit }, async req => {
  const b = z.object({ token: z.string().min(32).max(128), username, password }).strict().parse(req.body)
  await transaction(s.db, async c => {
   const invite = (await c.query("SELECT * FROM action_tokens WHERE token_hash=$1 AND kind='invite' AND used_at IS NULL AND expires_at>now() FOR UPDATE", [digest(b.token)])).rows[0]
   if (!invite) fail(400, 'INVALID_TOKEN', '邀请无效、已撤销或已过期')
   await c.query('INSERT INTO users(id,username,password_hash,email,sync_epoch) VALUES($1,$2,$3,$4,$5)',
    [randomUUID(), b.username, await passwordHash(b.password), invite.email, randomUUID()])
   await c.query('UPDATE action_tokens SET used_at=now() WHERE token_hash=$1', [digest(b.token)])
   await audit(c, null, 'invite.accepted')
  })
  return { ok: true }
 })
 app.post('/v1/me/password', { config: loginLimit }, async req => {
  const u = await identity(s, req, false, true)
  const b = z.object({ currentPassword: z.string().max(256), newPassword: password }).strict().parse(req.body)
  await transaction(s.db, async c => {
   const row = (await c.query('SELECT password_hash FROM users WHERE id=$1 FOR UPDATE', [u.id])).rows[0]
   if (!await passwordMatches(b.currentPassword, row.password_hash)) fail(401, 'PASSWORD_INVALID', '当前密码错误')
   await c.query('UPDATE users SET password_hash=$1,must_change_password=false WHERE id=$2', [await passwordHash(b.newPassword), u.id])
   await c.query('UPDATE auth_sessions SET revoked=true WHERE user_id=$1', [u.id])
   await audit(c, u.id, 'auth.password_changed')
  })
  return { ok: true, loginRequired: true }
 })
 app.post('/v1/me/email', { config: loginLimit }, async req => {
  const u = await identity(s, req)
  const b = z.object({ email, password: z.string().max(256) }).strict().parse(req.body)
  const row = (await s.db.query('SELECT password_hash FROM users WHERE id=$1', [u.id])).rows[0]
  if (!await passwordMatches(b.password, row.password_hash)) fail(401, 'PASSWORD_INVALID', '当前密码错误')
  const raw = token()
  await s.db.query(`INSERT INTO action_tokens(token_hash,kind,user_id,email,expires_at)
   VALUES($1,'email',$2,$3,now()+interval '30 minutes')`, [digest(raw), u.id, b.email])
  await mail(s, b.email, 'DSH Studio 邮箱验证', `请在 30 分钟内打开：${s.config.PUBLIC_URL}/account#action=email&token=${raw}`)
  return { ok: true }
 })
 app.post('/v1/auth/verify-email', { config: loginLimit }, async req => {
  const b = z.object({ token: z.string().min(32).max(128) }).strict().parse(req.body)
  await transaction(s.db, async c => {
   const row = (await c.query("SELECT * FROM action_tokens WHERE token_hash=$1 AND kind='email' AND used_at IS NULL AND expires_at>now() FOR UPDATE", [digest(b.token)])).rows[0]
   if (!row) fail(400, 'INVALID_TOKEN', '验证链接无效或已过期')
   await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [row.user_id])
   await c.query('UPDATE users SET email=$1 WHERE id=$2 AND NOT disabled', [row.email, row.user_id])
   await c.query("UPDATE action_tokens SET used_at=now() WHERE user_id=$1 AND kind='email' AND used_at IS NULL", [row.user_id])
   await audit(c, row.user_id, 'auth.email_verified')
  }); return { ok: true }
 })
 app.post('/v1/auth/forgot-password', { config: loginLimit }, async req => {
  const b = z.object({ email }).strict().parse(req.body)
  if (!await secretSetting(s, 'smtp', smtpSchema)) fail(503, 'MAIL_NOT_CONFIGURED', '请联系管理员配置邮件服务')
  const row = (await s.db.query('SELECT id FROM users WHERE email=$1 AND NOT disabled', [b.email])).rows[0]
  if (row) {
   const raw = token()
   await s.db.query("INSERT INTO action_tokens(token_hash,kind,user_id,expires_at) VALUES($1,'reset',$2,now()+interval '30 minutes')", [digest(raw), row.id])
   try { await mail(s, b.email, 'DSH Studio 密码重置', `请在 30 分钟内打开：${s.config.PUBLIC_URL}/account#action=reset&token=${raw}`) }
   catch { await audit(s.db, null, 'mail.reset_delivery_failed') }
  }
  return { ok: true, message: '若邮箱已绑定，将发送找回邮件' }
 })
 app.post('/v1/auth/reset-password', { config: loginLimit }, async req => {
  const b = z.object({ token: z.string().min(32).max(128), password }).strict().parse(req.body)
  await transaction(s.db, async c => {
   const row = (await c.query("SELECT * FROM action_tokens WHERE token_hash=$1 AND kind='reset' AND used_at IS NULL AND expires_at>now() FOR UPDATE", [digest(b.token)])).rows[0]
   if (!row) fail(400, 'INVALID_TOKEN', '重置链接无效或已过期')
   await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [row.user_id])
   await c.query('UPDATE users SET password_hash=$1,must_change_password=false WHERE id=$2', [await passwordHash(b.password), row.user_id])
   await c.query("UPDATE action_tokens SET used_at=now() WHERE user_id=$1 AND kind IN ('reset','email') AND used_at IS NULL", [row.user_id])
   await c.query('UPDATE auth_sessions SET revoked=true WHERE user_id=$1', [row.user_id])
   await audit(c, row.user_id, 'auth.password_reset')
  }); return { ok: true }
 })
 app.get('/v1/me/devices', async req => {
  const u = await identity(s, req)
  return (await s.db.query(`SELECT id,device_name,created_at,last_seen,revoked,refresh_expires,
   id=$2 AS current FROM auth_sessions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200`, [u.id, u.session_id])).rows
 })
 app.delete('/v1/me/devices/:id', async req => {
  const u = await identity(s, req)
  await s.db.query('UPDATE auth_sessions SET revoked=true WHERE id=$1 AND user_id=$2', [uuidParam(req), u.id])
  return { ok: true }
 })
}
