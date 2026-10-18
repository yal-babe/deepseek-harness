/** Local animation continuations for autonomous travel and persistent sleep. */
import { useEffect, useRef, useState } from 'react'
import type { PetMotionView } from '@deepseek-ai/dsh-pet/types'

type Mode = 'travel' | 'rest' | undefined

/** Entry, persistent loop, and exit clip names of one continuation. */
export interface PetPhaseFamily {
  readonly enter: string
  readonly loop: string
  readonly exit: string
  /** Alternative exits, drawn with equal chance together with `exit` when the pack has them. */
  readonly exits?: readonly string[]
}

/**
 * Rest continuations in order of preference; the first whose loop the pack has is used. `pillow_*` and `sleep_*`
 * are the slots for dedicated sleeping clips (an AI-video pack plugs them back in by name), so they take precedence
 * over the upstream nap (`doze_*`, split from dsh-pet 原地小憩沉眠, which wakes gently or startled). Without any of
 * them, and without a single held `sleep` pose, the pet yawns, keeps the idle loop, and stretches when it wakes.
 */
export const PET_REST_FAMILIES: readonly PetPhaseFamily[] = [
  { enter: 'pillow_enter', loop: 'pillow_loop', exit: 'pillow_wake' },
  { enter: 'sleep_enter', loop: 'sleep_loop', exit: 'sleep_wake' },
  { enter: 'doze_enter', loop: 'doze_loop', exit: 'doze_wake', exits: ['doze_startle'] },
  { enter: 'idle_yawn', loop: 'idle', exit: 'idle_stretch' },
]

/** Travel continuation of autonomous gliding; the slot for directional swimming clips. */
export const PET_TRAVEL_FAMILY: PetPhaseFamily = { enter: 'swim_start', loop: 'swim_loop', exit: 'swim_stop' }

/**
 * Rest continuation a pack supports.
 * @param motion - available character media.
 * @returns the first rest family whose loop clip exists, or undefined when there is none or a dedicated family is
 * missing but a single `sleep` pose is held instead.
 */
export function restFamily(motion: PetMotionView): PetPhaseFamily | undefined {
  const fallback = PET_REST_FAMILIES.at(-1)
  return PET_REST_FAMILIES.find(family => family !== fallback && motion.clips[family.loop] !== undefined)
    ?? (motion.clips.sleep === undefined && fallback !== undefined && motion.clips[fallback.loop] !== undefined ? fallback : undefined)
}

/**
 * Whether a pack has the travel continuation that autonomous gliding plays; without it the pet only moves
 * through walking clips with measured travel.
 * @param motion - available character media, or undefined for a frame-only pack.
 * @returns true when the pack has `swim_loop`.
 */
export function hasTravelPhases(motion: PetMotionView | undefined): boolean {
  return motion?.clips[PET_TRAVEL_FAMILY.loop] !== undefined
}

/**
 * Exit clip of a family: `exit` or one of its alternatives, among those the pack has.
 * @param motion - available character media.
 * @param family - the continuation that ends.
 * @param random - uniform source in [0, 1).
 * @returns the exit to play, or undefined when the pack has none.
 */
export function familyExit(motion: PetMotionView, family: PetPhaseFamily | undefined, random: () => number): string | undefined {
  const candidates = family === undefined ? [] : [family.exit, ...family.exits ?? []].filter(name => motion.clips[name] !== undefined)
  return candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))]
}

/**
 * Keep entry, loop and exit clips together while task state owns interruption.
 * Missing entry or exit clips are skipped.
 * @param motion - available character media.
 * @param options - current local playback intent; `random` draws among alternative exits (default `Math.random`).
 * @returns the active continuation and its completion handler.
 */
export function useMotionPhases(motion: PetMotionView, options: {
  moving: boolean
  resting: boolean
  idle: boolean
  reduced: boolean
  random?: () => number
}): { clip: string | undefined; finish: (name: string) => boolean } {
  const { moving, resting, idle, reduced, random = Math.random } = options
  const rest = restFamily(motion)
  const mode: Mode = !idle ? undefined : moving && hasTravelPhases(motion) ? 'travel' : resting && rest !== undefined ? 'rest' : undefined
  const family = mode === 'travel' ? PET_TRAVEL_FAMILY : mode === 'rest' ? rest : undefined
  const available = (name: string | undefined): string | undefined =>
    name !== undefined && motion.clips[name] !== undefined ? name : undefined
  const [phase, setPhase] = useState<string | undefined>(() => available(family?.enter))
  const previous = useRef<{ mode: Mode; family: PetPhaseFamily | undefined }>({ mode: undefined, family })
  useEffect(() => {
    const old = previous.current
    previous.current = { mode, family }
    if (!idle || reduced) { setPhase(undefined); return }
    if (mode === old.mode && family?.loop === old.family?.loop) return
    setPhase(family !== undefined ? available(family.enter) : familyExit(motion, old.family, random))
  }, [mode, family?.loop, idle, reduced, motion])
  const base = family?.loop
  const clip = !idle ? undefined : reduced ? mode === 'rest' ? base : undefined : phase ?? base
  const finish = (name: string): boolean => {
    if (name !== phase) return false
    setPhase(family?.loop)
    return true
  }
  return { clip, finish }
}
