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

/** Whether the device allowlist lets a clip play autonomously: named interactions follow `enabled`,
 * pack-only clips follow `enabledClips`.
 * @param clip - pack clip name.
 * @param enabled - allowed named interactions, or all when absent.
 * @param enabledClips - allowed pack-only clips, or all when absent.
 * @returns whether the clip may be drawn.
 */
export function clipAllowed(clip: string, enabled: readonly PetAction[] = PET_ACTIONS, enabledClips?: readonly string[]): boolean {
  const action = clipAction(clip)
  return action !== undefined ? enabled.includes(action) : enabledClips === undefined || enabledClips.includes(clip)
}

/**
 * Upstream clips that stand in for a reserved AI-video slot. When the pack has the slot's own clip, the stand-in
 * steps aside in autonomous play and the thinking rotation, so the AI-video clip takes precedence.
 */
export const SLOT_STAND_INS: Readonly<Record<string, string>> = { whisper_daydream: 'idle_daydream', thinking_deep: 'thinking_chin' }

/** Whether a stand-in clip yields to the slot clip it stands in for.
 * @param motion - available character media.
 * @param clip - pack clip name.
 * @returns true when the pack has the clip of the slot that `clip` stands in for.
 */
export function standsAside(motion: PetMotionView, clip: string): boolean {
  const slot = SLOT_STAND_INS[clip]
  return slot !== undefined && motion.clips[slot] !== undefined
}

/** Pack-only clips the autonomous chain can draw: members of categories with a life state, turns, and walks.
 * @param motion - available character media.
 * @returns clip names in pack order, without named interactions.
 */
export function autonomousPackClips(motion: PetMotionView | undefined): readonly string[] {
  if (motion === undefined) return []
  const listed = (motion.categories ?? []).filter(category => category.life.length > 0).flatMap(category => category.clips)
  const chained = motion.chain === undefined ? []
    : Object.keys(motion.clips).filter(name => motion.clips[name]?.turn === true || motion.clips[name]?.move !== undefined)
  return [...new Set([...listed, ...chained])].filter(name => motion.clips[name] !== undefined && clipAction(name) === undefined)
}

/** Select autonomous actions for the life state, respecting the device allowlist.
 * @param life - selected life state.
 * @param enabled - device allowlist, or all actions when absent.
 * @returns eligible action names.
 */
export function lifeActions(life: PetLifeState = 'idle', enabled: readonly PetAction[] = PET_ACTIONS): readonly PetAction[] {
  const candidates = life === 'play' ? PLAY_ACTIONS : life === 'rest' ? [] : QUIET_ACTIONS
  return enabled.filter(action => candidates.includes(action))
}
/** What the autonomous chain knows about now: the clock, the Host's festivals, cooldowns, and the time-bound switch. */
export interface PetChainMoment {
  /** Epoch milliseconds; hours and months read the device's local time. */
  readonly now: number
  /** Festivals whose window covers the Host's local date ({@link PetMotionView} `schedule` festival rules). */
  readonly festivals: readonly string[]
  /** Whether time-bound clips (festivals, seasons, meals) may play autonomously; off keeps them menu-only. */
  readonly occasions: boolean
  /** Epoch milliseconds until which each cooldown group rests. */
  readonly cooldowns: ReadonlyMap<string, number>
}

type ScheduleRule = NonNullable<PetMotionView['schedule']>['rules'][number]

/** Whether a schedule rule is open at a local time.
 * @param rule - pack schedule rule.
 * @param date - local time.
 * @param festivals - festivals whose window covers the date.
 * @returns true when every condition the rule states holds.
 */
export function scheduleRuleOpen(rule: ScheduleRule, date: Date, festivals: readonly string[]): boolean {
  const hour = date.getHours() + date.getMinutes() / 60
  return (rule.hours === undefined || rule.hours.some(([from, to]) => hour >= from && hour < to))
    && (rule.months === undefined || rule.months.includes(date.getMonth() + 1))
    && (rule.festivals === undefined || rule.festivals.some(festival => festivals.includes(festival)))
}

/** Whether the schedule lets a clip play autonomously now: unlisted clips always may; listed clips need an open rule,
 * a known moment, and time-bound clips switched on.
 * @param motion - available character media.
 * @param clip - pack clip name.
 * @param moment - chain moment, or undefined when unknown (listed clips then stay out).
 * @returns whether the chain may draw the clip.
 */
export function scheduleAllows(motion: PetMotionView, clip: string, moment: PetChainMoment | undefined): boolean {
  const rules = (motion.schedule?.rules ?? []).filter(rule => rule.clips.includes(clip))
  if (rules.length === 0) return true
  if (moment === undefined || !moment.occasions) return false
  const date = new Date(moment.now)
  return rules.some(rule => scheduleRuleOpen(rule, date, moment.festivals))
}

/** Multiplier of category cooldowns for an activity preset: quiet waits twice as long, lively half as long. */
export const COOLDOWN_SCALE: Readonly<Record<PetActivityLevel, number>> = { quiet: 2, normal: 1, lively: 0.5 }

