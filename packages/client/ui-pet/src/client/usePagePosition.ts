/** Pointer-driven Web positioning, independent of the character's expanding panels. */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { clampPetPoint, PET_CHARACTER_SIZE, PET_PAGE_POSITION_KEY, readPetPoint, type PetPagePoint } from './page-position.ts'
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

/** Move the Web character with the captured pointer and keep it visible on resize.
 * @param wander - whether autonomous movement is enabled.
 * @param size - character size in percent.
 * @param activity - movement frequency preset.
 * @returns position styles, movement state, and pointer handlers.
 */
export function usePagePosition(wander = false, size = 100, activity: PetActivityLevel = 'normal'): {
  style: CSSProperties
  below: boolean
  begin: (x: number, y: number, visual?: { readonly left: number; readonly top: number }) => void
  track: (x: number, y: number) => void
  drag: (phase: PetDragPhase) => void
  wandering: boolean
  direction: 'left' | 'right'
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
  const move = (next: PetPagePoint): void => {
    current.current = next
    setPoint(next)
  }
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
  const track = (x: number, y: number): void => { pointer.current = { x, y } }
  const begin = (x: number, y: number, visual?: { readonly left: number; readonly top: number }): void => {
    if (wandering && visual !== undefined) move({ x: visual.left, y: visual.top })
    setWandering(false)
    touched.current = Date.now()
    pressed.current = { x, y }
    track(x, y)
  }
  const drag = (phase: PetDragPhase): void => {
    if (phase === 'start') origin.current = { point: current.current, pointer: pressed.current }
    else if (phase === 'move' && origin.current !== undefined) {
      move(clampPetPoint({
        x: origin.current.point.x + pointer.current.x - origin.current.pointer.x,
        y: origin.current.point.y + pointer.current.y - origin.current.pointer.y,
      }, window.innerWidth, window.innerHeight, size))
    } else if (phase === 'end') {
      origin.current = undefined
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
      if (document.hidden || media?.matches === true || origin.current !== undefined || Date.now() - touched.current < 3000) {
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
  return { style, below, begin, track, drag, wandering, direction }
}
