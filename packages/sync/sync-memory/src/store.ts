/**
 * Local SQLite FTS store for project memory records.
 * @module @deepseek-ai/dsh-sync-memory/store
 */

import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { MemoryId, StudioProjectId, type MemoryKind, type MemoryRecord } from '@deepseek-ai/dsh-sync-protocol'

/** Physical layout version stored in `PRAGMA user_version`. */
export const MEMORY_STORE_SCHEMA_VERSION = 1

/**
 * Open a local memory database, creating parent directories as needed.
 * @param path - SQLite file, or `:memory:`.
 * @returns the open handle.
 */
export async function openMemoryStore(path: string): Promise<DatabaseSync> {
  const actual = path === ':memory:' ? path : resolve(path)
  if (actual !== ':memory:') {
    await mkdir(dirname(actual), { recursive: true, mode: 0o700 })
    try {
      const handle = await open(actual, 'wx', 0o600)
      await handle.close()
    } catch (error) {
      /* v8 ignore next -- exclusive create fails only for errors other than EEXIST */
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  const db = new DatabaseSync(actual)
  try {
    db.exec('PRAGMA journal_mode = WAL')
    const { user_version: onDisk } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    if (onDisk !== 0 && onDisk !== MEMORY_STORE_SCHEMA_VERSION) {
      throw new Error(
        `sync-memory: store at "${actual}" has schema version ${String(onDisk)}, incompatible with this build (${String(MEMORY_STORE_SCHEMA_VERSION)})`,
      )
    }
    db.exec(`
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
    `)
    db.exec(`PRAGMA user_version = ${String(MEMORY_STORE_SCHEMA_VERSION)}`)
    return db
  } catch (error: unknown) {
    db.close()
    throw error
  }
}

/**
 * Insert one memory row and its FTS document.
 * @param db - open store.
 * @param record - already-redacted record.
 */
export function insertMemory(db: DatabaseSync, record: MemoryRecord): void {
  db.prepare(
    'INSERT INTO memories (id, project_id, kind, text, source, created_at, updated_at, superseded_by, git_rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    record.id,
    record.projectId,
    record.kind,
    record.text,
    record.source,
    record.createdAt,
    record.updatedAt,
    record.supersededBy ?? null,
    record.gitRev ?? null,
  )
  db.prepare('INSERT INTO memory_fts (text, id, project_id) VALUES (?, ?, ?)').run(record.text, record.id, record.projectId)
}

/**
 * Mark one record superseded by another id.
 * @param db - open store.
 * @param id - existing record.
 * @param successor - replacement id.
 * @param updatedAt - mutation time.
 * @returns whether a live row was updated.
 */
export function supersedeMemory(db: DatabaseSync, id: MemoryId, successor: MemoryId, updatedAt: number): boolean {
  const result = db.prepare(
    'UPDATE memories SET superseded_by = ?, updated_at = ? WHERE id = ? AND superseded_by IS NULL',
  ).run(successor, updatedAt, id)
  return result.changes > 0
}

/**
 * Search live records for one project. An empty query lists recent live rows.
 * @param db - open store.
 * @param projectId - owning project.
 * @param query - FTS query, or empty to list.
 * @param limit - maximum rows.
 * @returns matching live records.
 */
export function searchMemories(
  db: DatabaseSync,
  projectId: StudioProjectId,
  query: string,
  limit: number,
): MemoryRecord[] {
  const match = ftsQuery(query)
  const list = db.prepare(
    'SELECT id, project_id AS projectId, kind, text, source, created_at AS createdAt, updated_at AS updatedAt, superseded_by AS supersededBy, git_rev AS gitRev FROM memories WHERE project_id = ? AND superseded_by IS NULL ORDER BY updated_at DESC LIMIT ?',
  )
  const rows = match.length === 0
    ? list.all(projectId, limit)
    : (() => {
      try {
        return db.prepare(
          `SELECT m.id, m.project_id AS projectId, m.kind, m.text, m.source, m.created_at AS createdAt, m.updated_at AS updatedAt, m.superseded_by AS supersededBy, m.git_rev AS gitRev
           FROM memory_fts f JOIN memories m ON m.id = f.id
           WHERE f.project_id = ? AND memory_fts MATCH ? AND m.superseded_by IS NULL
           ORDER BY m.updated_at DESC LIMIT ?`,
        ).all(projectId, match, limit)
      } catch (syntaxError: unknown) {
        // FTS5 rejects some tokenizations; fall back to recency order.
        void syntaxError
        return list.all(projectId, limit)
      }
    })()
  return (rows as Record<string, unknown>[]).map(rowToRecord)
}

/**
 * Drop a live record and its FTS document.
 * @param db - open store.
 * @param id - record to delete.
 * @returns whether a row was removed.
 */
export function deleteMemory(db: DatabaseSync, id: MemoryId): boolean {
  db.prepare('DELETE FROM memory_fts WHERE id = ?').run(id)
  return db.prepare('DELETE FROM memories WHERE id = ?').run(id).changes > 0
}

function ftsQuery(query: string): string {
  const tokens = query.match(/[\p{L}\p{N}_]+/gu) ?? []
  return tokens.slice(0, 12).join(' OR ')
}

function rowToRecord(row: Record<string, unknown>): MemoryRecord {
  const gitRev = typeof row.gitRev === 'string' ? row.gitRev : undefined
  return {
    id: MemoryId(String(row.id)),
    projectId: StudioProjectId(String(row.projectId)),
    kind: row.kind as MemoryKind,
    text: String(row.text),
    source: String(row.source),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
    ...gitRev === undefined ? {} : { gitRev },
  }
}
