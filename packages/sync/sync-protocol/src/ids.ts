/**
 * Brand constructors for Studio sync identifiers.
 * @module @deepseek-ai/dsh-sync-protocol/ids
 */

import { brandString, type Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity of one Studio cloud project across devices. */
export type StudioProjectId = Branded<'StudioProjectId'>

/** Stable identity of one enrolled device. */
export type DeviceId = Branded<'DeviceId'>

/** Stable identity of one idempotent sync batch. */
export type SyncBatchId = Branded<'SyncBatchId'>

/** Stable identity of one project-memory record. */
export type MemoryId = Branded<'MemoryId'>

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

/**
 * Admit a Studio project id after checking the shared identifier grammar.
 * @param value - candidate project id.
 * @returns the same string branded as {@link StudioProjectId}.
 * @throws when the value is empty or outside the identifier grammar.
 */
export function StudioProjectId(value: string): StudioProjectId {
  return brandId(value, 'StudioProjectId')
}

/**
 * Admit a device id after checking the shared identifier grammar.
 * @param value - candidate device id.
 * @returns the same string branded as {@link DeviceId}.
 * @throws when the value is empty or outside the identifier grammar.
 */
export function DeviceId(value: string): DeviceId {
  return brandId(value, 'DeviceId')
}

/**
 * Admit a batch id after checking the shared identifier grammar.
 * @param value - candidate batch id.
 * @returns the same string branded as {@link SyncBatchId}.
 * @throws when the value is empty or outside the identifier grammar.
 */
export function SyncBatchId(value: string): SyncBatchId {
  return brandId(value, 'SyncBatchId')
}

/**
 * Admit a memory id after checking the shared identifier grammar.
 * @param value - candidate memory id.
 * @returns the same string branded as {@link MemoryId}.
 * @throws when the value is empty or outside the identifier grammar.
 */
export function MemoryId(value: string): MemoryId {
  return brandId(value, 'MemoryId')
}

/**
 * Whether a string matches the shared sync-identifier grammar.
 * @param value - candidate identifier.
 * @returns true when the value is a non-empty identifier of at most 128 characters.
 */
export function isSyncIdentifier(value: string): boolean {
  return ID_PATTERN.test(value)
}

function brandId<T extends StudioProjectId | DeviceId | SyncBatchId | MemoryId>(
  value: string,
  label: string,
): T {
  if (!ID_PATTERN.test(value)) {
    throw new TypeError(`sync-protocol: invalid ${label} ${JSON.stringify(value)}`)
  }
  return brandString<T>(value)
}
