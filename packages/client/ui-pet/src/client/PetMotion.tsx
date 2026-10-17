/** Full-length transparent clips, idle scheduling, and bounded decorative effects. */
import { useEffect, useRef, useState } from 'react'
import type { PetAgentState, PetMotionView, PetWorkActivity } from '@deepseek-ai/dsh-pet/types'
import { ACTION_CLIP, idleDelay, nextIdleClip, petIsIdle, smoothClip, taskClip, type PetActionRequest } from './motion.ts'
import type { PetPreferences } from './preferences.ts'
import { PetSprite } from './PetSprite.tsx'
import css from './Pet.module.css'

export type PetEffect = 'bubbles' | 'hearts' | 'ripple' | 'stars' | 'sleep'

/** Small effects never capture clicks except individually positioned bubbles. */
export function PetEffects({ effect }: { readonly effect: PetEffect }) {
  const [popped, setPopped] = useState<readonly number[]>([])
  const count = effect === 'sleep' ? 3 : effect === 'ripple' ? 1 : 6
  return <span className={css.effects} data-effect={effect} aria-hidden="true">
    {Array.from({ length: count }, (_, i) => (
      <span key={i} className={css.particle} style={{ '--particle': i, ...popped.includes(i) ? { animation: 'none', opacity: 0 } : {} } as React.CSSProperties}
        onClick={(event) => { event.stopPropagation() }}
        onPointerDown={(event) => { if (effect === 'bubbles') { event.stopPropagation(); setPopped(current => [...current, i]) } }}>
        {effect === 'hearts' ? '♥' : effect === 'stars' ? '✦' : effect === 'sleep' ? '☾' : ''}
      </span>
    ))}
  </span>
}

