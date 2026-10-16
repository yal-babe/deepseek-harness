import { loadConfig } from './config.js'
import { buildApp } from './app.js'

const config = loadConfig()
const { app } = await buildApp(config,{ logging: true, background: true })
try { await app.listen({ host: config.HOST,port: config.PORT }) }
catch (error) { app.log.error({ name: error instanceof Error ? error.name : 'Error' },'Unable to listen'); await app.close(); process.exitCode = 1 }
let closing = false
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,async () => {
 if (closing) return
 closing = true
 try { await app.close() }
 catch { process.exitCode = 1 }
})
