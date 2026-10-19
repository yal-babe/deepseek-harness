import { updateRoutes } from './updates.js'
import { serverVersion } from './version.js'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { readFile } from 'node:fs/promises'
import { ZodError } from 'zod'
import type { Config } from './config.js'
import { createDb, initialize } from './db.js'
import { ApiError, fail, type Services } from './common.js'
import { authRoutes } from './auth.js'
import { syncRoutes } from './sync.js'
import { adminRoutes } from './admin.js'
import { fileRoutes } from './files.js'
import { policies } from './settings.js'
import { schedule } from './scheduler.js'

declare module 'fastify' {
 interface FastifyInstance { maintenance: boolean; drain: (currentRequest: string) => Promise<void> }
}

/** Build the isolated HTTP service. Caller owns listen/close; closing also releases its database pool. */
export async function buildApp(config: Config, options: { logging?: boolean; background?: boolean } = {}) {
 const app = Fastify({ bodyLimit: 8 * 1024 * 1024, requestTimeout: 30000,
  logger: options.logging ? { redact: ['req.headers.authorization','req.headers.cookie','res.headers["set-cookie"]'] } : false })
 const db = createDb(config.DATABASE_URL), s: Services = { db, config }
 app.addHook('onClose', async () => { await db.end() })
 try { await initialize(db,config) }
 catch (error) { await app.close(); throw error }
 app.decorate('maintenance',false)
 const active = new Set<string>(), waiters = new Set<() => void>()
 let background: ReturnType<typeof schedule> | undefined
 app.decorate('drain',async (current: string) => {
  if (app.maintenance) fail(409,'MAINTENANCE','另一个恢复操作正在运行')
  app.maintenance = true
  await background?.idle()
  if (![...active].some(id => id !== current)) return
  await new Promise<void>(resolve => {
   const notify = () => { if (![...active].some(id => id !== current)) { waiters.delete(notify); resolve() } }
   waiters.add(notify); notify()
  })
 })
 app.addHook('onRequest', async (req,reply) => {
  reply.header('Cache-Control','no-store').header('Referrer-Policy','no-referrer')
  if (app.maintenance && !req.url.startsWith('/health/')) return reply.code(503).send({ error: { code: 'MAINTENANCE',message: '服务正在恢复数据，请稍后重试', requestId: req.id } })
  active.add(req.id)
  reply.raw.once('close',() => { active.delete(req.id); for (const notify of waiters) notify() })
 })
 app.addHook('onResponse',async req => { active.delete(req.id); for (const notify of waiters) notify() })
 await app.register(cookie)
 await app.register(helmet,{ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"],
  upgradeInsecureRequests: config.secureCookie ? [] : null,
 } }, hsts: config.secureCookie ? undefined : false })
 await app.register(rateLimit,{ max: 300, timeWindow: '1 minute' })
 app.setErrorHandler((error,req,reply) => {
  if (error instanceof ApiError) return reply.code(error.statusCode).send({ error: { code: error.code,message: error.message,requestId: req.id } })
  if (error instanceof ZodError) return reply.code(400).send({ error: { code: 'INVALID_INPUT',message: '请求字段或数据格式不正确',requestId: req.id } })
  if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
   return reply.code(409).send({ error: { code: 'ALREADY_EXISTS',message: '账号、邮箱或资源已存在',requestId: req.id } })
  if (error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500)
   return reply.code(error.statusCode).send({ error: { code: 'REQUEST_REJECTED',message: '请求被拒绝，请检查大小、格式或请求频率',requestId: req.id } })
  // Log the class/code only; driver errors may embed SQL parameters or SMTP credentials.
  app.log.error({ requestId: req.id, name: error instanceof Error ? error.name : 'UnknownError',
   code: error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined },'Service operation failed')
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR',message: '操作失败，请稍后重试并提供请求编号',requestId: req.id } })
 })
 app.get('/v1/version',async () => ({ product:'DSH Studio Cloud', version:serverVersion, protocolVersion:1 }))
 app.get('/health/live',async () => ({ status: 'ok',service: 'dsh-studio-cloud' }))
 app.get('/health/ready',async (_req,reply) => {
  if (app.maintenance) return reply.code(503).send({ status: 'maintenance' })
  await db.query('SELECT 1'); return { status: 'ready' }
 })
 app.get('/v1/capabilities',async () => ({
  protocolVersion:1, payloadVersions:[1], sync:{ maxObjectBytes:(await policies(s)).maxObjectBytes },
  files:{ enabled:true, partBytes:config.FILE_PART_BYTES, maxBytes:config.FILE_MAX_BYTES },
  sessionRestore:false, encryption:['plain'],
 }))
 await fileRoutes(app,s)
 await authRoutes(app,s)
 await syncRoutes(app,s)
 await adminRoutes(app,s)
 await updateRoutes(app,s)
 for (const [path,file,mime] of [['/admin','index.html','text/html; charset=utf-8'],['/account','account.html','text/html; charset=utf-8'],['/style.css','style.css','text/css; charset=utf-8'],['/admin.js','admin.js','text/javascript; charset=utf-8'],['/account.js','account.js','text/javascript; charset=utf-8']]) {
  app.get(path!,async (_req,reply) => reply.type(mime!).send(await readFile(new URL(`../public/${file}`,import.meta.url))))
 }
 app.get('/',async (_req,reply) => reply.redirect('/admin'))
 if (options.background) background = schedule(app,s)
 return { app, services: s }
}
