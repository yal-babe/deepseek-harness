/**
 * SQLite WAL schema and open sequence for the Studio sync server.
 * @module @deepseek-ai/dsh-sync-server/schema
 */

import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** Physical layout version stored in `PRAGMA user_version`. */
export const SYNC_SERVER_SCHEMA_VERSION = 1

/**
 * Exclusively create a missing database file with owner-only permissions.
 * @param path - destination database file.
 * @returns after the file exists.
 */
async function createDatabaseFile(path: string): Promise<void> {
  try {
    const handle = await open(path, 'wx', 0o600)
    await handle.close()
  } catch (error) {
    /* v8 ignore next -- exclusive create fails only for errors other than EEXIST */
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/**
 * Open a WAL database, stamp the schema version, and ensure tables.
 * @param path - SQLite file, or `:memory:`.
 * @returns the open handle.
 */
export async function openSyncDatabase(path: string): Promise<DatabaseSync> {
  const actual = path === ':memory:' ? path : resolve(path)
  if (actual !== ':memory:') {
    await mkdir(dirname(actual), { recursive: true, mode: 0o700 })
    await createDatabaseFile(actual)
  }
  const db = new DatabaseSync(actual)
  try {
    configureDatabase(db, actual)
    return db
  } catch (error: unknown) {
    db.close()
    throw error
  }
}

function configureDatabase(db: DatabaseSync, path: string): void {
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA journal_mode = WAL')
  const { user_version: onDisk } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  if (onDisk !== 0 && onDisk !== SYNC_SERVER_SCHEMA_VERSION) {
    throw new Error(
      `sync-server: database at "${path}" has schema version ${String(onDisk)}, incompatible with this build (${String(SYNC_SERVER_SCHEMA_VERSION)})`,
    )
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      credential_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (id, project_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS leases (
      project_id TEXT PRIMARY KEY,
      device_id TEXT,
      holder_until INTEGER,
      generation INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS batches (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      base_seq INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      time INTEGER NOT NULL,
      session_id TEXT,
      data TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      superseded_by TEXT,
      git_rev TEXT
    ) STRICT;
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      text,
      id UNINDEXED,
      project_id UNINDEXED,
      tokenize = 'unicode61'
    );
    CREATE TABLE IF NOT EXISTS sync_failures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      batch_id TEXT,
      message TEXT NOT NULL,
      time INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS s3_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      bucket TEXT,
      region TEXT,
      endpoint TEXT,
      prefix TEXT
    ) STRICT;
  `)
  db.exec(`PRAGMA user_version = ${String(SYNC_SERVER_SCHEMA_VERSION)}`)
}
