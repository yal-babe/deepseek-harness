/** Admin-only release discovery and version-bound Docker update dispatch. */
import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { gt, lt, valid } from 'semver'
import { audit, fail, identity, type Services } from './common.js'
import { createBackup } from './maintenance.js'
import { saveSecret, secretSetting } from './settings.js'
import { serverVersion } from './version.js'

const httpUrl = z.url().refine(value => {
 const url = new URL(value)
 return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash
}, 'Expected HTTP(S) URL without credentials or fragment')
const settingsSchema = z.object({ manifestUrl: z.union([z.literal(''), httpUrl]) }).strict()
const version = z.string().refine(value => valid(value) === value, 'Expected semantic version')
const releaseSchema = z.object({ version, image: z.string().max(512), notes: z.string().max(16000).default(''),
 minimumVersion: version.optional(), rollbackCompatible: z.boolean().default(false) }).strict()

async function source(s: Services) {
 return await secretSetting(s,'updates',settingsSchema) ?? { manifestUrl: s.config.UPDATE_MANIFEST_URL }
}
async function release(s: Services) {
 const settings = await source(s)
 if (!settings.manifestUrl) fail(409,'UPDATE_SOURCE_MISSING','请先配置服务端版本清单地址')
 const response = await fetch(settings.manifestUrl,{ signal: AbortSignal.timeout(15000), redirect:'error' })
 if (!response.ok || !response.body) fail(502,'UPDATE_SOURCE_FAILED','无法读取版本清单')
 const reader = response.body.getReader(), chunks: Uint8Array[] = []
 let bytes = 0
 try {
  while (true) {
   const part = await reader.read(); if (part.done) break
   bytes += part.value.byteLength
   if (bytes > 262144) { await reader.cancel(); fail(502,'UPDATE_MANIFEST_TOO_LARGE','版本清单过大') }
   chunks.push(part.value)
  }
 } finally { reader.releaseLock() }
 const candidate = releaseSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
 const prefix = s.config.UPDATE_IMAGE_REPOSITORY
 if (!prefix || !candidate.image.startsWith(`${prefix}@sha256:`)
  || !/^[a-f0-9]{64}$/.test(candidate.image.slice(prefix.length + 8))) {
  fail(409,'UPDATE_IMAGE_REJECTED','版本镜像必须属于部署配置的仓库，并使用 sha256 摘要固定版本')
 }
 return { ...candidate, available: gt(candidate.version,serverVersion),
  compatible: !candidate.minimumVersion || !lt(serverVersion,candidate.minimumVersion) }
}
async function worker(s: Services, path: string, body?: unknown) {
 if (!s.config.UPDATER_URL || !s.config.UPDATER_TOKEN) fail(409,'UPDATER_DISABLED','尚未启用 Docker 更新执行器')
 const response = await fetch(new URL(path,s.config.UPDATER_URL),{
  method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(15000),
  headers:{ authorization:`Bearer ${s.config.UPDATER_TOKEN}`, 'content-type':'application/json' },
  ...(body === undefined ? {} : { body:JSON.stringify(body) }),
 })
 if (!response.ok) fail(response.status === 409 ? 409 : 502,'UPDATER_FAILED','更新执行器拒绝请求或暂时不可用')
 return response.json()
}

/** @param app - HTTP owner. @param s - deployment and authenticated data services. */
export async function updateRoutes(app: FastifyInstance,s: Services) {
 let starting = false
 app.get('/v1/admin/updates',async req => {
  await identity(s,req,true)
  return { currentVersion:serverVersion, ...await source(s), imageRepository:s.config.UPDATE_IMAGE_REPOSITORY,
   enabled:Boolean(s.config.UPDATER_URL && s.config.UPDATER_TOKEN && s.config.UPDATE_IMAGE_REPOSITORY) }
 })
 app.put('/v1/admin/updates/source',async req => {
  const actor = await identity(s,req,true)
  await saveSecret(s,'updates',settingsSchema.parse(req.body))
  await audit(s.db,actor.id,'update.source_saved'); return { ok:true }
 })
 app.post('/v1/admin/updates/check',async req => {
  await identity(s,req,true); return release(s)
 })
 app.get('/v1/admin/updates/status',async req => {
  await identity(s,req,true)
  return worker(s,'/status')
 })
 app.post('/v1/admin/updates/install',async (req,reply) => {
  const actor = await identity(s,req,true)
  const request = z.object({ version, image:z.string(), confirmation:z.literal('UPDATE') }).strict().parse(req.body)
  if (starting) fail(409,'UPDATE_BUSY','已有更新正在准备')
  starting = true
  try {
   const candidate = await release(s)
   if (!candidate.available || !candidate.compatible || request.version !== candidate.version || request.image !== candidate.image)
    fail(409,'UPDATE_CHANGED','更新版本已变化或不可直接升级，请重新检查')
   await worker(s,'/ready')
   const backup = await createBackup(s,actor.id)
   const job = { id:randomUUID(), version:candidate.version, image:candidate.image,
    backupId:backup.id, rollbackCompatible:candidate.rollbackCompatible }
   await audit(s.db,actor.id,'update.requested',job.id)
   return reply.code(202).send(await worker(s,'/jobs',job))
  } finally { starting = false }
 })
}
