/**
 * Durable JSON queue for sync batches. Readers observe a complete file;
 * writers replace it with {@link writeFileAtomic}.
 * @module @deepseek-ai/dsh-sync-outbox/queue
 */

import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { SyncBatch, SyncStatus } from '@deepseek-ai/dsh-sync-protocol'

/** One persisted outbox row. */
export interface OutboxItem {
  /** Queued batch after secret redaction. */
  readonly batch: SyncBatch
  /** Delivery state for this row. */
  readonly status: SyncStatus
  /** Completed delivery attempts, including the in-flight one. */
  readonly attempts: number
  /** Last delivery error, absent until a failure is recorded. */
  readonly lastError?: string
  /** Unix epoch milliseconds of the latest status change. */
  readonly updatedAt: number
}

/** On-disk document version 1. */
export interface OutboxDocument {
  /** Physical layout version. */
  readonly version: 1
  /** Queued rows in enqueue order. */
  readonly items: readonly OutboxItem[]
}

const EMPTY: OutboxDocument = { version: 1, items: [] }

/**
 * Load a queue document, treating a missing file as empty. A corrupt file
 * rejects rather than being repaired in place.
 * @param path - JSON file path.
 * @returns the stored document.
 */
export async function loadQueue(path: string): Promise<OutboxDocument> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY
    throw error
  }
  const parsed: unknown = JSON.parse(text)
  if (!isDocument(parsed)) {
    throw new Error(`sync-outbox: queue at "${path}" is not a version-1 outbox document`)
  }
  return parsed
}

/**
 * Replace the queue file with one complete document.
 * @param path - JSON file path.
 * @param document - next complete document.
 * @returns after the atomic replacement.
 */
export async function saveQueue(path: string, document: OutboxDocument): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(document)}\n`, { mode: 0o600, dirMode: 0o700 })
}

function isDocument(value: unknown): value is OutboxDocument {
  if (typeof value !== 'object' || value === null) return false
  const record = value as { version?: unknown; items?: unknown }
  return record.version === 1 && Array.isArray(record.items)
}
