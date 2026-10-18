/** Motion arbitration shared by the Web and Desktop character. */
import type { PetAgentState, PetMotionView, PetWorkActivity } from '@deepseek-ai/dsh-pet/types'

/** Available explicit character interactions. */
export type PetAction = 'headPat' | 'poke' | 'tail' | 'eatToken' | 'stretch' | 'yawn' | 'bubbles' | 'sleep' | 'nuzzle' | 'celebrate'
  | 'daydream' | 'observe' | 'swim' | 'groom' | 'chaseBubbles' | 'playBall' | 'tailSpin' | 'readBook' | 'ponder' | 'pillowNap'
/** Device-local life state; task work temporarily takes precedence. */
export type PetLifeState = 'idle' | 'rest' | 'play'
/** Frequency preset for autonomous actions and movement. */
export type PetActivityLevel = 'quiet' | 'normal' | 'lively'
/** One explicit request for a named interaction or a pack clip; serial distinguishes repeated choices. */
export type PetActionRequest = { readonly serial: number; readonly interrupt?: boolean }
  & ({ readonly action: PetAction } | { readonly clip: string })
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
const CLIP_ACTION: ReadonlyMap<string, PetAction> = new Map(PET_ACTIONS.map(action => [ACTION_CLIP[action], action]))

/** Named interaction a pack clip plays, if any.
 * @param clip - pack clip name.
 * @returns the matching interaction, or undefined for pack-only clips.
 */
export function clipAction(clip: string): PetAction | undefined { return CLIP_ACTION.get(clip) }

/** Clip a request plays.
 * @param request - explicit request.
 * @returns the requested clip name.
 */
