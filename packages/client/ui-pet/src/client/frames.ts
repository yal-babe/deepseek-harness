/** Whale-tail maid frame subset (MIT, Copyright (c) 2026 PC2005-cloud; see assets/whaletail-maid/LICENSE.txt). */
import type { PetAgentState } from '@deepseek-ai/dsh-pet/types'
import idle1 from './assets/whaletail-maid/idle-1.webp'
import idle2 from './assets/whaletail-maid/idle-2.webp'
import idle3 from './assets/whaletail-maid/idle-3.webp'
import idle4 from './assets/whaletail-maid/idle-4.webp'
import idle5 from './assets/whaletail-maid/idle-5.webp'
import idle6 from './assets/whaletail-maid/idle-6.webp'
import thinking1 from './assets/whaletail-maid/thinking-1.webp'
import thinking2 from './assets/whaletail-maid/thinking-2.webp'
import thinking3 from './assets/whaletail-maid/thinking-3.webp'
import thinking4 from './assets/whaletail-maid/thinking-4.webp'
import thinking5 from './assets/whaletail-maid/thinking-5.webp'
import thinking6 from './assets/whaletail-maid/thinking-6.webp'
import working1 from './assets/whaletail-maid/working-1.webp'
import working2 from './assets/whaletail-maid/working-2.webp'
import working3 from './assets/whaletail-maid/working-3.webp'
import working4 from './assets/whaletail-maid/working-4.webp'
import working5 from './assets/whaletail-maid/working-5.webp'
import working6 from './assets/whaletail-maid/working-6.webp'
import waiting1 from './assets/whaletail-maid/waiting-1.webp'
import waiting2 from './assets/whaletail-maid/waiting-2.webp'
import waiting3 from './assets/whaletail-maid/waiting-3.webp'
import waiting4 from './assets/whaletail-maid/waiting-4.webp'
import waiting5 from './assets/whaletail-maid/waiting-5.webp'
import waiting6 from './assets/whaletail-maid/waiting-6.webp'
import success1 from './assets/whaletail-maid/success-1.webp'
import success2 from './assets/whaletail-maid/success-2.webp'
import success3 from './assets/whaletail-maid/success-3.webp'
import success4 from './assets/whaletail-maid/success-4.webp'
import success5 from './assets/whaletail-maid/success-5.webp'
import success6 from './assets/whaletail-maid/success-6.webp'
import error1 from './assets/whaletail-maid/error-1.webp'
import error2 from './assets/whaletail-maid/error-2.webp'
import error3 from './assets/whaletail-maid/error-3.webp'
import error4 from './assets/whaletail-maid/error-4.webp'
import error5 from './assets/whaletail-maid/error-5.webp'
import error6 from './assets/whaletail-maid/error-6.webp'

/** Animation clips the Phase 0 character plays. */
export type PetClip = 'idle' | 'thinking' | 'working' | 'waiting' | 'success' | 'error'

/** Six evenly spaced frames of each upstream 24 fps clip, cropped to the character and scaled to 160 px. */
export const PET_FRAMES: Readonly<Record<PetClip, readonly string[]>> = {
  idle: [idle1, idle2, idle3, idle4, idle5, idle6],
  thinking: [thinking1, thinking2, thinking3, thinking4, thinking5, thinking6],
  working: [working1, working2, working3, working4, working5, working6],
  waiting: [waiting1, waiting2, waiting3, waiting4, waiting5, waiting6],
  success: [success1, success2, success3, success4, success5, success6],
  error: [error1, error2, error3, error4, error5, error6],
}

/** Frames per second for the reduced frame set; one loop lasts one second. */
export const PET_FPS = 6

/**
 * Clip played for an aggregated character state. A lost Host connection keeps
 * the idle clip; the renderer dims it.
 * @param state - aggregated or connection-derived state.
 * @returns the clip to play.
 */
export function clipFor(state: PetAgentState): PetClip {
  switch (state) {
    case 'THINKING': return 'thinking'
    case 'WORKING': return 'working'
    case 'WAITING': return 'waiting'
    case 'SUCCESS': return 'success'
    case 'ERROR': return 'error'
    case 'IDLE':
    case 'DISCONNECTED':
      return 'idle'
  }
}