/** Cooldown to start after the chain played a clip: its category's group and pause, scaled by the activity preset.
 * @param motion - available character media.
 * @param clip - clip the chain chose.
 * @param level - activity preset.
 * @returns the group and the pause in milliseconds, or undefined when the clip's category has none.
 */
export function chainCooldown(motion: PetMotionView, clip: string, level: PetActivityLevel = 'normal'):
  { readonly group: string; readonly ms: number } | undefined {
  const cooldown = motion.categories?.find(category => category.clips.includes(clip))?.cooldown
  return cooldown === undefined ? undefined : { group: cooldown.group, ms: cooldown.ms * COOLDOWN_SCALE[level] }
}

/** Pick the next autonomous clip: a category by weight among those for the life state, then a fresh clip in it.
 * Packs without categories fall back to {@link lifeActions}. Every clip must pass the device allowlist
 * ({@link clipAllowed}) and the pack schedule ({@link scheduleAllows}); a category whose cooldown group still rests
 * is skipped.
 * @param motion - available character media.
 * @param life - selected life state; resting never decorates.
 * @param enabled - device allowlist, or all actions when absent.
 * @param previous - last autonomous clip, which is not repeated when another is eligible.
 * @param random - uniform source in [0, 1), called once for the category and once for the clip.
 * @param enabledClips - allowed pack-only clips, or all when absent.
 * @param moment - clock, festivals, and cooldowns; without it time-bound clips stay out and cooldowns are not read.
 * @returns a clip name, or undefined when nothing is eligible.
 */
