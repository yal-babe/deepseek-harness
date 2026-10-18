/** Optional summaries projected into the pet panel by their data owners. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PetAgentState } from '@deepseek-ai/dsh-pet/types'
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** One balance reading a metrics owner reports for the pet's balance animation. */
export interface PetBalanceReading {
  /** Used share of the balance or quota, 0 (untouched) to 100 (all used), by the owner's own reference. */
  readonly usedPercent: number
  /** Display-safe, localized summary the pet speaks, such as the remaining balance. */
  readonly label: string
}

/** Visibility and focus supplied by the pet panel. */
export interface PetMetricsOwnerProps {
  /** Whether the panel is currently expanded. */
  readonly visible: boolean
  /** Session whose task the pet currently describes. */
  readonly sessionId?: SessionId | undefined
  /** Event-derived task state, used to refresh after a result. */
  readonly taskState: PetAgentState
  /** Increments each time the user asks the pet for the balance; an owner refreshes and then reports. */
  readonly balanceRequest?: number | undefined
  /**
   * Report balance readings after a balance request; an empty list means nothing is available.
   * @param readings - readings the owner can compute; the pet animates the most used one.
   */
  readonly reportBalance?: ((readings: readonly PetBalanceReading[]) => void) | undefined
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Display-safe usage and account summaries supplied by their existing owners. */
    'pet.panel.metrics': { kind: 'list'; scope: 'root'; owner: PetMetricsOwnerProps }
  }
}
