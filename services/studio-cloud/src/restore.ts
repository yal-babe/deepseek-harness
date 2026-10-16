import { z } from 'zod'
import { loadConfig } from './config.js'
import { createDb, initialize } from './db.js'
import { restoreBackup } from './maintenance.js'

const id = z.uuid().parse(process.argv[2])
if (process.argv[3] !== '--confirm') throw new Error('Stop the application first, then pass --confirm to replace server data')
const config = loadConfig(), db = createDb(config.DATABASE_URL)
try { await initialize(db,config); await restoreBackup({ db,config },id); console.log('Restore complete. All old login sessions and sync cursors are invalid.') }
finally { await db.end() }
