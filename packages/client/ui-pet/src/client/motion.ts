/** Motion arbitration shared by the Web and Desktop character. */
import type { PetAgentState, PetWorkActivity } from '@deepseek-ai/dsh-pet/types'

export type PetAction = 'headPat' | 'poke' | 'tail' | 'eatToken' | 'stretch' | 'yawn' | 'bubbles' | 'sleep' | 'nuzzle' | 'celebrate'
export type PetActivityLevel = 'quiet' | 'normal' | 'lively'
export interface PetActionRequest { readonly action: PetAction; readonly serial: number; readonly interrupt?: boolean }
export const PET_ACTIONS: readonly PetAction[] = ['headPat', 'poke', 'tail', 'eatToken', 'stretch', 'yawn', 'bubbles', 'sleep', 'nuzzle', 'celebrate']
export const ACTION_CLIP: Readonly<Record<PetAction, string>> = {
  headPat: 'head_pat', poke: 'poke', tail: 'tail', eatToken: 'eat_token', stretch: 'idle_stretch', yawn: 'idle_yawn',
  bubbles: 'bubbles', sleep: 'sleep', nuzzle: 'nuzzle', celebrate: 'celebrate',
}
const IDLE = ['idle_stretch', 'idle_yawn', 'eat_token', 'bubbles', 'sleep', 'nuzzle'] as const
const INTERVAL: Readonly<Record<PetActivityLevel, readonly [number, number]>> = {
  quiet: [45000, 90000], normal: [25000, 45000], lively: [12000, 22000],
}

/** Work and waiting always displace decorative actions. */
export function petIsIdle(state: PetAgentState): boolean { return state === 'IDLE' || state === 'DISCONNECTED' }

/** Choose without repeating the previous idle action. */
export function nextIdleClip(previous: string | undefined, random: number): string {
  const candidates = IDLE.filter(name => name !== previous)
  return candidates[Math.min(candidates.length - 1, Math.floor(Math.max(0, random) * candidates.length))] ?? IDLE[0]
}

/** Start the rest interval after a clip ends, rather than during its playback. */
export function idleDelay(level: PetActivityLevel, random: number): number {
  const [min, max] = INTERVAL[level]
  return min + Math.round((max - min) * Math.max(0, Math.min(1, random)))
}

/** Map the Host state and tool activity to the original full-length clips. */
export function taskClip(state: PetAgentState, activity?: PetWorkActivity): string {
  if (state === 'WORKING') return activity === 'search' ? 'working_search' : activity === 'command' || activity === 'test' ? 'working_command' : 'working'
  return { IDLE: 'idle', DISCONNECTED: 'idle', THINKING: 'thinking', WAITING: 'waiting', SUCCESS: 'success', ERROR: 'error' }[state]
}
