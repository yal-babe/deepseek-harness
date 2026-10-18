/** Full-length transparent clips, idle scheduling, and bounded decorative effects. */
import { useEffect, useRef, useState } from 'react'
import type { PetAgentState, PetMotionView, PetWorkActivity } from '@deepseek-ai/dsh-pet/types'
import {
  idleDelay, mirrorsClip, nextAutonomousClip, nextIdleClip, petIsIdle, requestedClip, smoothClip, taskClip, travelAt, travelScale,
  walkDirection, type PetActionRequest,
} from './motion.ts'
import type { PetPreferences } from './preferences.ts'
import { useMotionPhases } from './useMotionPhases.ts'
import { PetSprite } from './PetSprite.tsx'
import css from './Pet.module.css'

export type PetEffect = 'bubbles' | 'hearts' | 'ripple' | 'stars' | 'sleep'

const CLIP_EFFECT: Readonly<Record<string, PetEffect>> = { bubbles: 'bubbles', nuzzle: 'hearts', head_pat: 'hearts', celebrate: 'stars', sleep: 'sleep' }
/** Effect accompanying a requested or autonomous clip; the key spreads into a decoration. */
function clipEffect(name: string): { effect?: PetEffect } {
  const effect = CLIP_EFFECT[name]
  return effect === undefined ? {} : { effect }
}

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

/** How the surface moves the character while a measured gait plays. */
export interface PetWalkSurface {
  /** Whether autonomous walking is on (the wander preference) and the surface may move now. */
  readonly allowed: boolean
  /**
   * Whether there is room to travel a distance in a direction.
   * @param direction - on-screen direction.
   * @param px - distance in CSS pixels.
   * @returns true when the walk fits.
   */
  readonly room: (direction: 'left' | 'right', px: number) => boolean
  /**
   * Move the character horizontally with its steps.
   * @param dx - CSS pixels since the last call, negative to the left.
   * @param final - the walk ended or was cancelled; the surface saves its position.
   */
  readonly travel: (dx: number, final: boolean) => void
}

