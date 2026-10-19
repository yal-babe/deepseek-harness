/** Restricted Compose updater: only the configured project's app service can be replaced. */
import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readFile, writeFile, rename, mkdir, stat, chown, open } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

const token = process.env.UPDATER_TOKEN ?? ''
const project = process.env.COMPOSE_PROJECT_NAME ?? ''
const repository = process.env.UPDATE_IMAGE_REPOSITORY ?? ''
if (token.length < 32 || !/^[a-z0-9][a-z0-9_-]*$/.test(project) || !repository || repository.includes('@')) {
 throw new Error('Configure UPDATER_TOKEN (32+ characters), COMPOSE_PROJECT_NAME, and UPDATE_IMAGE_REPOSITORY')
}
const deployment = '/deployment', statePath = '/state/update.json'
const composeFile = process.env.STUDIO_UPDATE_COMPOSE_FILE || 'compose.yaml'
if (!['compose.yaml','compose.external-pg.yaml'].includes(composeFile)) throw new Error('Unsupported Compose deployment file')
const active = new Set(['pulling','restarting','verifying','rolling-back'])
class UpdateRunner {
 state = { phase:'idle' }
 running = false
 lockChild
 async initialize() {
  await mkdir('/state',{ recursive:true })
  try { this.state = JSON.parse(await readFile(statePath,'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  if (active.has(this.state.phase)) await this.set({ phase:'interrupted', message:'更新执行器曾重启，请检查部署状态后重试；未自动恢复数据库。' })
 }
 async set(value) {
  this.state = { ...this.state, ...value, updatedAt:new Date().toISOString() }
  await writeFile(`${statePath}.tmp`,JSON.stringify(this.state)+'\n',{ mode:0o600 })
  await rename(`${statePath}.tmp`,statePath)
 }
 async acquireLock() {
  const directory = `${deployment}/.studio-update`, path = `${directory}/lock`
  const owner = await stat(deployment)
  try { await mkdir(directory,{ mode:0o700 }); await chown(directory,owner.uid,owner.gid) }
  catch (error) { if (error.code !== 'EEXIST') throw error }
  try { const file = await open(path,'wx',0o600); await file.close(); await chown(path,owner.uid,owner.gid) }
  catch (error) { if (error.code !== 'EEXIST') throw error }
  await new Promise((resolve,reject) => {
   const child = spawn('flock',['--nonblock',path,'sh','-c','printf locked; cat >/dev/null'],{ stdio:['pipe','pipe','ignore'] })
   child.once('error',reject)
   child.stdout.once('data',() => { this.lockChild = child; resolve() })
   child.once('close',() => { if (this.lockChild !== child) reject(new Error('Another deployment update holds the lock')) })
  })
 }
 async releaseLock() {
  const child = this.lockChild
  this.lockChild = undefined
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  await new Promise(resolve => {
   const timer = setTimeout(() => child.kill('SIGKILL'),5000)
   child.once('close',() => { clearTimeout(timer); resolve() })
   child.stdin.end()
  })
 }
 command(args, image, timeout = 180000) {
  return new Promise((resolve,reject) => {
   const child = spawn('docker',args,{ shell:false, cwd:deployment,
    env:{ ...process.env, ...(image ? { STUDIO_CLOUD_IMAGE:image } : {}) }, stdio:['ignore','pipe','ignore'] })
   let output = '', expired = false, kill
   child.stdout.on('data',chunk => { output = (output+chunk.toString()).slice(-65536) })
   const timer = setTimeout(() => { expired = true; child.kill('SIGTERM'); kill = setTimeout(() => child.kill('SIGKILL'),5000) },timeout)
   child.once('error',error => { clearTimeout(timer); clearTimeout(kill); reject(error) })
   child.once('close',code => { clearTimeout(timer); clearTimeout(kill)
    if (code === 0 && !expired) resolve(output.trim())
    else reject(new Error(expired ? 'Docker operation timed out' : 'Docker operation failed'))
   })
  })
 }
 compose(args,image) {
  return this.command(['compose','--project-directory',deployment,'--project-name',project,
   '--env-file',`${deployment}/.env`,'-f',`${deployment}/${composeFile}`,
   '-f',`${deployment}/compose.updates.yaml`,...args],image)
 }
 async container() {
  const id = await this.compose(['ps','--all','--quiet','app'])
  if (!/^[a-f0-9]{12,64}$/.test(id)) throw new Error('Expected one app container in the configured Compose project')
  const details = JSON.parse(await this.command(['inspect',id]))[0]
  if (details?.Config?.Labels?.['com.docker.compose.project'] !== project
   || details?.Config?.Labels?.['com.docker.compose.service'] !== 'app') throw new Error('Container ownership mismatch')
  return details
 }
 async saveImage(image) {
  const path = `${deployment}/.env`
  let env = await readFile(path,'utf8')
  // Only this deployment-owned key changes; passwords and every other setting are retained.
  env = env.replace(/^[ \t]*(?:export[ \t]+)?STUDIO_CLOUD_IMAGE[ \t]*=.*(?:\r?\n|$)/gm,'')
  if (env && !env.endsWith('\n')) env += '\n'
  env += `STUDIO_CLOUD_IMAGE=${image}\n`
  await writeFile(`${path}.studio-update.tmp`,env,{ mode:0o600 })
  await rename(`${path}.studio-update.tmp`,path)
 }
 async healthy(expectedVersion) {
  const deadline = Date.now()+180000
  while (Date.now() < deadline) {
   try {
    const response = await fetch('http://app:8788/health/ready',{ signal:AbortSignal.timeout(5000) })
    if (response.ok) {
     if (!expectedVersion) return
     const identity = await fetch('http://app:8788/v1/version',{ signal:AbortSignal.timeout(5000) })
     const data = await identity.json()
     if (identity.ok && (!expectedVersion || data.version === expectedVersion)) return
    }
   } catch { /* Container replacement briefly removes DNS and existing sockets. */ }
   await delay(2000)
  }
  throw new Error('Replacement did not become ready with the expected version')
 }
 async start(job) {
  if (this.running) return false
  this.running = true
  this.state = { ...job, phase:'pulling', message:'拉取目标镜像' }
  try { await this.set({}) }
  catch (error) { this.running = false; throw error }
  void this.execute(job).catch(() => {
   this.running = false
   this.state = { ...this.state, phase:'failed', message:'执行器状态写入失败，请检查持久化目录和部署容器。' }
  })
  return true
 }
 async execute(job) {
  let previousImage, replacing = false, imageSaved = false
  try {
   await this.acquireLock()
   const previous = await this.container()
   previousImage = previous.Image
   await this.set({ previousImage })
   await this.command(['pull',job.image],undefined,900000)
   // Pin before Compose recreates app; a host reboot or later compose up retains the chosen image.
   await this.saveImage(job.image)
   imageSaved = true
   await this.set({ phase:'restarting', message:'重建服务端容器，保留数据库和数据卷' })
   replacing = true
   await this.compose(['up','-d','--no-deps','--no-build','app'],job.image)
   await this.set({ phase:'verifying', message:'等待服务就绪并核对目标版本' })
   await this.healthy(job.version)
   await this.set({ phase:'completed', message:'更新完成' })
  } catch {
   if (previousImage && replacing && job.rollbackCompatible) {
    try {
     await this.set({ phase:'rolling-back', message:'目标未就绪，回退到更新前的镜像；不恢复或覆盖数据库' })
     await this.saveImage(previousImage)
     await this.compose(['up','-d','--no-deps','--no-build','app'],previousImage)
     await this.healthy()
     await this.set({ phase:'rolled-back', message:'已回退应用镜像。数据库未回退，备份编号见更新记录。' })
    } catch { await this.set({ phase:'failed', message:'更新或镜像回退失败，请管理员检查容器；备份及数据卷保持保留。' }) }
   } else {
    if (previousImage && imageSaved && !replacing) { try { await this.saveImage(previousImage) } catch { /* Report failure without exposing the deployment file. */ } }
    await this.set({ phase:'failed', message:replacing
     ? '新版本未就绪。该版本未声明数据库向后兼容，未自动回退；请按备份与迁移说明恢复。'
     : '拉取或准备失败，现有服务未被重建。请检查镜像仓库、凭据和 Docker 配置。' })
   }
  } finally { await this.releaseLock(); this.running = false }
 }
}
const runner = new UpdateRunner()
await runner.initialize()
const server = createServer(async (request,response) => {
 const expected = Buffer.from(`Bearer ${token}`), actual = Buffer.from(request.headers.authorization ?? '')
 const send = (status,data) => { response.writeHead(status,{ 'content-type':'application/json', 'cache-control':'no-store' }); response.end(JSON.stringify(data)) }
 if (expected.length !== actual.length || !timingSafeEqual(expected,actual)) return send(401,{ error:'Unauthorized' })
 try {
  if (request.method === 'GET' && request.url === '/status') return send(200,runner.state)
  if (request.method === 'GET' && request.url === '/ready') {
   if (runner.running) return send(409,{ error:'Update already running' })
   await runner.container(); return send(200,{ ready:true })
  }
  if (request.method !== 'POST' || request.url !== '/jobs') return send(404,{ error:'Not found' })
  let data = ''
  for await (const part of request) {
   data += part.toString()
   if (data.length > 8192) return send(413,{ error:'Request too large' })
  }
  const job = JSON.parse(data)
  if (!/^[a-f0-9-]{36}$/.test(job.id) || !/^[a-f0-9-]{36}$/.test(job.backupId)
   || typeof job.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(job.version)
   || typeof job.image !== 'string' || !job.image.startsWith(`${repository}@sha256:`)
   || !/^[a-f0-9]{64}$/.test(job.image.slice(repository.length+8)) || typeof job.rollbackCompatible !== 'boolean') {
   return send(400,{ error:'Invalid version-bound update job' })
  }
  if (runner.state.id === job.id) return send(200,runner.state)
  if (!await runner.start({ id:job.id,backupId:job.backupId,version:job.version,image:job.image,rollbackCompatible:job.rollbackCompatible }))
   return send(409,{ error:'Update already running' })
  send(202,runner.state)
 } catch { send(503,{ error:'Updater operation unavailable; check deployment configuration' }) }
})
server.requestTimeout = 30000
server.headersTimeout = 10000
server.listen(8790,'0.0.0.0')
