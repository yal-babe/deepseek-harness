/** Pointer-driven Web positioning, independent of the character's expanding panels. */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { clampPetPoint, PET_CHARACTER_SIZE, PET_PAGE_POSITION_KEY, petPageSpace, readPetPoint, type PetPagePoint } from './page-position.ts'
import { estimateReleaseVelocity, springStep, throwStep, trimTrail, type PetDragSample, type PetThrowStep } from './physics.ts'
import { roamDelay, type PetActivityLevel } from './motion.ts'
import type { PetDragPhase } from './surface.ts'

function load(size = 100): PetPagePoint {
  let raw: string | null = null
  try { raw = window.localStorage.getItem(PET_PAGE_POSITION_KEY) } catch { /* Storage may be unavailable. */ }
  return readPetPoint(raw, window.innerWidth, window.innerHeight, size)
}

function save(point: PetPagePoint): void {
  try { window.localStorage.setItem(PET_PAGE_POSITION_KEY, JSON.stringify(point)) } catch { /* Keep memory-only placement. */ }
}

/** Move the Web character with the captured pointer and keep it visible on resize. With throwing on, the
 * character follows the pointer on a spring and a fling throws it with gravity and bounces inside the viewport.
 * @param wander - whether autonomous movement is enabled.
 * @param size - character size in percent.
 * @param activity - movement frequency preset.
 * @param throwing - whether drag physics is on (the preference, off under reduced motion).
 * @returns position styles, movement state, and pointer handlers.
 */
