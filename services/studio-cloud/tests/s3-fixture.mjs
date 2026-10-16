import S3rver from 's3rver'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const directory = await mkdtemp(join(tmpdir(),'studio-s3-'))
const server = new S3rver({ address:'127.0.0.1',port:59000,silent:true,directory })
await server.run()
console.log('S3-compatible test fixture ready on 127.0.0.1:59000 (S3RVER credentials)')
for (const signal of ['SIGTERM','SIGINT']) process.once(signal, async()=>{ await server.close(); await rm(directory,{recursive:true,force:true}) })
