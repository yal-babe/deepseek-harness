/** Optional summaries projected into the pet panel by their data owners. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PetAgentState } from '@deepseek-ai/dsh-pet/types'
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** Visibility and focus supplied by the pet panel. */
export interface PetMetricsOwnerProps {
  /** Whether the panel is currently expanded. */
  readonly visible: boolean
  /** Session whose task the pet currently describes. */
  readonly sessionId?: SessionId | undefined
  /** Event-derived task state, used to refresh after a result. */
  readonly taskState: PetAgentState
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Display-safe usage and account summaries supplied by their existing owners. */
    'pet.panel.metrics': { kind: 'list'; scope: 'root'; owner: PetMetricsOwnerProps }
  }
}