/** Media is downloaded only when selected; a failed clip falls back to the built-in still frames. */
export function PetMotion({ motion, state, activity, action, dragging, preferences, paused, onFailure }: {
  readonly motion: PetMotionView
  readonly state: PetAgentState
  readonly activity?: PetWorkActivity | undefined
  readonly action?: PetActionRequest | undefined
  readonly dragging: boolean
  readonly preferences: PetPreferences
  readonly paused: boolean
  readonly onFailure: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [decoration, setDecoration] = useState<{ name: string; serial: number; effect?: PetEffect } | undefined>(undefined)
  const [visible, setVisible] = useState(!document.hidden)
  const [systemReduced, setSystemReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true)
  const resultClip = useRef('success')
  const [heldResult, setHeldResult] = useState(false)
  useEffect(() => {
    if (state === 'SUCCESS') {
      resultClip.current = smoothClip(motion.clips.celebrate !== undefined && Math.random() < 0.35 ? 'celebrate' : 'success', motion)
      setHeldResult(true)
    }
    else if (!petIsIdle(state)) setHeldResult(false)
  }, [state])
  const previousIdle = useRef<string | undefined>(undefined)
  const wasDragging = useRef(false)
  const cooldown = useRef(0)
  const handledAction = useRef<PetActionRequest | undefined>(undefined)
  const reduced = systemReduced || preferences.reducedMotion === true
  const idle = petIsIdle(state)
  const resting = idle && preferences.life === 'rest'
  const canInteract = idle && !heldResult && !paused && visible && !reduced && !dragging
  const canDecorate = !resting && canInteract
  useEffect(() => {
    const update = (): void => { setVisible(!document.hidden) }
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const changed = (): void => { setSystemReduced(query?.matches === true) }
    document.addEventListener('visibilitychange', update)
    query?.addEventListener?.('change', changed)
    return () => { document.removeEventListener('visibilitychange', update); query?.removeEventListener?.('change', changed) }
  }, [])
  useEffect(() => {
    if (!idle || paused || reduced || !visible || resting) {
      setDecoration(current => current?.name === 'dragging_release' && visible && !reduced ? current : undefined)
    }
  }, [idle, paused, reduced, visible, state, resting])
  useEffect(() => {
    if (dragging) { wasDragging.current = true; setDecoration(undefined) }
    else if (wasDragging.current) {
      wasDragging.current = false
      setDecoration({ name: 'dragging_release', serial: Date.now(), effect: 'ripple' })
    }
  }, [dragging])
  useEffect(() => {
    if (action === undefined || handledAction.current === action) return
    if (!canInteract) { handledAction.current = action; return }
    // A deliberate menu selection waits for landing; refused work-time requests never queue.
    if (decoration?.name === 'dragging_release') return
    handledAction.current = action
    if (action.interrupt !== true && (decoration !== undefined || Date.now() < cooldown.current)) return
    cooldown.current = Date.now() + 1200
    setDecoration({ name: smoothClip(ACTION_CLIP[action.action], motion), serial: action.serial,
      ...action.action === 'celebrate' ? { effect: 'stars' as const }
        : action.action === 'nuzzle' ? { effect: 'hearts' as const }
          : action.action === 'bubbles' ? { effect: 'bubbles' as const }
            : action.action === 'sleep' ? { effect: 'sleep' as const }
              : action.action === 'headPat' ? { effect: 'hearts' as const } : {},
    })
  }, [action, canInteract, decoration?.name, motion])
  useEffect(() => {
    if (!canDecorate || decoration !== undefined) return
    const timer = setTimeout(() => {
      const allowed = (preferences.actions ?? Object.keys(ACTION_CLIP) as (keyof typeof ACTION_CLIP)[])
        .filter(action => preferences.life !== 'play' || !['sleep', 'yawn'].includes(action))
        .map(action => ACTION_CLIP[action]).filter(name => motion.clips[name] !== undefined)
      const name = nextIdleClip(previousIdle.current, Math.random(), allowed)
      if (name === undefined) return
      previousIdle.current = name
      setDecoration({ name: smoothClip(name, motion), serial: Date.now(),
        ...name === 'bubbles' ? { effect: 'bubbles' as const }
          : name === 'nuzzle' || name === 'head_pat' ? { effect: 'hearts' as const }
            : name === 'celebrate' ? { effect: 'stars' as const }
              : name === 'sleep' ? { effect: 'sleep' as const } : {},
      })
    }, idleDelay(preferences.activity ?? 'normal', Math.random()) * (preferences.life === 'play' ? 0.75 : 1))
    return () => { clearTimeout(timer) }
  }, [canDecorate, decoration, preferences.activity, preferences.actions, preferences.life, motion])
  // Decorative idle is deliberately finite even though the source idle clip loops.
  useEffect(() => {
    if (decoration?.name !== 'idle') return
    const timer = setTimeout(() => { setDecoration(undefined) }, 7000)
    return () => { clearTimeout(timer) }
  }, [decoration])
  const name = dragging ? 'dragging' : decoration?.name ?? (resting && motion.clips.sleep !== undefined ? 'sleep' : state === 'SUCCESS' || heldResult && idle ? resultClip.current : taskClip(state, activity))
  const clip = motion.clips[name] ?? motion.clips.idle
  const serial = decoration?.serial ?? 0
  const [ended, setEnded] = useState(false)
  useEffect(() => { setEnded(false) }, [name, serial])
  useEffect(() => {
    const player = video.current
    if (player === null) return
    if (!visible || reduced) { player.pause(); if (reduced) player.currentTime = 0; return }
    void player.play().catch(() => { /* A real media error reaches onError; autoplay refusal keeps a still. */ })
    return () => { player.pause() }
  }, [name, serial, visible, reduced])
  if (clip === undefined) return null
  const effect = preferences.effects === false || reduced || !visible ? undefined
    : decoration?.effect ?? ((name === 'success' || name === 'celebrate') && !ended ? 'stars' : undefined)
  const finish = (): void => { setEnded(true); setHeldResult(false); if (decoration !== undefined) setDecoration(undefined) }
  return <>
    {clip.sheet !== undefined ? <PetSprite key={`${name}:${serial}`} clip={clip} sheet={clip.sheet} resting={resting} loop={decoration === undefined && !resting && clip.loop} paused={!visible || reduced} onEnd={finish} onFailure={onFailure} /> : <video ref={video} key={`${name}:${serial}`} className={css.motion} src={clip.url}
      muted playsInline preload="auto" loop={decoration === undefined && !dragging ? clip.loop : dragging}
      onError={onFailure} onEnded={finish} /> }
    {effect !== undefined && <PetEffects key={`${name}:${serial}:${effect}`} effect={effect} />}
  </>
}
