/**
 * Pet settings page model: the Host `pet` profile entry fields edited through
 * ui-settings' `configForms`, and the pure list edits of the restricted-tool list.
 */
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'

/** Profile entry id of the Host pet module in the shipped bundle. */
export const PET_SETTINGS_NAMESPACE = 'pet'

/** Volatile fields of the Host pet module that the settings page edits. */
export interface PetSettingsFields {
  /** "Show desktop pet". */
  readonly visible: boolean
  /** Whether listed tools must be approved in the main window. */
  readonly restrictTools: boolean
  /** Tools routed to the main window while `restrictTools` is on. */
  readonly restrictedTools: readonly string[]
  /** Notify on a new approval request. */
  readonly notifyWaiting: boolean
  /** Notify when a turn finishes. */
  readonly notifySuccess: boolean
  /** Notify when a turn fails. */
  readonly notifyError: boolean
}

/** Boolean fields written by one switch each. */
export type PetSettingsSwitch = 'visible' | 'restrictTools' | 'notifyWaiting' | 'notifySuccess' | 'notifyError'

/**
 * Add one tool name to the restricted list.
 * @param list - current list.
 * @param name - typed name; surrounding whitespace is ignored.
 * @returns the new list, or `undefined` when the name is empty or already listed.
 */
export function addRestrictedTool(list: readonly string[], name: string): string[] | undefined {
  const trimmed = name.trim()
  if (trimmed.length === 0 || list.includes(trimmed)) return undefined
  return [...list, trimmed]
}

/**
 * Remove one tool name from the restricted list.
 * @param list - current list.
 * @param name - listed name.
 * @returns the list without that name.
 */
export function removeRestrictedTool(list: readonly string[], name: string): string[] {
  return list.filter(entry => entry !== name)
}

/** Write outcome shown under the page. */
export interface PetSettingsWriteState {
  /** Whether a write is in flight. */
  readonly busy: boolean
  /** Whether the last write was refused or failed. */
  readonly failed: boolean
}

/** Serialized writes of the pet settings page with a visible failure flag. */
export class PetSettingsEditor {
  private readonly store = createSnapshotStore<PetSettingsWriteState>({ busy: false, failed: false }, { flush: 'sync' })
  /** Write outcome. */
  readonly state: ObservableSnapshot<PetSettingsWriteState> = this.store

  /** @param form - shared form of the Host `pet` entry. */
  constructor(private readonly form: ConfigForm<PetSettingsFields>) {}

  /**
   * Write one switch.
   * @param field - boolean field.
   * @param value - requested value.
   * @returns whether the Host accepted the write.
   */
  setSwitch(field: PetSettingsSwitch, value: boolean): Promise<boolean> {
    return this.write(field, value)
  }

  /**
   * Replace the restricted-tool list.
   * @param tools - complete new list.
   * @returns whether the Host accepted the write.
   */
  setRestrictedTools(tools: readonly string[]): Promise<boolean> {
    return this.write('restrictedTools', tools)
  }

  private async write(field: keyof PetSettingsFields, value: boolean | readonly string[]): Promise<boolean> {
    this.store.set({ busy: true, failed: false })
    let accepted = false
    try {
      accepted = await this.form.set(field, value)
    } catch (_error) {
      // A transport failure leaves the accepted Host value on screen; the page shows the failure flag.
    }
    this.store.set({ busy: false, failed: !accepted })
    return accepted
  }
}
