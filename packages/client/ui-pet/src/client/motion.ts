/** Motion arbitration shared by the Web and Desktop character. */
import type { PetAgentState, PetMotionView, PetWorkActivity } from '@deepseek-ai/dsh-pet/types'

/** Available explicit character interactions. */
export type PetAction = 'headPat' | 'poke' | 'tail' | 'eatToken' | 'stretch' | 'yawn' | 'bubbles' | 'sleep' | 'nuzzle' | 'celebrate'
  | 'daydream' | 'observe' | 'swim' | 'groom' | 'chaseBubbles' | 'playBall' | 'tailSpin' | 'readBook' | 'ponder' | 'pillowNap'
/** Device-local life state; task work temporarily takes precedence. */
export type PetLifeState = 'idle' | 'rest' | 'play'
/** Frequency preset for autonomous actions and movement. */
export type PetActivityLevel = 'quiet' | 'normal' | 'lively'
/** One explicit action request; serial distinguishes repeated choices. */
export interface PetActionRequest { readonly action: PetAction; readonly serial: number; readonly interrupt?: boolean }
/** Complete selectable interaction list. */
export const PET_ACTIONS: readonly PetAction[] = ['headPat', 'poke', 'tail', 'eatToken', 'stretch', 'yawn', 'bubbles', 'sleep', 'nuzzle', 'celebrate',
  'daydream', 'observe', 'swim', 'groom', 'chaseBubbles', 'playBall', 'tailSpin', 'readBook', 'ponder', 'pillowNap',
]
/** Built-in animation names for each explicit interaction. */
export const ACTION_CLIP: Readonly<Record<PetAction, string>> = {
  headPat: 'head_pat', poke: 'poke', tail: 'tail', eatToken: 'eat_token', stretch: 'idle_stretch', yawn: 'idle_yawn',
  bubbles: 'bubbles', sleep: 'sleep', nuzzle: 'nuzzle', celebrate: 'celebrate',
  daydream: 'idle_daydream', observe: 'idle_observe', swim: 'swim', groom: 'idle_groom', chaseBubbles: 'play_bubbles',
  playBall: 'play_ball', tailSpin: 'play_tailspin', readBook: 'work_read', ponder: 'thinking_chin', pillowNap: 'rest_pillow',
}
const IDLE = PET_ACTIONS.map(action => ACTION_CLIP[action])
const PLAY_ACTIONS: readonly PetAction[] = ['bubbles', 'celebrate', 'chaseBubbles', 'playBall', 'tailSpin']
const QUIET_ACTIONS: readonly PetAction[] = ['stretch', 'yawn', 'daydream', 'observe', 'groom']

/** Select autonomous actions for the life state, respecting the device allowlist.
 * @param life - selected life state.
 * @param enabled - device allowlist, or all actions when absent.
 * @returns eligible action names.
 */
export function lifeActions(life: PetLifeState = 'idle', enabled: readonly PetAction[] = PET_ACTIONS): readonly PetAction[] {
  const candidates = life === 'play' ? PLAY_ACTIONS : life === 'rest' ? [] : QUIET_ACTIONS
  return enabled.filter(action => candidates.includes(action))
}
const INTERVAL: Readonly<Record<PetActivityLevel, readonly [number, number]>> = {
  quiet: [20000, 40000], normal: [8000, 16000], lively: [3000, 7000],
}

/** Work and waiting always displace decorative actions.
 * @param state - current task state.
 * @returns whether decorative idle activity is permitted.
 */
export function petIsIdle(state: PetAgentState): boolean { return state === 'IDLE' || state === 'DISCONNECTED' }

/** Choose without repeating the previous idle action.
 * @param previous - last selected clip.
 * @param random - random sample in the unit interval.
 * @param available - eligible clip names.
 * @returns a candidate, or undefined when none is eligible.
 */
export function nextIdleClip(previous: string | undefined, random: number, available: readonly string[] = IDLE): string | undefined {
  const distinct = available.filter(name => name !== previous)
  const candidates = distinct.length ? distinct : available
  return candidates[Math.min(candidates.length - 1, Math.floor(Math.max(0, random) * candidates.length))]
}

/** Delay between completed autonomous movements, in milliseconds.
 * @param level - selected activity preset.
 * @param random - random sample in the unit interval.
 * @returns milliseconds to wait after a movement.
 */
export function roamDelay(level: PetActivityLevel, random: number): number {
  const [min, max] = { quiet: [45000, 90000], normal: [20000, 40000], lively: [8000, 16000] }[level] as [number, number]
  return min + Math.round((max - min) * Math.max(0, Math.min(1, random)))
}

/** Start the rest interval after a clip ends, rather than during its playback.
 * @param level - selected activity preset.
 * @param random - random sample in the unit interval.
 * @returns milliseconds to wait after an action.
 */
export function idleDelay(level: PetActivityLevel, random: number): number {
  const [min, max] = INTERVAL[level]
  return min + Math.round((max - min) * Math.max(0, Math.min(1, random)))
}

/** Map the Host state and tool activity to the original full-length clips.
 * @param state - current task state.
 * @param activity - current tool activity.
 * @returns the matching built-in animation name.
 */
export function taskClip(state: PetAgentState, activity?: PetWorkActivity): string {
  if (state === 'WORKING') return activity === 'search' ? 'working_search' : activity === 'command' || activity === 'test' ? 'working_command' : 'working'
  return { IDLE: 'idle', DISCONNECTED: 'idle', THINKING: 'thinking', WAITING: 'waiting', SUCCESS: 'success', ERROR: 'error' }[state]
}

/** Use a continuous substitute only for legacy sparsely sampled interaction media.
 * @param name - requested animation.
 * @param motion - available character media.
 * @returns the original clip when sufficiently sampled, otherwise an available continuous substitute.
 */
export function smoothClip(name: string, motion: PetMotionView): string {
  const clip = motion.clips[name]
  if (clip?.sheet === undefined || clip.sheet.frames > 8) return name
  const substitute = ({ bubbles: 'idle', sleep: 'idle_yawn', nuzzle: 'head_pat', celebrate: 'success' } as Readonly<Record<string, string>>)[name]
  return substitute !== undefined && motion.clips[substitute] !== undefined ? substitute : name
}