/** Media is downloaded only when selected; a failed clip falls back to the built-in still frames. */
export function PetMotion({ motion, state, activity, action, dragging, preferences, paused, movement, poster, onFailure, walk }: {
  readonly motion: PetMotionView
  readonly state: PetAgentState
  readonly activity?: PetWorkActivity | undefined
  readonly action?: PetActionRequest | undefined
  readonly poster?: string | undefined
  readonly movement?: { moving: boolean; direction: 'left' | 'right' } | undefined
  readonly dragging: boolean
  readonly preferences: PetPreferences
  readonly paused: boolean
  readonly onFailure: () => void
  /** Surface movement for walking clips; without it measured gaits play in place and are not chosen autonomously. */
  readonly walk?: PetWalkSurface | undefined
}) {
  const walker = useRef(walk)
  walker.current = walk
  const video = useRef<HTMLVideoElement>(null)
  const loadedSheets = useRef(new Set<string>())
  const [decoration, setDecoration] = useState<{ name: string; serial: number; effect?: PetEffect } | undefined>(undefined)
  const [visible, setVisible] = useState(!document.hidden)
  const [systemReduced, setSystemReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true)
  const resultClip = useRef('success')
  const [thinkingName, setThinkingName] = useState('thinking')
  const thinkingCandidates = ['thinking', 'thinking_chin', 'thinking_idea', 'work_read'].filter(name => motion.clips[name] !== undefined)
  useEffect(() => {
    if (state === 'THINKING') setThinkingName(previous => nextIdleClip(previous, Math.random(), thinkingCandidates) ?? 'thinking')
  }, [state, motion])
  const [heldResult, setHeldResult] = useState(false)
  useEffect(() => {
    if (state === 'SUCCESS') {
      resultClip.current = smoothClip(motion.clips.celebrate !== undefined && Math.random() < 0.35 ? 'celebrate' : 'success', motion)
      setHeldResult(true)
    }
    else if (!petIsIdle(state)) setHeldResult(false)
  }, [state])
  const previousIdle = useRef<string | undefined>(undefined)
  // A completed turn clip (such as look-around) leaves the character facing the other way.
  const [facingRight, setFacingRight] = useState(false)
  const wasDragging = useRef(false)
  const cooldown = useRef(0)
  const handledAction = useRef<PetActionRequest | undefined>(undefined)
  const reduced = systemReduced || preferences.reducedMotion === true
  const idle = petIsIdle(state)
  const resting = idle && !heldResult && preferences.life === 'rest'
  const moving = idle && !heldResult && movement?.moving === true && !reduced && !dragging
  const lifecycle = useMotionPhases(motion, { moving, resting, idle: idle && !heldResult && !dragging, reduced })
  const canInteract = idle && !heldResult && !paused && visible && !reduced && !dragging && !moving
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
    if (!idle || paused || reduced || !visible || resting || moving) {
      setDecoration(current => current?.name === 'dragging_release' && visible && !reduced ? current : undefined)
    }
  }, [idle, paused, reduced, visible, state, resting, moving])
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
    const requested = requestedClip(action)
    setDecoration({ name: smoothClip(requested, motion), serial: action.serial, ...clipEffect(requested) })
  }, [action, canInteract, decoration?.name, motion])
  useEffect(() => {
    if (!canDecorate || decoration !== undefined) return
    const timer = setTimeout(() => {
      const size = preferences.size ?? 100
      const surface = walker.current
      const name = nextAutonomousClip(motion, preferences.life, preferences.actions, previousIdle.current, Math.random, {
        allowed: surface?.allowed === true,
        room: (candidate) => {
          const move = motion.clips[candidate]?.move
          if (move === undefined || surface === undefined) return false
          const distance = Math.abs(move.travel.at(-1) ?? 0) * travelScale(motion, size)
          return surface.room(walkDirection(move, mirrorsClip(motion, candidate, facingRight)), distance)
        },
      }, preferences.clips)
      if (name === undefined) return
      previousIdle.current = name
      setDecoration({ name: smoothClip(name, motion), serial: Date.now(), ...clipEffect(name) })
    }, idleDelay(preferences.activity ?? 'normal', Math.random()) * (preferences.life === 'play' ? 0.75 : 1))
    return () => { clearTimeout(timer) }
  }, [
    canDecorate, decoration, preferences.activity, preferences.actions, preferences.clips, preferences.life, preferences.size, motion,
    facingRight,
  ])
  // Decorative idle is deliberately finite even though the source idle clip loops.
  useEffect(() => {
    if (decoration?.name !== 'idle') return
    const timer = setTimeout(() => { setDecoration(undefined) }, 7000)
    return () => { clearTimeout(timer) }
  }, [decoration])
  const name = dragging ? 'dragging' : decoration?.name ?? lifecycle.clip ?? (resting && motion.clips.sleep !== undefined ? 'sleep' : state === 'SUCCESS' || heldResult && idle ? resultClip.current : state === 'THINKING' ? thinkingName : taskClip(state, activity, motion))
  const clip = motion.clips[name] ?? motion.clips.idle
  const serial = decoration?.serial ?? 0
  // A measured gait moves the surface with the media position, so the feet do not slide; cancelling the clip ends the walk.
  const walking = decoration !== undefined && clip?.move !== undefined && clip.sheet === undefined && name === decoration.name
  useEffect(() => {
    const move = clip?.move
    const player = video.current
    if (!walking || move === undefined || player === null || walker.current === undefined) return
    const sign = walkDirection(move, mirrorsClip(motion, name, facingRight)) === 'left' ? -1 : 1
    const scale = travelScale(motion, preferences.size ?? 100)
    let last = 0
    let frame = requestAnimationFrame(function step() {
      const travelled = travelAt(move, clip.durationMs, player.currentTime)
      const dx = (travelled - last) * scale * sign
      last = travelled
      if (dx !== 0) walker.current?.travel(dx, false)
      frame = requestAnimationFrame(step)
    })
    return () => { cancelAnimationFrame(frame); walker.current?.travel(0, true) }
  }, [walking, name, serial])
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
  const finish = (): void => {
    if (decoration !== undefined) {
      if (clip.turn === true && name === decoration.name) setFacingRight(current => !current)
      setDecoration(undefined); return
    }
    if (lifecycle.finish(name)) return
    if (state === 'THINKING' && thinkingCandidates.length > 1) {
      setThinkingName(previous => nextIdleClip(previous, Math.random(), thinkingCandidates) ?? 'thinking'); return
    }
    setEnded(true); setHeldResult(false)
  }
  // Swim clips are drawn facing left (see the AI-video clip guide); rightward travel mirrors every phase. Others follow the facing.
  const mirrored = name.startsWith('swim_') ? movement?.direction === 'right' : mirrorsClip(motion, name, facingRight)
  return <span className={css.motionContent} data-pet-clip={name} data-pet-facing={facingRight ? 'right' : 'left'}
    style={mirrored ? { transform: 'scaleX(-1)' } : undefined}>
    {clip.sheet !== undefined ? <PetSprite key={`${name}:${serial}`} clip={clip} sheet={clip.sheet} poster={poster} knownReady={loadedSheets.current.has(clip.url)} onReady={() => { loadedSheets.current.add(clip.url) }} resting={resting && lifecycle.clip === undefined && clip.sheet.frames <= 8} loop={decoration === undefined && clip.loop && !(state === 'THINKING' && thinkingCandidates.length > 1)} paused={!visible || reduced} onEnd={finish} onFailure={onFailure} /> : <video ref={video} key={`${name}:${serial}`} className={css.motion} src={clip.url}
      muted playsInline preload="auto" loop={decoration === undefined && !dragging ? clip.loop && !(state === 'THINKING' && thinkingCandidates.length > 1) : dragging}
      onError={onFailure} onEnded={finish} /> }
    {effect !== undefined && <PetEffects key={`${name}:${serial}:${effect}`} effect={effect} />}
  </span>
}
