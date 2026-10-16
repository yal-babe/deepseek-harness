import pg, { type PoolClient } from 'pg'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { Config } from './config.js'
import { passwordHash, seal, unseal } from './security.js'

export type DB = pg.Pool
export const createDb = (url: string) => new pg.Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 5000, statement_timeout: 15000 })
/** Roll back failed mutations before releasing their connection. */
export async function transaction<T>(db: DB, fn: (client: PoolClient) => Promise<T>): Promise<T> {
 const client = await db.connect()
 try {
  await client.query('BEGIN')
  const value = await fn(client)
  await client.query('COMMIT')
  return value
 } catch (error) { await client.query('ROLLBACK'); throw error }
 finally { client.release() }
}
export const policiesDefault = { defaultQuotaBytes: 1073741824, deletionDays: 30, changeDays: 90, backupDays: 30,
 backupIntervalHours: 24, maxBackups: 30, backupMaxBytes: 268435456, maxObjectBytes: 1048576 }

export async function initialize(db: DB, config: Config): Promise<void> {
 await transaction(db, async c => {
  await c.query('SELECT pg_advisory_xact_lock(702117)')
  await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
  const versions = await c.query('SELECT version FROM schema_migrations ORDER BY version')
  if (versions.rows.some(row => row.version > 1)) throw new Error('Database schema is newer than this server')
  if (versions.rowCount === 0) {
   await c.query(await readFile(new URL('../migrations/001-initial.sql', import.meta.url), 'utf8'))
   await c.query('INSERT INTO schema_migrations(version) VALUES(1)')
  }
  const admins = await c.query("SELECT id FROM users WHERE role='admin'")
  if (admins.rowCount === 0) {
   if (!config.BOOTSTRAP_PASSWORD) throw new Error('First startup requires BOOTSTRAP_PASSWORD (at least 12 characters)')
   await c.query("INSERT INTO users(id,username,password_hash,role,sync_epoch) VALUES($1,$2,$3,'admin',$4)",
    [randomUUID(), config.BOOTSTRAP_ADMIN, await passwordHash(config.BOOTSTRAP_PASSWORD), randomUUID()])
  }
  await c.query("INSERT INTO settings(name,value) VALUES('policies',$1) ON CONFLICT DO NOTHING", [policiesDefault])
  const check = (await c.query("SELECT value FROM settings WHERE name='master_key_check'")).rows[0]
  if (check) {
   const content = unseal<{ purpose: string }>(check.value.sealed,config.MASTER_KEY)
   if (content.purpose !== 'dsh-studio-cloud') throw new Error('Master key verification failed')
  } else {
   await c.query("INSERT INTO settings(name,value) VALUES('master_key_check',$1)",[{sealed:seal({purpose:'dsh-studio-cloud'},config.MASTER_KEY)}])
  }
 })
}
