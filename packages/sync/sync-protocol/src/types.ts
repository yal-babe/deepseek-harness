/**
 * Wire and queue types for Studio cloud sync. Runtime brand constructors live
 * in `ids.ts` beside the identifier grammar they enforce.
 * @module @deepseek-ai/dsh-sync-protocol/types
 */

import type { DeviceId, MemoryId, StudioProjectId, SyncBatchId } from './ids.ts'

export type { DeviceId, MemoryId, StudioProjectId, SyncBatchId }

/** Local and server-visible sync progress for one queued batch. */
export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed'

/** Kind of a retained project-memory record. */
export type MemoryKind =
  | 'goal'
  | 'constraint'
  | 'decision'
  | 'fact'
  | 'progress'
  | 'blocker'

/**
 * One durable session or memory event carried in a sync batch. `id` is the
 * producer-assigned stable identity used for idempotent commit.
 */
export interface SyncEventEnvelope {
  /** Producer-assigned stable event identity. */
  readonly id: string
  /** Monotonic sequence in the producing stream; batches must be nondecreasing. */
  readonly seq: number
  /** Event type string copied from the producing log. */
  readonly type: string
  /** Unix epoch milliseconds when the producer committed the event. */
  readonly time: number
  /** JSON-compatible payload after secret redaction. */
  readonly data: unknown
  /** Owning session when the event came from a session log. */
  readonly sessionId?: string
}

/** One idempotent batch of redacted events for a single project and device. */
export interface SyncBatch {
  /** Stable batch identity; a repeated POST with the same id is a no-op commit. */
  readonly id: SyncBatchId
  /** Cloud project that owns the events. */
  readonly projectId: StudioProjectId
  /** Device that produced the batch. */
  readonly deviceId: DeviceId
  /** Inclusive sequence of the first event in this batch. */
  readonly baseSeq: number
  /** Redacted envelopes in nondecreasing `seq` order. */
  readonly events: readonly SyncEventEnvelope[]
}

/** Exclusive execution lease for one cloud project. */
export interface DeviceLease {
  /** Project the lease covers. */
  readonly projectId: StudioProjectId
  /** Device currently holding exclusive execution, if any. */
  readonly deviceId: DeviceId | null
  /** Unix epoch milliseconds when the lease expires; null when free. */
  readonly holderUntil: number | null
  /** Monotonic generation; takeover must present the current value. */
  readonly generation: number
}

/** One project-memory record stored locally or on the sync server. */
export interface MemoryRecord {
  /** Stable memory identity. */
  readonly id: MemoryId
  /** Cloud project that owns the record. */
  readonly projectId: StudioProjectId
  /** Structured kind used for retrieval filters. */
  readonly kind: MemoryKind
  /** Redacted body shown to the model after a logged injection. */
  readonly text: string
  /** Human- or agent-visible origin of the record. */
  readonly source: string
  /** Unix epoch milliseconds of first commit. */
  readonly createdAt: number
  /** Unix epoch milliseconds of the latest revision. */
  readonly updatedAt: number
  /** Replacement record id when this row is superseded. */
  readonly supersededBy?: MemoryId
  /** Optional git revision associated with the recorded fact. */
  readonly gitRev?: string
}

/** Why {@link validateBatch} rejected a payload. */
export interface BatchValidationFailure {
  /** Machine-stable code for the first violated rule. */
  readonly code:
    | 'empty'
    | 'too-large'
    | 'invalid-id'
    | 'invalid-project'
    | 'invalid-device'
    | 'invalid-seq'
    | 'nonmonotonic'
  /** Readable explanation of the first violated rule. */
  readonly message: string
}

/** Result of {@link validateBatch}. */
export type BatchValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: BatchValidationFailure }