export function requestedClip(request: PetActionRequest): string {
  return 'action' in request ? ACTION_CLIP[request.action] : request.clip
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
/** Pick the next autonomous clip: a category by weight among those for the life state, then a fresh clip in it.
 * Packs without categories fall back to {@link lifeActions}. Clips that play a named interaction must be in the
 * device allowlist; pack-only clips follow their category.
 * @param motion - available character media.
 * @param life - selected life state; resting never decorates.
 * @param enabled - device allowlist, or all actions when absent.
 * @param previous - last autonomous clip, which is not repeated when another is eligible.
 * @param random - uniform source in [0, 1), called once for the category and once for the clip.
 * @returns a clip name, or undefined when nothing is eligible.
 */
export function nextChainClip(motion: PetMotionView, life: PetLifeState = 'idle', enabled: readonly PetAction[] = PET_ACTIONS,
  previous: string | undefined, random: () => number): string | undefined {
  const allowed = (clip: string): boolean => {
    const action = clipAction(clip)
    return motion.clips[clip] !== undefined && (action === undefined || enabled.includes(action))
  }
  if (motion.categories === undefined || motion.categories.length === 0) {
    return nextIdleClip(previous, random(), lifeActions(life, enabled).map(action => ACTION_CLIP[action]).filter(allowed))
  }
  if (life === 'rest') return undefined
  const pools = motion.categories.filter(category => category.weight > 0 && category.life.includes(life))
    .map(category => ({ weight: category.weight, clips: category.clips.filter(allowed) }))
    .filter(pool => pool.clips.length > 0)
  const total = pools.reduce((sum, pool) => sum + pool.weight, 0)
  let point = Math.max(0, Math.min(0.999999, random())) * total
  const pool = pools.find(candidate => (point -= candidate.weight) < 0) ?? pools.at(-1)
  return pool === undefined ? undefined : nextIdleClip(previous, random(), pool.clips)
}

/** What autonomous walking may do now. */
export interface PetWalkGate {
  /** Whether autonomous movement is on (the wander preference, without reduced motion) and the surface can move. */
  readonly allowed: boolean
  /**
   * Whether the surface has room for a clip's whole travel in the direction it would walk.
   * @param clip - clip with a `move` record.
   * @returns true when the walk fits.
   */
  readonly room: (clip: string) => boolean
}

/**
 * Pick the next autonomous clip with the pack's top-level chain weights (upstream
 * `animationWeights`): `idle` draws from the categories as {@link nextChainClip}
 * does, `turn` plays a clip marked as a turn, and `move` plays a clip with
 * measured travel. A walk without room ahead turns around instead; with
 * walking off, the round falls back to the categories. Only the idle life
 * state uses the weights; other states and packs without weights use
 * {@link nextChainClip} alone.
 * @param motion - available character media.
 * @param life - selected life state.
 * @param enabled - device allowlist, or all actions when absent.
 * @param previous - last autonomous clip, which is not repeated when another is eligible.
 * @param random - uniform source in [0, 1).
 * @param walk - whether and where walking is possible.
 * @returns a clip name, or undefined when nothing is eligible.
 */
export function nextAutonomousClip(motion: PetMotionView, life: PetLifeState = 'idle', enabled: readonly PetAction[] = PET_ACTIONS,
  previous: string | undefined, random: () => number, walk: PetWalkGate): string | undefined {
  const chain = motion.chain
  const fallback = (): string | undefined => nextChainClip(motion, life, enabled, previous, random)
  if (chain === undefined || life !== 'idle') return fallback()
  const allowed = (clip: string): boolean => {
    const action = clipAction(clip)
    return action === undefined || enabled.includes(action)
  }
  const names = Object.keys(motion.clips).filter(allowed)
  const turns = names.filter(name => motion.clips[name]?.turn === true)
  const walks = names.filter(name => motion.clips[name]?.move !== undefined)
  const total = chain.idle + chain.turn + chain.move
  if (total <= 0) return fallback()
  const point = Math.max(0, Math.min(0.999999, random())) * total
  const turn = (): string | undefined => turns.length === 0 ? fallback() : nextIdleClip(previous, random(), turns)
  if (point < chain.idle) return fallback()
  if (point < chain.idle + chain.turn) return turn()
  if (!walk.allowed || walks.length === 0) return fallback()
  const open = walks.filter(walk.room)
  return open.length === 0 ? turn() : nextIdleClip(previous, random(), open)
}

/** Rendered clip width in CSS pixels at 100% size; pack clips are this wide on screen. */
export const PET_CLIP_WIDTH = 168

/**
 * Travel of a measured gait at a media time, interpolated between frame starts.
 * @param move - the clip's measured travel.
 * @param durationMs - clip duration.
 * @param seconds - media time.
 * @returns cumulative travel in source pixels along the artwork direction.
 */
export function travelAt(move: NonNullable<PetMotionView['clips'][string]['move']>, durationMs: number, seconds: number): number {
  const frames = move.travel.length
  if (frames === 0 || durationMs <= 0) return 0
  const position = Math.max(0, Math.min(frames - 1, seconds * 1000 / durationMs * frames))
  const index = Math.floor(position)
  const from = move.travel[index] ?? 0
  const to = move.travel[Math.min(frames - 1, index + 1)] ?? from
  return from + (to - from) * (position - index)
}

/**
 * Screen direction of a walk: the artwork direction, reversed when the clip is mirrored.
 * @param move - the clip's measured travel.
 * @param mirrored - whether the clip renders mirrored.
 * @returns the on-screen direction.
 */
export function walkDirection(move: { readonly direction: 'left' | 'right' }, mirrored: boolean): 'left' | 'right' {
  return (move.direction === 'left') !== mirrored ? 'left' : 'right'
}

/**
 * Screen pixels per source pixel for a clip rendered at a size.
 * @param motion - available character media; its `width` is the source width.
 * @param size - character size in percent.
 * @returns the scale from source to CSS pixels.
 */
export function travelScale(motion: Pick<PetMotionView, 'width'>, size = 100): number {
  return motion.width > 0 ? PET_CLIP_WIDTH * size / 100 / motion.width : 0
}

/** Mirror a clip for the current facing; movement clips follow travel direction instead.
 * @param motion - available character media.
 * @param name - playing clip.
 * @param facingRight - whether the character currently faces right after a turn.
 * @returns whether to mirror the clip horizontally.
 */
export function mirrorsClip(motion: PetMotionView, name: string, facingRight: boolean): boolean {
  return facingRight && !name.startsWith('swim') && motion.clips[name]?.mirror !== false
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
