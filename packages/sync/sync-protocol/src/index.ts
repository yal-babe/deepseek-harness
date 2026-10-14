/**
 * Shared Studio cloud-sync types and pure helpers. This package has no Cordis
 * plugin surface; consumers brand identifiers, validate batches, and redact
 * secrets before enqueue or HTTP commit.
 * @module @deepseek-ai/dsh-sync-protocol
 */

export type {
  BatchValidationFailure,
  BatchValidationResult,
  DeviceLease,
  MemoryKind,
  MemoryRecord,
  SyncBatch,
  SyncEventEnvelope,
  SyncStatus,
} from './types.ts'

export {
  DeviceId,
  MemoryId,
  StudioProjectId,
  SyncBatchId,
  isSyncIdentifier,
} from './ids.ts'

export { DEFAULT_MAX_BATCH_EVENTS, validateBatch } from './validate.ts'
export { redactJsonValue, redactSecrets } from './redact.ts'
