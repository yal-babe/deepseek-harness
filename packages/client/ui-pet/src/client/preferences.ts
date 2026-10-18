/**
 * Per-device pet preferences kept in `localStorage`: system notifications and
 * do-not-disturb. They never leave the browser profile; documents of the same
 * profile (the Desktop pet window and main window) follow each other's writes.
 */
import { PET_ACTIONS, type PetLifeState, type PetAction, type PetActivityLevel } from './motion.ts'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'

/** Storage key of the preference record. */
export const PET_PREFERENCES_KEY = 'dsh-pet:preferences'

/** Milliseconds one "do not disturb" snooze lasts. */
export const PET_SNOOZE_MS = 60 * 60 * 1000

/** Device-local pet preferences. */
export interface PetPreferences {
  /** Device-local character name, at most 24 Unicode code points. */
  readonly name?: string
  /** Requested character size in percent, between 50 and 200. */
  readonly size?: number
  /** Life state restored after task activity ends. */
  readonly life?: PetLifeState
  /** Enabled autonomous actions; an empty list keeps only the base loop. */
  readonly actions?: readonly PetAction[]
  readonly activity?: PetActivityLevel
  readonly effects?: boolean
  readonly interactive?: boolean
  readonly roam?: boolean
  /** Whether a fling throws the character with gravity and bounces; absent means on. Reduced motion turns it off. */
  readonly throw?: boolean
  readonly reducedMotion?: boolean
  /** Whether system notifications are on (opt-in). */
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
  const actions = 'actions' in value && Array.isArray(value.actions) ? value.actions : undefined
  const notify = 'notify' in value && typeof value.notify === 'boolean' ? value.notify : DEFAULTS.notify
  const snoozeUntil = 'snoozeUntil' in value && typeof value.snoozeUntil === 'number' ? value.snoozeUntil : undefined
  return {
    notify, snoozeUntil,
    ...'name' in value && typeof value.name === 'string' && value.name.trim() ? { name: Array.from(value.name.trim()).slice(0, 24).join('') } : {},
    ...'size' in value && typeof value.size === 'number' && Number.isFinite(value.size) ? { size: Math.max(50, Math.min(200, value.size)) } : {},
    ...'life' in value && (value.life === 'idle' || value.life === 'rest' || value.life === 'play') ? { life: value.life } : {},
    ...actions !== undefined ? { actions: PET_ACTIONS.filter(action => actions.includes(action)) } : {},
    ...'activity' in value && (value.activity === 'quiet' || value.activity === 'normal' || value.activity === 'lively') ? { activity: value.activity } : {},
    ...'effects' in value && typeof value.effects === 'boolean' ? { effects: value.effects } : {},
    ...'interactive' in value && typeof value.interactive === 'boolean' ? { interactive: value.interactive } : {},
    ...'roam' in value && typeof value.roam === 'boolean' ? { roam: value.roam } : {},
    ...'throw' in value && typeof value.throw === 'boolean' ? { throw: value.throw } : {},
    ...'reducedMotion' in value && typeof value.reducedMotion === 'boolean' ? { reducedMotion: value.reducedMotion } : {},
  }
}

/**
 * Whether drag physics and throwing are on: the preference (on by default) unless motion is reduced.
 * @param preferences - device preferences.
 * @param systemReduced - whether the system asks for reduced motion.
 * @returns whether flings throw the character.
 */
export function throwEnabled(preferences: PetPreferences, systemReduced: boolean): boolean {
  return preferences.throw !== false && preferences.reducedMotion !== true && !systemReduced
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
    const next = parsePreferences(JSON.stringify({ ...this.store.getSnapshot(), ...patch }))
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