export function nextChainClip(motion: PetMotionView, life: PetLifeState = 'idle', enabled: readonly PetAction[] = PET_ACTIONS,
  previous: string | undefined, random: () => number, enabledClips?: readonly string[], moment?: PetChainMoment): string | undefined {
  const allowed = (clip: string): boolean =>
    motion.clips[clip] !== undefined && !standsAside(motion, clip) && clipAllowed(clip, enabled, enabledClips)
    && scheduleAllows(motion, clip, moment)
  const resting = (group: string | undefined): boolean =>
    group !== undefined && moment !== undefined && (moment.cooldowns.get(group) ?? 0) > moment.now
  if (motion.categories === undefined || motion.categories.length === 0) {
    return nextIdleClip(previous, random(), lifeActions(life, enabled).map(action => ACTION_CLIP[action]).filter(allowed))
  }
  if (life === 'rest') return undefined
  const pools = motion.categories.filter(category =>
    category.weight > 0 && category.life.includes(life) && !resting(category.cooldown?.group))
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
 * @param enabledClips - allowed pack-only clips, or all when absent.
 * @param moment - clock, festivals, and cooldowns for the categories ({@link nextChainClip}).
 * @returns a clip name, or undefined when nothing is eligible.
 */
export function nextAutonomousClip(motion: PetMotionView, life: PetLifeState = 'idle', enabled: readonly PetAction[] = PET_ACTIONS,
  previous: string | undefined, random: () => number, walk: PetWalkGate, enabledClips?: readonly string[],
  moment?: PetChainMoment): string | undefined {
  const chain = motion.chain
  const fallback = (): string | undefined => nextChainClip(motion, life, enabled, previous, random, enabledClips, moment)
  if (chain === undefined || life !== 'idle') return fallback()
  const names = Object.keys(motion.clips).filter(clip => clipAllowed(clip, enabled, enabledClips))
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

/** Work-status tier of each task state (upstream `events.workStatus`: thinking, working, result, waiting, success, error). */
const WORK_TIER: Readonly<Partial<Record<PetAgentState, number>>> = { THINKING: 0, WORKING: 1, WAITING: 3, SUCCESS: 4, ERROR: 5 }
/** Tier played while commands or tests run: upstream's result tier, which Studio already used for them. */
const RESULT_TIER = 2

/** First candidate of an event tier that the pack has.
 * @param motion - available character media.
 * @param event - `balance` or `workStatus`.
 * @param tier - tier index.
 * @param random - uniform source in [0, 1); omitted picks the first candidate.
 * @param previous - clip played last for this event, avoided when another candidate exists.
 * @returns a clip name, or undefined when the pack declares no usable candidate.
 */
export function eventClip(motion: PetMotionView | undefined, event: 'balance' | 'workStatus', tier: number, random?: () => number,
  previous?: string): string | undefined {
  const candidates = (motion?.events?.[event]?.[tier] ?? []).filter(name => motion?.clips[name] !== undefined)
  return random === undefined ? candidates[0] : nextIdleClip(previous, random(), candidates)
}

/** Map the Host state and tool activity to a full-length clip: the pack's work-status tier when it declares one,
 * with the activity-specific search clip kept, otherwise the built-in names.
 * @param state - current task state.
 * @param activity - current tool activity.
 * @param motion - available character media, whose event tiers take precedence.
 * @returns the animation name to play.
 */
export function taskClip(state: PetAgentState, activity?: PetWorkActivity, motion?: PetMotionView): string {
  if (state === 'WORKING' && motion !== undefined) {
    if ((activity === 'reply' || activity === 'search') && motion.clips.jot_notes !== undefined) return 'jot_notes'
    if ((activity === 'edit' || activity === 'command' || activity === 'test') && motion.clips.write_code !== undefined) return 'write_code'
  }
  const command = state === 'WORKING' && (activity === 'command' || activity === 'test')
  if (state === 'WORKING' && activity === 'search' && (motion === undefined || motion.clips.working_search !== undefined)) return 'working_search'
  const tier = command ? RESULT_TIER : WORK_TIER[state]
  const declared = tier === undefined ? undefined : eventClip(motion, 'workStatus', tier)
  if (declared !== undefined) return declared
  if (state === 'WORKING') return activity === 'search' ? 'working_search' : command ? 'working_command' : 'working'
  return { IDLE: 'idle', DISCONNECTED: 'idle', THINKING: 'thinking', WAITING: 'waiting', SUCCESS: 'success', ERROR: 'error' }[state]
}

/** Body area of a click, top to bottom. */
export type PetClickArea = 'head' | 'body' | 'tail'

/** Built-in interaction of each body area, used when the pack names no click responses. */
export const AREA_ACTION: Readonly<Record<PetClickArea, PetAction>> = { head: 'headPat', body: 'poke', tail: 'tail' }

/** Body area at a vertical position on the character.
 * @param y - pointer position from the top of the visible character, as a fraction of its height.
 * @returns the head above 35%, the tail below 72%, otherwise the body.
 */
export function clickArea(y: number): PetClickArea {
  return y < 0.35 ? 'head' : y > 0.72 ? 'tail' : 'body'
}

/** Clip a click on a body area plays: a fresh candidate of the pack's click responses, else the built-in interaction.
 * @param motion - available character media.
 * @param area - clicked body area.
 * @param random - uniform source in [0, 1).
 * @param previous - clip the last click played, avoided when another candidate exists.
 * @returns a pack clip name.
 */
export function clickClip(motion: PetMotionView | undefined, area: PetClickArea, random: () => number, previous?: string): string {
  const candidates = (motion?.clicks?.[area] ?? []).filter(name => motion?.clips[name] !== undefined)
  return nextIdleClip(previous, random(), candidates) ?? ACTION_CLIP[AREA_ACTION[area]]
}

/** Balance tier of a used percentage (upstream `balanceEventIndex`): 20% bands, with tier 5 only at exactly 100%.
 * @param usedPercent - used balance, 0 (untouched) to 100 (all used); values outside are clamped.
 * @returns a tier from 0 to 5.
 */
export function balanceTier(usedPercent: number): number {
  // Adapted from PC2005-cloud/dsh-pet (MIT), commit 091b27b, dsh-pet/src/shared/balance.ts (balanceEventIndex).
  const percent = Math.max(0, Math.min(100, Number.isFinite(usedPercent) ? usedPercent : 0))
  return percent === 100 ? 5 : Math.min(4, Math.floor(percent / 20))
}

/**
 * Shipped video clips that stand in for an action clip the pack lacks, in order of preference. The names on the
 * left are slots: a pack that adds a clip with that name (for example an AI-video `play_ball`) plays it instead.
 */
export const CLIP_SUBSTITUTES: Readonly<Record<string, readonly string[]>> = {
  bubbles: ['click_bounce', 'idle'], celebrate: ['success'], nuzzle: ['head_pat'], sleep: ['idle_yawn'], rest_pillow: ['idle_yawn'],
  idle_daydream: ['whisper_daydream', 'idle_yawn'], idle_observe: ['look_around'], idle_groom: ['idle_stretch'], swim: ['idle'],
  play_bubbles: ['click_bounce'], play_ball: ['click_bounce'], play_tailspin: ['turn_run', 'click_bounce'],
  work_read: ['thinking'], thinking_chin: ['thinking_deep', 'thinking'], thinking_idea: ['thinking'],
}

/** Clip to play for a requested animation: the clip itself, or an available substitute when the pack lacks it or
 * only has a legacy sparsely sampled sheet of it (eight poses or fewer).
 * @param name - requested animation.
 * @param motion - available character media.
 * @returns the original clip when present and sufficiently sampled, otherwise the first available substitute.
 */
export function smoothClip(name: string, motion: PetMotionView): string {
  const clip = motion.clips[name]
  if (clip !== undefined && (clip.sheet === undefined || clip.sheet.frames > 8)) return name
  return (CLIP_SUBSTITUTES[name] ?? []).find(substitute => motion.clips[substitute] !== undefined) ?? name
}

/** Named interactions whose own clip the pack has, for menus and settings; all of them for a frame-only pack.
 * @param motion - available character media.
 * @returns the interactions in {@link PET_ACTIONS} order.
 */
export function availableActions(motion: PetMotionView | undefined): readonly PetAction[] {
  return motion === undefined ? PET_ACTIONS : PET_ACTIONS.filter(action => motion.clips[ACTION_CLIP[action]] !== undefined)
}
