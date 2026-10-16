import type { FastifyRequest, FastifyReply } from 'fastify'
import type { PoolClient } from 'pg'
import { z } from 'zod'
import type { DB } from './db.js'
import type { Config } from './config.js'
import { digest } from './security.js'

export class ApiError extends Error {
 constructor(public statusCode: number, public code: string, message: string) { super(message) }
}
export function fail(status: number, code: string, message: string): never { throw new ApiError(status, code, message) }
export const username = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_.-]{2,31}$/)
export const password = z.string().min(12).max(256)
export const email = z.email().max(254).transform(s => s.toLowerCase())
export const objectId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/)
export const uuidParam = (req: FastifyRequest) => z.object({ id: z.uuid() }).parse(req.params).id
export type Identity = { id: string; session_id: string; username: string; role: 'user' | 'admin'; email: string | null;
 display_name: string; must_change_password: boolean; csrf: string }
export interface Services { db: DB; config: Config }

export async function identity(s: Services, req: FastifyRequest, admin = false, allowPasswordChange = false): Promise<Identity> {
 const bearer = req.headers.authorization
 const value = bearer ? /^Bearer ([A-Za-z0-9_-]{43})$/.exec(bearer)?.[1] : req.cookies.access
 if (!value) fail(401, 'UNAUTHORIZED', '请先登录')
 const rows = await s.db.query<Identity>(`SELECT u.id,u.username,u.role,u.email,u.display_name,u.must_change_password,
 s.id AS session_id,s.csrf FROM auth_sessions s JOIN users u ON u.id=s.user_id
 WHERE s.access_hash=$1 AND NOT s.revoked AND NOT u.disabled AND s.access_expires>now() AND s.refresh_expires>now()`, [digest(value)])
 const user = rows.rows[0]
 if (!user) fail(401, 'UNAUTHORIZED', '登录已失效，请重新登录')
 if (!bearer && !['GET','HEAD','OPTIONS'].includes(req.method)) {
  if (req.headers.origin !== s.config.PUBLIC_URL || req.headers['x-csrf-token'] !== user.csrf)
   fail(403, 'CSRF', '请求来源或安全令牌无效')
 }
 if (admin && user.role !== 'admin') fail(403, 'FORBIDDEN', '需要管理员权限')
 if (user.must_change_password && !allowPasswordChange) fail(403, 'PASSWORD_CHANGE_REQUIRED', '请先修改初始密码')
 return user
}
export async function audit(db: DB | PoolClient, actor: string | null, action: string, target: string | null = null) {
 await db.query('INSERT INTO audit_events(actor_id,action,target) VALUES($1,$2,$3)', [actor, action, target])
}
export function setSessionCookies(reply: FastifyReply, config: Config, access: string, refresh: string) {
 reply.setCookie('access', access, { path: '/', httpOnly: true, secure: config.secureCookie, sameSite: 'strict', maxAge: config.ACCESS_TTL_SECONDS })
 reply.setCookie('refresh', refresh, { path: '/v1/auth', httpOnly: true, secure: config.secureCookie, sameSite: 'strict', maxAge: config.REFRESH_TTL_SECONDS })
}
export function clearSessionCookies(reply: FastifyReply) {
 reply.clearCookie('access', { path: '/' }).clearCookie('refresh', { path: '/v1/auth' })
}
