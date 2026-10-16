/** Built Host/server integration with two private devices; no model credentials or real user data are read. */
import { describe,it,before,after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomBytes,randomUUID } from 'node:crypto'
import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { buildApp } from '../dist/app.js'
import { loadConfig } from '../dist/config.js'

const resolveHost=createRequire(new URL('../../../packages/sync/studio-cloud/package.json',import.meta.url))
const module=async name=>import(resolveHost.resolve(name))
const {Context}=await module('@deepseek-ai/cordis')
const {default:StudioCloud}=await module('@deepseek-ai/dsh-studio-cloud')
const {default:Credentials}=await module('@deepseek-ai/dsh-credentials-local')
const Persistence=await module('@deepseek-ai/dsh-session-persistence-jsonl')
const {default:Attachments}=await module('@deepseek-ai/dsh-attachment-local')
const {createUserMessage}=await module('@deepseek-ai/dsh-llm')
const {SESSION_FORMAT_VERSION}=await module('@deepseek-ai/dsh-session')

const database=process.env.TEST_DATABASE_URL
if(!database)throw new Error('TEST_DATABASE_URL must name a dedicated PostgreSQL test database')
const pool=new pg.Pool({connectionString:database})
const schema=`host_${randomUUID().replaceAll('-','')}`
const cleanups=[]
let service,root,origin,alice,bob,account
const password='Isolated-personal-password-2026'
async function request(path,body,token){
 const response=await fetch(new URL(path,origin),{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})})
 const data=await response.json()
 assert.equal(response.status,200,JSON.stringify(data))
 return data
}
async function device(name){
 const ctx=new Context(),home=join(root,name)
 const credentials=ctx.plugin(Credentials,{path:join(home,'.credentials.yaml'),watch:false})
 await credentials;cleanups.push(()=>credentials.dispose())
 const persistence=ctx.plugin(Persistence,{root:join(home,'logs'),compression:'none'})
 await persistence;cleanups.push(()=>persistence.dispose())
 const attachments=ctx.plugin(Attachments,{dshHome:home})
 await attachments;cleanups.push(()=>attachments.dispose())
 const cloud=ctx.plugin(StudioCloud,{stateDirectory:join(home,'cloud'),requestTimeoutMs:10000,syncIntervalMs:3600000,sessionChunkBytes:1048576})
 await cloud;cleanups.push(()=>cloud.dispose())
 await ctx.studioCloud.signIn(origin,account,password,name,true)
 return ctx
}

describe('built Studio Host and cloud server',()=>{
 before(async()=>{
  root=await mkdtemp(join(tmpdir(),'dsh-cloud-host-'))
  await pool.query(`CREATE SCHEMA ${schema}`)
  const url=new URL(database);url.searchParams.set('options',`-c search_path=${schema}`)
  service=await buildApp(loadConfig({DATABASE_URL:url.href,MASTER_KEY:randomBytes(32).toString('hex'),PUBLIC_URL:'http://localhost:8788',ALLOW_HTTP:'true',BOOTSTRAP_PASSWORD:'Isolated-admin-password-2026',DATA_DIR:join(root,'server')}))
  origin=await service.app.listen({host:'127.0.0.1',port:0})
  const admin=await request('/v1/auth/login',{login:'admin',password:'Isolated-admin-password-2026',client:'device'})
  const invite=await request('/v1/admin/invites',{},admin.accessToken)
  account=`personal_${randomUUID().slice(0,8)}`
  await request('/v1/auth/accept-invite',{token:invite.token,username:account,password})
  alice=await device('alice');bob=await device('bob')
 })
 after(async()=>{
  try {while(cleanups.length)await cleanups.pop()();await service?.app.close()}
  finally {await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await pool.end();if(root)await rm(root,{recursive:true,force:true})}
 })
 it('previews without upload and restores >4 MiB completed history plus an attachment onto a second device',async()=>{
  const ref=await alice.attachments.saveFile({data:Buffer.from('exact generated file bytes'),name:'generated.txt'})
  const id=`session-${randomUUID()}`
  const header={id,version:SESSION_FORMAT_VERSION,createdAt:1,isSeeded:false,cwd:join(root,'private-project')}
  const events=[
   {type:'turn/start',seq:0,time:1,data:{turn:1}},
   {type:'user/message',seq:1,time:2,surfaceOp:'append',data:createUserMessage({source:{kind:'user'},content:[{type:'text',text:`${'source code '.repeat(450000)} api_key=sk-do-not-upload-this-value`},{type:'file',attachment:ref}]})},
   {type:'turn/end',seq:2,time:3,data:{turn:1,reason:{kind:'completed'}}},
   {type:'turn/start',seq:3,time:4,data:{turn:2}},
   {type:'user/message',seq:4,time:5,surfaceOp:'append',data:createUserMessage({source:{kind:'user'},content:[{type:'text',text:'streaming tail must stay local'}]})},
  ]
  const handle=await alice.sessionPersistence.create(header)
  await handle.append(events);await handle.close()
  const rows=await alice.studioCloud.preview()
  assert.equal((await service.services.db.query('SELECT count(*) FROM cloud_files')).rows[0].count,'0')
  const selected=rows.find(row=>row.kind==='conversation')
  assert.ok(selected);assert.match(selected.local,/dsh-session-1/)
  assert.doesNotMatch(selected.local,/private-project|do-not-upload|streaming tail/)
  await alice.studioCloud.select([{id:selected.id,source:'local',version:0}])
  assert.ok(Number((await service.services.db.query('SELECT count(*) FROM cloud_files WHERE complete')).rows[0].count)>4)
  assert.equal((await bob.sessionPersistence.list()).length,0)
  const remote=(await bob.studioCloud.preview()).find(row=>row.id===selected.id)
  assert.ok(remote)
  await bob.studioCloud.select([{id:remote.id,source:'cloud',version:remote.version}])
  const history=await bob.studioCloud.readHistory(remote.id)
  assert.equal(history.throughSeq,2);assert.deepEqual(history.missing,[])
  assert.equal(history.messages.length,1)
  assert.doesNotMatch(history.messages[0].content,/do-not-upload|streaming tail/)
  const bytes=[]
  for await(const chunk of bob.attachments.readFileStream(ref))bytes.push(chunk)
  assert.equal(Buffer.concat(bytes).toString(),'exact generated file bytes')
  assert.equal((await bob.sessionPersistence.list()).length,0,'read-only history must not become a resumable local log')
  const user=(await request('/v1/auth/login',{login:account,password})).accessToken
  assert.equal((await request('/v1/me/devices',undefined,user)).filter(device=>!device.revoked).length,3)
 })
})
