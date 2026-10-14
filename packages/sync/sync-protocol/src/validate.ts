/**
 * Pure validation of a sync batch before enqueue or HTTP commit.
 * @module @deepseek-ai/dsh-sync-protocol/validate
 */

import { isSyncIdentifier } from './ids.ts'
import type { BatchValidationResult, SyncBatch } from './types.ts'

/** Default maximum envelopes accepted in one batch when a caller omits a cap. */
export const DEFAULT_MAX_BATCH_EVENTS = 100

/**
 * Check that a batch carries a stable identity, a project, a device, and a
 * nondecreasing sequence of envelopes whose length stays within `maxEvents`.
 * @param batch - candidate batch.
 * @param maxEvents - inclusive envelope cap; defaults to {@link DEFAULT_MAX_BATCH_EVENTS}.
 * @returns `{ ok: true }` or the first violated rule.
 */
export function validateBatch(
  batch: SyncBatch,
  maxEvents: number = DEFAULT_MAX_BATCH_EVENTS,
): BatchValidationResult {
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1) {
    throw new TypeError(`sync-protocol: maxEvents must be a positive safe integer, got ${String(maxEvents)}`)
  }
  if (!isSyncIdentifier(batch.id)) {
    return fail('invalid-id', `batch id ${JSON.stringify(batch.id)} is not a sync identifier`)
  }
  if (!isSyncIdentifier(batch.projectId)) {
    return fail('invalid-project', `project id ${JSON.stringify(batch.projectId)} is not a sync identifier`)
  }
  if (!isSyncIdentifier(batch.deviceId)) {
    return fail('invalid-device', `device id ${JSON.stringify(batch.deviceId)} is not a sync identifier`)
  }
  if (!Number.isSafeInteger(batch.baseSeq) || batch.baseSeq < 0) {
    return fail('invalid-seq', `baseSeq must be a non-negative safe integer, got ${String(batch.baseSeq)}`)
  }
  if (batch.events.length === 0) {
    return fail('empty', 'a sync batch must contain at least one event')
  }
  if (batch.events.length > maxEvents) {
    return fail('too-large', `batch has ${String(batch.events.length)} events; max is ${String(maxEvents)}`)
  }
  let previous = batch.baseSeq - 1
  for (const envelope of batch.events) {
    if (envelope.id.trim().length === 0) {
      return fail('invalid-id', 'every envelope requires a non-empty id')
    }
    if (!Number.isSafeInteger(envelope.seq) || envelope.seq < 0) {
      return fail('invalid-seq', `envelope seq must be a non-negative safe integer, got ${String(envelope.seq)}`)
    }
    if (envelope.seq < batch.baseSeq) {
      return fail('invalid-seq', `envelope seq ${String(envelope.seq)} precedes baseSeq ${String(batch.baseSeq)}`)
    }
    if (envelope.seq < previous) {
      return fail('nonmonotonic', `envelope seq ${String(envelope.seq)} is less than the previous seq ${String(previous)}`)
    }
    previous = envelope.seq
  }
  return { ok: true }
}

function fail(
  code: Extract<BatchValidationResult, { ok: false }>['failure']['code'],
  message: string,
): BatchValidationResult {
  return { ok: false, failure: { code, message } }
}