export function usePagePosition(wander = false, size = 100, activity: PetActivityLevel = 'normal', throwing = false): {
  style: CSSProperties
  below: boolean
  begin: (x: number, y: number, visual?: { readonly left: number; readonly top: number }) => void
  track: (x: number, y: number) => void
  drag: (phase: PetDragPhase) => void
  wandering: boolean
  direction: 'left' | 'right'
  /** Whether a thrown character is in the air. */
  flying: boolean
  /**
   * Whether the character can travel a distance horizontally inside the viewport.
   * @param direction - on-screen direction.
   * @param px - distance in CSS pixels.
   */
  room: (direction: 'left' | 'right', px: number) => boolean
  /**
   * Move the character horizontally with a walking clip; stops at the viewport edge.
   * @param dx - CSS pixels, negative to the left.
   * @param final - the walk ended; the position is saved.
   */
  travel: (dx: number, final: boolean) => void
} {
  const [point, setPoint] = useState(() => load(size))
  const [wandering, setWandering] = useState(false)
  const [direction, setDirection] = useState<'left' | 'right'>('right')
  const touched = useRef(Date.now())
  const current = useRef(point)
  const pointer = useRef<PetPagePoint>({ x: 0, y: 0 })
  const pressed = useRef<PetPagePoint>({ x: 0, y: 0 })
  const origin = useRef<{ readonly point: PetPagePoint; readonly pointer: PetPagePoint } | undefined>(undefined)
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight })
  const [flying, setFlying] = useState(false)
  const trail = useRef<readonly PetDragSample[]>([])
  const frame = useRef<number | undefined>(undefined)
  const physics = useRef(throwing)
  physics.current = throwing
  const walking = useRef(false)
  const move = (next: PetPagePoint): void => {
    current.current = next
    setPoint(next)
  }
  const stopFrames = (): void => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    frame.current = undefined
  }
  /** Run `step` once per animation frame with the elapsed seconds until it returns false. */
  const animate = (step: (dt: number) => boolean): void => {
    stopFrames()
    let last = performance.now()
    const tick = (now: number): void => {
      const dt = (now - last) / 1000
      last = now
      frame.current = step(dt) ? requestAnimationFrame(tick) : undefined
    }
    frame.current = requestAnimationFrame(tick)
  }
  const target = (): PetPagePoint | undefined => origin.current === undefined ? undefined : clampPetPoint({
    x: origin.current.point.x + pointer.current.x - origin.current.pointer.x,
    y: origin.current.point.y + pointer.current.y - origin.current.pointer.y,
  }, window.innerWidth, window.innerHeight, size)
  const land = (): void => {
    setFlying(false)
    move(clampPetPoint(current.current, window.innerWidth, window.innerHeight, size))
    save(current.current)
  }
  const fly = (velocity: { vx: number; vy: number }): void => {
    setFlying(true)
    let state: Pick<PetThrowStep, 'x' | 'y' | 'vx' | 'vy'> = { ...current.current, ...velocity }
    animate((dt) => {
      if (document.hidden) { land(); return false }
      const next = throwStep(state, dt, petPageSpace(window.innerWidth, window.innerHeight, size))
      state = next
      move({ x: next.x, y: next.y })
      if (next.atRest) land()
      return !next.atRest
    })
  }
  useEffect(() => () => { stopFrames() }, [])
  useEffect(() => {
    const resize = (): void => {
      const next = clampPetPoint(current.current, window.innerWidth, window.innerHeight, size)
      current.current = next
      setPoint(next)
      setViewport({ width: window.innerWidth, height: window.innerHeight })
      save(next)
    }
    resize()
    window.addEventListener('resize', resize)
    return () => { window.removeEventListener('resize', resize) }
  }, [size])
  const track = (x: number, y: number): void => {
    pointer.current = { x, y }
    if (origin.current !== undefined) trail.current = trimTrail([...trail.current, { t: performance.now(), x, y }], performance.now())
  }
  const begin = (x: number, y: number, visual?: { readonly left: number; readonly top: number }): void => {
    if (wandering && visual !== undefined) move({ x: visual.left, y: visual.top })
    // Catching a thrown character stops its flight where it is.
    if (frame.current !== undefined) { stopFrames(); setFlying(false) }
    trail.current = []
    setWandering(false)
    touched.current = Date.now()
    pressed.current = { x, y }
    track(x, y)
  }
  const drag = (phase: PetDragPhase): void => {
    if (phase === 'start') {
      origin.current = { point: current.current, pointer: pressed.current }
      if (!physics.current) return
      let velocity = { x: 0, y: 0 }
      animate((dt) => {
        const goal = target()
        if (goal === undefined) return false
        velocity = {
          x: springStep(velocity.x, current.current.x, goal.x, dt), y: springStep(velocity.y, current.current.y, goal.y, dt),
        }
        const step = Math.min(dt, 0.05)
        move(clampPetPoint({ x: current.current.x + velocity.x * step, y: current.current.y + velocity.y * step },
          window.innerWidth, window.innerHeight, size))
        return true
      })
    } else if (phase === 'move' && !physics.current) {
      const goal = target()
      if (goal !== undefined) move(goal)
    } else if (phase === 'end' && origin.current !== undefined) {
      const goal = target()
      origin.current = undefined
      stopFrames()
      const velocity = physics.current ? estimateReleaseVelocity(trail.current, performance.now()) : undefined
      trail.current = []
      if (velocity !== undefined) { fly(velocity); return }
      if (goal !== undefined) move(goal)
      save(current.current)
    }
  }
  useEffect(() => {
    if (!wander) { setWandering(false); return }
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let settle: ReturnType<typeof setInterval> | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = (): void => { timer = setTimeout(step, roamDelay(activity, Math.random())) }
    const step = (): void => {
      if (document.hidden || media?.matches === true || origin.current !== undefined || frame.current !== undefined || walking.current
        || Date.now() - touched.current < 3000) {
        schedule(); return
      }
      const from = current.current
      const next = clampPetPoint({ x: from.x + (Math.random() - 0.5) * 240,
        y: from.y + (Math.random() - 0.5) * 120 }, window.innerWidth, window.innerHeight, size)
      if (Math.hypot(next.x - from.x, next.y - from.y) < 8) { schedule(); return }
      setWandering(true)
      setDirection(next.x < from.x ? 'left' : 'right')
      const started = Date.now()
      settle = setInterval(() => {
        if (origin.current !== undefined || document.hidden || media?.matches === true) {
          clearInterval(settle); setWandering(false); save(current.current); schedule(); return
        }
        const progress = Math.min(1, (Date.now() - started) / 3000)
        const eased = progress * progress * (3 - 2 * progress)
        move({ x: from.x + (next.x - from.x) * eased, y: from.y + (next.y - from.y) * eased })
        if (progress === 1) { clearInterval(settle); setWandering(false); save(current.current); schedule() }
      }, 16)
    }
    schedule()
    return () => { clearTimeout(timer); clearInterval(settle); setWandering(false); save(current.current) }
  }, [wander, size, activity, viewport.width, viewport.height])
  const below = point.y < (viewport.height - PET_CHARACTER_SIZE.height * size / 100) / 2
  const style: CSSProperties = {
    left: point.x, top: point.y,
    '--pet-panel-width': `${Math.min(300, Math.max(0, viewport.width - 16))}px`,
    '--pet-panel-left': `${Math.max(8 - point.x, Math.min(0, viewport.width - 308 - point.x))}px`,
    '--pet-panel-height': `${Math.max(0, below ? viewport.height - point.y - PET_CHARACTER_SIZE.height * size / 100 - 24 : point.y - 16)}px`,
  } as CSSProperties
  const room = (side: 'left' | 'right', px: number): boolean => {
    const from = current.current
    const to = clampPetPoint({ x: from.x + (side === 'left' ? -px : px), y: from.y }, window.innerWidth, window.innerHeight, size)
    return Math.abs(to.x - from.x) >= px - 0.5
  }
  const travel = (dx: number, final: boolean): void => {
    if (final) {
      if (walking.current) save(current.current)
      walking.current = false
      return
    }
    if (origin.current !== undefined || frame.current !== undefined) return
    walking.current = true
    move(clampPetPoint({ x: current.current.x + dx, y: current.current.y }, window.innerWidth, window.innerHeight, size))
  }
  return { style, below, begin, track, drag, wandering, direction, flying, room, travel }
}
