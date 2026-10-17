/**
 * Per-device pet preferences kept in `localStorage`: system notifications and
 * do-not-disturb. They never leave the browser profile; documents of the same
 * profile (the Desktop pet window and main window) follow each other's writes.
 */
import type { PetActivityLevel } from './motion.ts'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'

/** Storage key of the preference record. */
export const PET_PREFERENCES_KEY = 'dsh-pet:preferences'

/** Milliseconds one "do not disturb" snooze lasts. */
export const PET_SNOOZE_MS = 60 * 60 * 1000

/** Device-local pet preferences. */
export interface PetPreferences {
  /** Whether system notifications are on (opt-in). */
  readonly activity?: PetActivityLevel
  readonly effects?: boolean
  readonly interactive?: boolean
  readonly roam?: boolean
  readonly reducedMotion?: boolean
  readonly notify: boolean
  /** Epoch milliseconds until which notifications are snoozed. */
  readonly snoozeUntil: number | undefined
}

const DEFAULTS: PetPreferences = { notify: false, snoozeUntil: undefined }

/** Minimal storage face, satisfied by `localStorage`. */
export interface PreferenceStorage {
  readonly getItem: (key: string) => string | null
  readonly setItem: (key: string, value: string) => void
}

/**
 * Parse a stored record, falling back to defaults field by field.
 * @param raw - stored JSON, or `null`.
 * @returns valid preferences.
 */
export function parsePreferences(raw: string | null): PetPreferences {
  if (raw === null) return DEFAULTS
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return DEFAULTS
  }
  if (typeof value !== 'object' || value === null) return DEFAULTS
  const notify = 'notify' in value && typeof value.notify === 'boolean' ? value.notify : DEFAULTS.notify
  const snoozeUntil = 'snoozeUntil' in value && typeof value.snoozeUntil === 'number' ? value.snoozeUntil : undefined
  return {
    notify, snoozeUntil,
    ...'activity' in value && (value.activity === 'quiet' || value.activity === 'normal' || value.activity === 'lively') ? { activity: value.activity } : {},
    ...'effects' in value && typeof value.effects === 'boolean' ? { effects: value.effects } : {},
    ...'interactive' in value && typeof value.interactive === 'boolean' ? { interactive: value.interactive } : {},
    ...'roam' in value && typeof value.roam === 'boolean' ? { roam: value.roam } : {},
    ...'reducedMotion' in value && typeof value.reducedMotion === 'boolean' ? { reducedMotion: value.reducedMotion } : {},
  }
}

/** `storage` event fields read by {@link PetPreferenceStore.follow}. */
export interface PreferenceStorageEvent {
  /** Changed key, or `null` when storage was cleared. */
  readonly key: string | null
  /** New stored value, or `null` when removed. */
  readonly newValue: string | null
}

/** Event target delivering `storage` events, satisfied by `window`. */
export interface PreferenceEventSource {
  /**
   * @param type - `storage`.
   * @param listener - receives writes made by other documents.
   */
  addEventListener(type: 'storage', listener: (event: PreferenceStorageEvent) => void): void
  /**
   * @param type - `storage`.
   * @param listener - listener added earlier.
   */
  removeEventListener(type: 'storage', listener: (event: PreferenceStorageEvent) => void): void
}

/** Observable preference record with write-through storage. */
export class PetPreferenceStore {
  private readonly store
  /** Read-only observable view. */
  readonly snapshot: ObservableSnapshot<PetPreferences>

  /** @param storage - backing storage, or `undefined` for memory only. */
  constructor(private readonly storage: PreferenceStorage | undefined) {
    let initial = DEFAULTS
    try {
      initial = parsePreferences(storage?.getItem(PET_PREFERENCES_KEY) ?? null)
    } catch {
      // Storage can throw in locked-down profiles; keep defaults in memory.
    }
    this.store = createSnapshotStore<PetPreferences>(initial, { flush: 'sync' })
    this.snapshot = this.store
  }

  /**
   * Follow preference writes made by other documents of this browser profile.
   * @param source - `storage` event target, normally `window`.
   * @returns stops following.
   */
  follow(source: PreferenceEventSource): () => void {
    const listener = (event: PreferenceStorageEvent): void => {
      if (event.key === PET_PREFERENCES_KEY) this.store.set(parsePreferences(event.newValue))
    }
    source.addEventListener('storage', listener)
    return () => { source.removeEventListener('storage', listener) }
  }

  /**
   * Merge and persist a change.
   * @param patch - fields to change.
   */
  update(patch: Partial<PetPreferences>): void {
    const next = { ...this.store.getSnapshot(), ...patch }
    this.store.set(next)
    try {
      this.storage?.setItem(PET_PREFERENCES_KEY, JSON.stringify(next))
    } catch {
      // Keep the in-memory value when storage refuses the write.
    }
  }
}

/**
 * Whether notifications are currently snoozed.
 * @param preferences - current preferences.
 * @param now - current epoch milliseconds.
 * @returns whether a snooze is active.
 */
export function isSnoozed(preferences: PetPreferences, now: number): boolean {
  return preferences.snoozeUntil !== undefined && now < preferences.snoozeUntil
}
