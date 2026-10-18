/** Local animation continuations for autonomous travel and persistent sleep. */
import { useEffect, useRef, useState } from 'react'
import type { PetMotionView } from '@deepseek-ai/dsh-pet/types'

type Mode = 'travel' | 'rest' | undefined

/**
 * Keep entry, loop and exit clips together while task state owns interruption.
 * @param motion - available character media.
 * @param options - current local playback intent.
 * @returns the active continuation and its completion handler.
 */
export function useMotionPhases(motion: PetMotionView, options: {
  moving: boolean
  resting: boolean
  idle: boolean
  reduced: boolean
}): { clip: string | undefined; finish: (name: string) => boolean } {
  const { moving, resting, idle, reduced } = options
  const family = motion.clips.pillow_loop !== undefined ? 'pillow' : 'sleep'
  const mode: Mode = !idle ? undefined : moving && motion.clips.swim_loop !== undefined ? 'travel'
    : resting && motion.clips[`${family}_loop`] !== undefined ? 'rest' : undefined
  const [phase, setPhase] = useState<string | undefined>(() => {
    const initial = mode === 'travel' ? 'swim_start' : mode === 'rest' ? `${family}_enter` : undefined
    return initial !== undefined && motion.clips[initial] !== undefined ? initial : undefined
  })
  const previous = useRef<{ mode: Mode; family: string }>({ mode: undefined, family })
  useEffect(() => {
    const old = previous.current
    previous.current = { mode, family }
    if (!idle || reduced) { setPhase(undefined); return }
    if (mode === old.mode && family === old.family) return
    const requested = mode === 'travel' ? 'swim_start' : mode === 'rest' ? `${family}_enter`
      : old.mode === 'travel' ? 'swim_stop' : old.mode === 'rest' ? `${old.family}_wake` : undefined
    setPhase(requested !== undefined && motion.clips[requested] !== undefined ? requested : undefined)
  }, [mode, family, idle, reduced, motion])
  const base = mode === 'travel' ? 'swim_loop' : mode === 'rest' ? `${family}_loop` : undefined
  const clip = !idle ? undefined : reduced ? mode === 'rest' ? base : undefined : phase ?? base
  const finish = (name: string): boolean => {
    if (name !== phase) return false
    setPhase(mode === 'travel' ? 'swim_loop' : mode === 'rest' ? `${family}_loop` : undefined)
    return true
  }
  return { clip, finish }
}
