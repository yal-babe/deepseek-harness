import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes, createCipheriv, createHash } from 'node:crypto'
import { mkdtemp, rm, readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import nodemailer from 'nodemailer'
import { S3Client, CreateBucketCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { createBackup, cleanup } from '../src/maintenance.js'
import { partPath } from '../src/files.js'
import { policiesDefault } from '../src/db.js'

const baseUrl = process.env.TEST_DATABASE_URL
if (!baseUrl) throw new Error('Set TEST_DATABASE_URL to a dedicated PostgreSQL database; tests create and remove their own schema')
const db = new pg.Pool({ connectionString: baseUrl })
const schema = `test_${randomUUID().replaceAll('-','')}`
let service: Awaited<ReturnType<typeof buildApp>>, directory: string
let ip = 1
const adminPassword = 'Admin-test-password-2026'
type Login = { accessToken: string; refreshToken: string; csrf: string }
let admin: Login
const headers = (u: Login) => ({ authorization:`Bearer ${u.accessToken}` })
async function request(method: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE',url: string,body?: unknown,user?: Login) {
 return service.app.inject({ method,url,payload:body,headers:user ? headers(user) : {},remoteAddress:`10.9.0.${ip++ % 240 + 1}` })
}
async function login(name: string, password = 'Personal-test-password-2026') {
 const response = await request('POST','/v1/auth/login',{login:name,password})
 assert.equal(response.statusCode,200,response.body); return response.json<Login>()
}
async function newUser() {
 const name = `u_${randomUUID().slice(0,8)}`
 const invite = await request('POST','/v1/admin/invites',{},admin)
 assert.equal(invite.statusCode,200,invite.body)
 const accepted = await request('POST','/v1/auth/accept-invite',{token:invite.json().token,username:name,password:'Personal-test-password-2026'})
 assert.equal(accepted.statusCode,200,accepted.body)
 return { name,auth:await login(name) }
}
const plain = (id = 'project-1') => ({ id,kind:'project',baseVersion:0,formatVersion:1,encrypted:false,payload:{name:'private project'} })
async function push(u: Login,changes: unknown[],requestId = randomUUID()) {
 return request('POST','/v1/sync/push',{requestId,changes},u)
}

describe('standalone cloud service against PostgreSQL',()=>{
 before(async()=>{
  await db.query(`CREATE SCHEMA ${schema}`)
  const connection = new URL(baseUrl!); connection.searchParams.set('options',`-c search_path=${schema}`)
  directory = await mkdtemp(join(tmpdir(),'studio-cloud-'))
  service = await buildApp(loadConfig({ DATABASE_URL:connection.href,MASTER_KEY:randomBytes(32).toString('hex'),
   PUBLIC_URL:'http://localhost:8788',ALLOW_HTTP:'true',BOOTSTRAP_PASSWORD:adminPassword,DATA_DIR:directory }))
  await service.app.ready(); admin=await login('admin',adminPassword)
 })
 after(async()=>{ await service?.app.close(); await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await db.end(); if(directory)await rm(directory,{recursive:true,force:true}) })
 it('serves an isolated admin page, health endpoints, and no public registration',async()=>{
  assert.equal((await request('GET','/health/ready')).statusCode,200)
  const page=await request('GET','/admin');assert.equal(page.statusCode,200);assert.match(page.body,/云端管理/)
  assert.match(page.headers['content-security-policy']!,/script-src 'self'/)
  assert.doesNotMatch(page.headers['content-security-policy']!,/upgrade-insecure-requests/)
  assert.equal((await request('POST','/v1/auth/register',{})).statusCode,404)
  assert.equal((await request('GET','/v1/admin/users')).statusCode,401)
 })
 it('advertises protocol limits and keeps profile edits in the versioned sync history',async()=>{
  const caps=(await request('GET','/v1/capabilities')).json()
  assert.equal(caps.protocolVersion,1);assert.equal(caps.sessionRestore,false)
  const {auth}=await newUser(),requestId=randomUUID()
  const body={requestId,baseVersion:0,displayName:'Personal name'}
  assert.equal((await request('PUT','/v1/me/profile',body,auth)).statusCode,200)
  assert.equal((await request('PUT','/v1/me/profile',body,auth)).statusCode,200)
  assert.equal((await request('GET','/v1/auth/session',undefined,auth)).json().displayName,'Personal name')
  assert.equal((await request('GET','/v1/sync/pull',undefined,auth)).json().changes.length,1)
  assert.equal((await request('PUT','/v1/me/profile',{...body,requestId:randomUUID(),displayName:'conflict'},auth)).statusCode,409)
  assert.equal((await request('GET','/v1/me/profile',undefined,auth)).json().displayName,'Personal name')
 })
 it('resumes a file exceeding 4 MiB, checks immutable retries and isolates every download',async()=>{
  const {auth}=await newUser(),other=await newUser(),id=randomUUID()
  const bytes=randomBytes(5*1024*1024+127),sha256=createHash('sha256').update(bytes).digest('hex')
  const create=await request('POST','/v1/files',{id,bytes:bytes.length,sha256},auth)
  assert.equal(create.statusCode,200,create.body)
  const chunk=create.json().partBytes
  assert.equal((await request('POST',`/v1/files/${id}/complete`,{},auth)).statusCode,409)
  assert.equal((await push(auth,[{...plain('manifest'),fileRefs:[id]}])).statusCode,400)
  for(let offset=0;offset<bytes.length;offset+=chunk){
   const payload=bytes.subarray(offset,offset+chunk),url=`/v1/files/${id}/parts/${offset/chunk}`
   const response=await service.app.inject({method:'PUT',url,payload,headers:{...headers(auth),'content-type':'application/octet-stream'}})
   assert.equal(response.statusCode,200,response.body)
   if(offset===0){
    assert.equal((await request('GET',`/v1/files/${id}`,undefined,auth)).json().parts.length,1)
    const retry=await service.app.inject({method:'PUT',url,payload,headers:{...headers(auth),'content-type':'application/octet-stream'}})
    assert.equal(retry.statusCode,200)
    const replaced=await service.app.inject({method:'PUT',url,payload:Buffer.alloc(payload.length),headers:{...headers(auth),'content-type':'application/octet-stream'}})
    assert.equal(replaced.statusCode,409)
   }
  }
  assert.equal((await request('POST',`/v1/files/${id}/complete`,{},auth)).statusCode,200)
  assert.equal((await request('POST',`/v1/files/${id}/complete`,{},auth)).statusCode,200)
  assert.equal((await push(auth,[{...plain('manifest'),fileRefs:[id]}])).statusCode,200)
  assert.equal((await push(other.auth,[{...plain('manifest'),fileRefs:[id]}])).statusCode,400)
  for(const path of [`/v1/files/${id}`,`/v1/files/${id}/content`]) assert.equal((await request('GET',path,undefined,other.auth)).statusCode,404)
  assert.equal((await request('POST',`/v1/files/${id}/complete`,{},other.auth)).statusCode,404)
  const downloaded=await request('GET',`/v1/files/${id}/content`,undefined,auth)
  assert.equal(downloaded.statusCode,200);assert.deepEqual(downloaded.rawPayload,bytes)
  assert.ok((await request('GET','/v1/me/storage',undefined,auth)).json().usedBytes>bytes.length)
  const owner=(await request('GET','/v1/auth/session',undefined,auth)).json().id
  const backup=await createBackup(service.services,null)
  const first=(await request('GET',`/v1/files/${id}`,undefined,auth)).json().parts[0]
  await unlink(partPath(service.services,owner,first.sha256))
  assert.equal((await request('GET',`/v1/files/${id}/content`,undefined,auth)).statusCode,409)
  const restored=await request('POST',`/v1/admin/backups/${backup.id}/restore`,{confirmation:'RESTORE',password:adminPassword},admin)
  assert.equal(restored.statusCode,200,restored.body)
  admin=await login('admin',adminPassword)
  const renewed=await login((await service.services.db.query('SELECT username FROM users WHERE id=$1',[owner])).rows[0].username)
  assert.deepEqual((await request('GET',`/v1/files/${id}/content`,undefined,renewed)).rawPayload,bytes)
 })
 it('reserves file quota, rejects damaged completion and cleans expired unreferenced uploads',async()=>{
  const {auth}=await newUser(),id=randomUUID(),bytes=Buffer.from('private attachment'),sha256=createHash('sha256').update(bytes).digest('hex')
  const owner=(await request('GET','/v1/auth/session',undefined,auth)).json().id
  await request('PATCH',`/v1/admin/users/${owner}`,{quotaBytes:bytes.length},admin)
  assert.equal((await request('POST','/v1/files',{id,bytes:bytes.length,sha256},auth)).statusCode,200)
  assert.equal((await request('POST','/v1/files',{id:randomUUID(),bytes:1,sha256},auth)).statusCode,413)
  assert.equal((await request('GET','/v1/me/storage',undefined,auth)).json().usedBytes,bytes.length)
  const uploaded=await service.app.inject({method:'PUT',url:`/v1/files/${id}/parts/0`,payload:bytes,headers:{...headers(auth),'content-type':'application/octet-stream'}})
  assert.equal(uploaded.statusCode,200,uploaded.body)
  assert.equal((await request('POST',`/v1/files/${id}/complete`,{},auth)).statusCode,200)
  await service.services.db.query("UPDATE cloud_files SET created_at=now()-interval '100 days' WHERE user_id=$1",[owner])
  await cleanup(service.services)
  assert.equal((await request('GET',`/v1/files/${id}`,undefined,auth)).statusCode,404)
  assert.equal((await request('GET','/v1/me/storage',undefined,auth)).json().usedBytes,0)
  await assert.rejects(readFile(partPath(service.services,owner,sha256)),{code:'ENOENT'})
  const bad=randomUUID()
  await request('POST','/v1/files',{id:bad,bytes:bytes.length,sha256:'0'.repeat(64)},auth)
  await service.app.inject({method:'PUT',url:`/v1/files/${bad}/parts/0`,payload:bytes,headers:{...headers(auth),'content-type':'application/octet-stream'}})
  assert.equal((await request('POST',`/v1/files/${bad}/complete`,{},auth)).json().error.code,'FILE_CHECKSUM')
  assert.equal((await request('GET',`/v1/files/${bad}/content`,undefined,auth)).statusCode,404)
 })
 it('refuses startup with a different deployment master key without changing stored state',async()=>{
  await assert.rejects(buildApp({...service.services.config,MASTER_KEY:randomBytes(32).toString('hex')}))
  assert.equal((await request('GET','/health/ready')).statusCode,200)
 })
 it('accepts an invitation once, rejects expired invitations and enforces user/admin separation',async()=>{
  const invite=(await request('POST','/v1/admin/invites',{},admin)).json()
  const name=`invite_${randomUUID().slice(0,8)}`
  const body={token:invite.token,username:name,password:'Personal-test-password-2026'}
  assert.equal((await request('POST','/v1/auth/accept-invite',body)).statusCode,200)
  assert.equal((await request('POST','/v1/auth/accept-invite',{...body,username:`x_${name}`})).statusCode,400)
  const expired=(await request('POST','/v1/admin/invites',{},admin)).json()
  await service.services.db.query("UPDATE action_tokens SET expires_at=now()-interval '1 hour' WHERE token_hash=$1",[expired.id])
  assert.equal((await request('POST','/v1/auth/accept-invite',{...body,token:expired.token,username:`e_${name}`})).statusCode,400)
  assert.equal((await request('GET','/v1/admin/users',undefined,await login(name))).statusCode,403)
 })
 it('forces a temporary password change and invalidates prior access and refresh tokens',async()=>{
  const name=`created_${randomUUID().slice(0,8)}`
  assert.equal((await request('POST','/v1/admin/users',{username:name,password:'Temporary-password-2026'},admin)).statusCode,200)
  const auth=await login(name,'Temporary-password-2026')
  assert.equal((await request('GET','/v1/me/storage',undefined,auth)).json().error.code,'PASSWORD_CHANGE_REQUIRED')
  assert.equal((await request('POST','/v1/me/password',{currentPassword:'Temporary-password-2026',newPassword:'Changed-password-2026'},auth)).statusCode,200)
  assert.equal((await request('GET','/v1/auth/session',undefined,auth)).statusCode,401)
  assert.equal((await request('POST','/v1/auth/refresh',{refreshToken:auth.refreshToken})).statusCode,401)
  await login(name,'Changed-password-2026')
 })
 it('rotates refresh tokens and revokes a session on replay',async()=>{
  const {auth}=await newUser()
  const refreshed=await request('POST','/v1/auth/refresh',{refreshToken:auth.refreshToken})
  assert.equal(refreshed.statusCode,200,refreshed.body)
  assert.equal((await request('GET','/v1/auth/session',undefined,auth)).statusCode,401)
  assert.equal((await request('POST','/v1/auth/refresh',{refreshToken:auth.refreshToken})).statusCode,401)
  assert.equal((await request('GET','/v1/auth/session',undefined,refreshed.json())).statusCode,401)
 })
 it('enforces cookie CSRF and permits explicitly configured HTTP management',async()=>{
  const login=await request('POST','/v1/auth/login',{login:'admin',password:adminPassword,client:'web'})
  const cookie=login.cookies.filter(c=>c.name==='access').map(c=>`${c.name}=${c.value}`).join('; ')
  assert.equal(login.cookies.find(c=>c.name==='access')?.secure,undefined)
  const blocked=await service.app.inject({method:'POST',url:'/v1/admin/invites',headers:{cookie},payload:{}})
  assert.equal(blocked.statusCode,403)
  const accepted=await service.app.inject({method:'POST',url:'/v1/admin/invites',headers:{cookie,origin:'http://localhost:8788','x-csrf-token':login.json().csrf},payload:{}})
  assert.equal(accepted.statusCode,200,accepted.body)
 })
 it('isolates five data kinds and prevents cross-user parent references',async()=>{
  const a=await newUser(),b=await newUser()
  const changes=[plain(),{...plain('profile'),kind:'profile',payload:{nickname:'Alice'}},
   {...plain('preference'),kind:'preference',payload:{theme:'dark'}},
   {...plain('chat'),kind:'conversation',parentId:'project-1',payload:{messages:[{text:'hello'}]}},
   {...plain('plugin'),kind:'plugin',namespace:'example.notes',payload:{notes:['mine']}}]
  const response=await push(a.auth,changes);assert.equal(response.statusCode,200,response.body)
  assert.equal((await request('GET','/v1/sync/pull',undefined,b.auth)).json().changes.length,0)
  const foreign=await push(b.auth,[{...plain('foreign'),kind:'conversation',parentId:'project-1'}])
  assert.equal(foreign.statusCode,400)
  const foreignCursor=await request('GET',`/v1/sync/pull?cursor=${response.json().cursor}`,undefined,b.auth)
  assert.equal(foreignCursor.statusCode,403)
  assert.equal((await request('GET','/v1/sync/pull',undefined,a.auth)).json().changes.length,5)
 })
 it('deduplicates retries, rejects changed replay payload and atomically rejects conflicting batches',async()=>{
  const {auth}=await newUser(),id=randomUUID()
  const one=await push(auth,[plain()],id);assert.equal(one.statusCode,200,one.body)
  assert.deepEqual((await push(auth,[plain()],id)).json(),one.json())
  assert.equal((await push(auth,[{...plain(),payload:{name:'changed'}}],id)).statusCode,409)
  const batch=await push(auth,[plain('rollback'),plain()]);assert.equal(batch.statusCode,409)
  const all=(await request('GET','/v1/data',undefined,auth)).json().items
  assert.equal(all.length,1)
  const races=await Promise.all([push(auth,[{...plain(),baseVersion:1,payload:{name:'a'}}]),push(auth,[{...plain(),baseVersion:1,payload:{name:'b'}}])])
  assert.deepEqual(races.map(r=>r.statusCode).sort(),[200,409])
 })
 it('provides stable paged snapshots despite concurrent writes and rejects expired cursors after cleanup',async()=>{
  const {auth}=await newUser()
  await push(auth,[plain('a'),plain('b')])
  const first=await request('GET','/v1/sync/snapshot?limit=1',undefined,auth)
  assert.equal(first.json().items[0].payload.name,'private project')
  await push(auth,[{...plain('b'),baseVersion:1,payload:{name:'new'}}])
  const next=await request('GET',`/v1/sync/snapshot?snapshot=${first.json().snapshot}&after=a&limit=1`,undefined,auth)
  assert.equal(next.json().items[0].payload.name,'private project')
  const incremental=await request('GET',`/v1/sync/pull?cursor=${first.json().cursor}`,undefined,auth)
  assert.equal(incremental.json().changes.length,1)
  const owner=(await request('GET','/v1/auth/session',undefined,auth)).json().id
  await service.services.db.query("UPDATE sync_changes SET created_at=now()-interval '100 days' WHERE user_id=$1",[owner])
  await cleanup(service.services)
  assert.equal((await request('GET',`/v1/sync/pull?cursor=${first.json().cursor}`,undefined,auth)).statusCode,410)
 })
 it('enforces quota under concurrent uploads and still permits deletion when over quota',async()=>{
  const {auth}=await newUser(),id=(await request('GET','/v1/auth/session',undefined,auth)).json().id
  await request('PATCH',`/v1/admin/users/${id}`,{quotaBytes:1000},admin)
  const response=await Promise.all(['a','b'].map(id=>push(auth,[{...plain(id),payload:{text:'x'.repeat(300)}}])))
  assert.deepEqual(response.map(r=>r.statusCode).sort(),[200,413])
  const existing=(await request('GET','/v1/data',undefined,auth)).json().items[0]
  await request('PATCH',`/v1/admin/users/${id}`,{quotaBytes:0},admin)
  assert.equal((await push(auth,[{...plain(existing.id),baseVersion:1,payload:null,deleted:true}])).statusCode,200)
  assert.equal((await push(auth,[{...plain(existing.id),baseVersion:2}])).statusCode,409)
 })
 it('stores valid E2EE envelopes unchanged without decrypting and blocks plaintext/secret fields',async()=>{
  const {auth}=await newUser(),key=randomBytes(32),nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce)
  const data=Buffer.concat([cipher.update('only the device can read this'),cipher.final(),cipher.getAuthTag()]).toString('base64')
  const config={keyVersion:1,wrappedKey:randomBytes(48).toString('base64'),recoveryWrappedKey:randomBytes(48).toString('base64')}
  assert.equal((await request('PUT','/v1/me/crypto',{mode:'e2ee',config},auth)).statusCode,200)
  assert.equal((await push(auth,[plain()])).statusCode,400)
  const payload={algorithm:'AES-256-GCM',keyVersion:1,nonce:nonce.toString('base64'),ciphertext:data}
  const response=await push(auth,[{...plain(),encrypted:true,payload}]);assert.equal(response.statusCode,200,response.body)
  const pulled=(await request('GET','/v1/sync/pull',undefined,auth)).json()
  assert.deepEqual(pulled.changes[0].value.payload,payload)
  assert.doesNotMatch(JSON.stringify(pulled),/only the device/)
  assert.equal((await request('PUT','/v1/me/crypto',{mode:'plain',config:null},auth)).statusCode,409)
  const plainUser=await newUser()
  assert.equal((await push(plainUser.auth,[{...plain(),payload:{nested:{api_key:'secret'}}}])).statusCode,400)
 })
 it('revokes all user access immediately when disabled by an admin',async()=>{
  const {auth}=await newUser(),id=(await request('GET','/v1/auth/session',undefined,auth)).json().id
  assert.equal((await request('PATCH',`/v1/admin/users/${id}`,{disabled:true},admin)).statusCode,200)
  assert.equal((await request('GET','/v1/me/storage',undefined,auth)).statusCode,401)
  assert.equal((await request('POST','/v1/auth/refresh',{refreshToken:auth.refreshToken})).statusCode,401)
 })
 it('verifies email before login and resets password using a one-time mail token',async()=>{
  const {auth}=await newUser(),address=`user-${randomUUID().slice(0,8)}@example.test`
  const sent:string[]=[]
  const original=nodemailer.createTransport
  nodemailer.createTransport=(()=>({sendMail:async (message:{text:string})=>{sent.push(message.text)},close:()=>{}})) as typeof nodemailer.createTransport
  try {
   const settings={host:'smtp.example.test',port:587,secure:false,user:'smtp',password:'hidden-mail-password',from:'studio@example.test'}
   assert.equal((await request('PUT','/v1/admin/settings/smtp',settings,admin)).statusCode,200)
   assert.equal((await request('POST','/v1/me/email',{email:address,password:'Personal-test-password-2026'},auth)).statusCode,200)
   assert.equal((await request('POST','/v1/auth/login',{login:address,password:'Personal-test-password-2026'})).statusCode,401)
   const verification=/token=([\w-]+)/.exec(sent[0]!)![1]
   assert.equal((await request('POST','/v1/auth/verify-email',{token:verification})).statusCode,200)
   assert.equal((await request('POST','/v1/auth/verify-email',{token:verification})).statusCode,400)
   await login(address)
   assert.equal((await request('POST','/v1/auth/forgot-password',{email:address})).statusCode,200)
   const reset=/token=([\w-]+)/.exec(sent.at(-1)!)![1]
   assert.equal((await request('POST','/v1/auth/reset-password',{token:reset,password:'Recovered-password-2026'})).statusCode,200)
   assert.equal((await request('POST','/v1/auth/reset-password',{token:reset,password:'Recovered-password-2026'})).statusCode,400)
   assert.equal((await request('GET','/v1/auth/session',undefined,auth)).statusCode,401)
   await login(address,'Recovered-password-2026')
   const secret=(await service.services.db.query("SELECT value FROM settings WHERE name='smtp'")).rows[0].value
   assert.doesNotMatch(JSON.stringify(secret),/hidden-mail-password/)
   assert.doesNotMatch((await request('GET','/v1/admin/settings',undefined,admin)).body,/hidden-mail-password/)
  } finally {nodemailer.createTransport=original}
 })
 it('requires confirmation before shortening retention',async()=>{
  const p={...policiesDefault,deletionDays:1}
  assert.equal((await request('PUT','/v1/admin/settings/policies',{policies:p},admin)).statusCode,409)
  assert.equal((await request('PUT','/v1/admin/settings/policies',{policies:p,confirmShorterRetention:true},admin)).statusCode,200)
  await request('PUT','/v1/admin/settings/policies',{policies:policiesDefault},admin)
 })
 it('creates encrypted backups and restores data while invalidating sessions/cursors',async()=>{
  const {auth}=await newUser();await push(auth,[plain('saved')])
  const saved=await createBackup(service.services,null)
  const bytes=await readFile(join(directory,'backups',`${saved.id}.json.enc`),'utf8')
  assert.doesNotMatch(bytes,/password_hash|private project/)
  await push(auth,[plain('after-backup')])
  const response=await request('POST',`/v1/admin/backups/${saved.id}/restore`,{confirmation:'RESTORE',password:adminPassword},admin)
  assert.equal(response.statusCode,200,response.body)
  assert.equal((await request('GET','/v1/auth/session',undefined,admin)).statusCode,401)
  admin=await login('admin',adminPassword)
  const rows=(await request('GET','/v1/admin/data',undefined,admin)).json()
  assert.ok(rows.some((row:{id:string})=>row.id==='saved'))
  assert.ok(!rows.some((row:{id:string})=>row.id==='after-backup'))
 })
 it('uses an S3-compatible HTTP bucket for encrypted backup copies and retention',async(t)=>{
  if(!process.env.TEST_S3_ENDPOINT) {t.skip('Set TEST_S3_ENDPOINT for real MinIO verification');return}
  const bucket=`studio-${randomUUID().slice(0,8)}`
  const client=new S3Client({endpoint:process.env.TEST_S3_ENDPOINT,region:'us-east-1',forcePathStyle:true,credentials:{accessKeyId:process.env.TEST_S3_ACCESS_KEY??'S3RVER',secretAccessKey:process.env.TEST_S3_SECRET_KEY??'S3RVER'}})
  try{
   await client.send(new CreateBucketCommand({Bucket:bucket}))
   const config={endpoint:process.env.TEST_S3_ENDPOINT,region:'us-east-1',bucket,accessKeyId:process.env.TEST_S3_ACCESS_KEY??'S3RVER',secretAccessKey:process.env.TEST_S3_SECRET_KEY??'S3RVER',forcePathStyle:true}
   assert.equal((await request('PUT','/v1/admin/settings/storage',config,admin)).statusCode,200)
   assert.equal((await request('POST','/v1/admin/settings/storage/test',{},admin)).statusCode,200)
   const backup=await request('POST','/v1/admin/backups',{},admin)
   assert.equal(backup.statusCode,200,backup.body);assert.equal(backup.json().remoteCopy,true)
   const objects=await client.send(new ListObjectsV2Command({Bucket:bucket}));assert.equal(objects.Contents?.length,1)
   await service.services.db.query("UPDATE backups SET created_at=now()-interval '100 days' WHERE id=$1",[backup.json().id])
   await cleanup(service.services)
   assert.equal((await client.send(new ListObjectsV2Command({Bucket:bucket}))).Contents?.length??0,0)
  } finally{client.destroy()}
 })
})
