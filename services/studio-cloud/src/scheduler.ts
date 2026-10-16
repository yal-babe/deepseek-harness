import type { FastifyInstance } from 'fastify'
import type { Services } from './common.js'
import { policies } from './settings.js'
import { createBackup, cleanup } from './maintenance.js'

/** One process owns scheduled tasks; compose deliberately runs a single application instance. */
export function schedule(app: FastifyInstance, s: Services) {
 let pending: Promise<void> | null = null, stopped = false, nextCleanup = 0
 const tick = () => {
  if (pending || stopped || app.maintenance) return
  pending = (async () => {
   const p = await policies(s)
   const latest = (await s.db.query('SELECT max(created_at) AS latest FROM backups')).rows[0].latest
   if (!latest || Date.now() - new Date(latest).getTime() >= p.backupIntervalHours * 3600000) await createBackup(s,null)
   if (Date.now() >= nextCleanup) { await cleanup(s); nextCleanup = Date.now()+86400000 }
  })().catch(error => { app.log.error({ name: error instanceof Error ? error.name : 'Error' },'Scheduled backup/cleanup failed; retry on next tick') }).finally(() => { pending = null })
 }
 const timer = setInterval(tick,60000); timer.unref()
 app.addHook('onClose',async () => { stopped=true; clearInterval(timer); await pending })
 return { idle: async () => { await pending } }
}
