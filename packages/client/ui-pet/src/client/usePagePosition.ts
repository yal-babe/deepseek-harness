/** Pointer-driven Web positioning, independent of the character's expanding panels. */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { clampPetPoint, PET_CHARACTER_SIZE, PET_PAGE_POSITION_KEY, readPetPoint, type PetPagePoint } from './page-position.ts'
import type { PetDragPhase } from './surface.ts'

function load(): PetPagePoint {
  let raw: string | null = null
  try { raw = window.localStorage.getItem(PET_PAGE_POSITION_KEY) } catch { /* Storage may be unavailable. */ }
  return readPetPoint(raw, window.innerWidth, window.innerHeight)
}

function save(point: PetPagePoint): void {
  try { window.localStorage.setItem(PET_PAGE_POSITION_KEY, JSON.stringify(point)) } catch { /* Keep memory-only placement. */ }
}

/** Move the Web character with the captured pointer and keep it visible on resize. */
export function usePagePosition(wander = false) {
  const [point, setPoint] = useState(load)
  const [wandering, setWandering] = useState(false)
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
      const next = clampPetPoint(current.current, window.innerWidth, window.innerHeight)
      current.current = next
      setPoint(next)
      setViewport({ width: window.innerWidth, height: window.innerHeight })
      save(next)
    }
    window.addEventListener('resize', resize)
    return () => { window.removeEventListener('resize', resize) }
  }, [])
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
      }, window.innerWidth, window.innerHeight))
    } else if (phase === 'end') {
      origin.current = undefined
      save(current.current)
    }
  }
  useEffect(() => {
    if (!wander) { setWandering(false); return }
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let settle: ReturnType<typeof setTimeout> | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let mouse = { x: -1000, y: -1000 }
    const touch = (): void => { touched.current = Date.now() }
    const pointerMoved = (event: PointerEvent): void => {
      mouse = { x: event.clientX, y: event.clientY }
      if (Math.hypot(mouse.x - current.current.x, mouse.y - current.current.y) < 160) touch()
    }
    const step = (): void => {
      const active = document.activeElement
      const typing = active instanceof HTMLElement && (active.isContentEditable || ['INPUT', 'TEXTAREA'].includes(active.tagName))
      if (!document.hidden && media?.matches !== true && !typing && origin.current === undefined && Date.now() - touched.current > 12000) {
        const next = clampPetPoint({ x: current.current.x + (Math.random() - 0.5) * 160,
          y: current.current.y + (Math.random() - 0.5) * 100 }, window.innerWidth, window.innerHeight)
        if (Math.hypot(mouse.x - next.x, mouse.y - next.y) > 160) {
          setWandering(true)
          current.current = next
          setPoint(next)
          settle = setTimeout(() => { setWandering(false); save(current.current) }, 3000)
        }
      }
      timer = setTimeout(step, 18000 + Math.random() * 15000)
    }
    timer = setTimeout(step, 18000)
    window.addEventListener('keydown', touch)
    window.addEventListener('pointerdown', touch)
    window.addEventListener('pointermove', pointerMoved)
    return () => {
      clearTimeout(timer); clearTimeout(settle)
      window.removeEventListener('keydown', touch)
      window.removeEventListener('pointerdown', touch)
      window.removeEventListener('pointermove', pointerMoved)
    }
  }, [wander])
  const below = point.y < (viewport.height - PET_CHARACTER_SIZE.height) / 2
  const style: CSSProperties = {
    left: point.x, top: point.y,
    transition: wandering ? 'left 3s ease-in-out, top 3s ease-in-out' : undefined,
    '--pet-panel-width': `${Math.min(300, Math.max(0, viewport.width - 16))}px`,
    '--pet-panel-left': `${Math.max(8 - point.x, Math.min(0, viewport.width - 308 - point.x))}px`,
    '--pet-panel-height': `${Math.max(0, below ? viewport.height - point.y - PET_CHARACTER_SIZE.height - 24 : point.y - 16)}px`,
  } as CSSProperties
  return { style, below, begin, track, drag }
}
