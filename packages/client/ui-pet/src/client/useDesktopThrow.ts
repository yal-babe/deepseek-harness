/**
 * Desktop pet-window throws and walking room. The main process moves the
 * window during a drag; on a fast release the renderer steps the shared
 * physics over the displays' work areas and asks the main process for each
 * window origin, which it throttles, clamps, and saves when the flight ends.
 * The same geometry tells whether a walking clip has room ahead.
 */
import { useEffect, useRef, useState } from 'react'
import type { PetController } from './controller.ts'
import { estimateReleaseVelocity, throwSpace, throwStep, trimTrail, type PetDragSample, type PetThrowState } from './physics.ts'
import type { PetDesktopGeometry, PetDesktopRect, PetDragPhase } from './surface.ts'

/** Attribute that marks the element whose box is the character body. */
export const PET_BODY_ATTRIBUTE = 'data-pet-body'

/** Pointer fields read while dragging. */
export interface PetThrowPointer {
  readonly screenX: number
  readonly screenY: number
  readonly clientX: number
  readonly clientY: number
}

function measureBody(): PetDesktopRect | undefined {
  const element = document.querySelector(`[${PET_BODY_ATTRIBUTE}]`)
  if (element === null) return undefined
  const { left, top, width, height } = element.getBoundingClientRect()
  return width > 0 && height > 0 ? { x: left, y: top, width, height } : undefined
}

/**
 * Drag reporting with throws for the Desktop pet window.
 * @param controller - pet controller with the Desktop bridge.
 * @param enabled - whether throwing is on (preference, reduced motion) and the bridge supports it.
 * @param size - character size in percent; the body is re-measured when it changes.
 * @returns a pointer tracker for drag samples, the drag reporter, whether the character is in the air, and a walking room check.
 */
export function useDesktopThrow(controller: PetController, enabled: boolean, size: number): {
  track: (pointer: PetThrowPointer) => void
  drag: (phase: PetDragPhase) => void
  flying: boolean
  /**
   * Whether the body can travel a distance inside the work area that holds it, from the last reported window position.
   * @param direction - on-screen direction.
   * @param px - distance in DIP.
   */
  room: (direction: 'left' | 'right', px: number) => boolean
} {
  const geometry = useRef<PetDesktopGeometry | undefined>(undefined)
  const body = useRef<PetDesktopRect | undefined>(undefined)
  const trail = useRef<readonly PetDragSample[]>([])
  const origin = useRef<{ x: number; y: number } | undefined>(undefined)
  const dragging = useRef(false)
  const frame = useRef<number | undefined>(undefined)
  const state = useRef<PetThrowState | undefined>(undefined)
  const [flying, setFlying] = useState(false)
  const stop = (settle: boolean): void => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    frame.current = undefined
    const last = state.current
    state.current = undefined
    if (last !== undefined) {
      setFlying(false)
      if (settle) controller.place({ x: last.x, y: last.y }, true)
    }
  }
  useEffect(() => controller.onGeometry((value) => { geometry.current = value }), [controller])
  useEffect(() => {
    let timer: number | undefined
    const report = (): void => {
      if (timer !== undefined) return
      timer = requestAnimationFrame(() => {
        timer = undefined
        const measured = measureBody()
        if (measured === undefined) return
        body.current = measured
        controller.reportBody(measured)
      })
    }
    const element = document.querySelector(`[${PET_BODY_ATTRIBUTE}]`)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(report)
    if (element !== null) observer?.observe(element)
    window.addEventListener('resize', report)
    report()
    return () => {
      if (timer !== undefined) cancelAnimationFrame(timer)
      observer?.disconnect()
      window.removeEventListener('resize', report)
    }
  }, [controller, size])
  useEffect(() => {
    const hidden = (): void => { if (document.hidden) stop(true) }
    document.addEventListener('visibilitychange', hidden)
    return () => { document.removeEventListener('visibilitychange', hidden); stop(true) }
  }, [controller])
  const fly = (start: PetThrowState, space: ReturnType<typeof throwSpace>): void => {
    state.current = start
    setFlying(true)
    let last = performance.now()
    const tick = (now: number): void => {
      const current = state.current
      if (current === undefined) return
      const next = throwStep(current, (now - last) / 1000, space)
      last = now
      state.current = next
      controller.place({ x: next.x, y: next.y }, next.atRest)
      if (next.atRest) { state.current = undefined; frame.current = undefined; setFlying(false); return }
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
  }
  return {
    flying,
    room: (direction, px) => {
      const space = geometry.current
      const box = body.current
      if (space === undefined || box === undefined) return false
      const left = space.window.x + box.x
      const cx = left + box.width / 2
      const cy = space.window.y + box.y + box.height / 2
      const area = space.areas.find(rect => cx >= rect.x && cx < rect.x + rect.width && cy >= rect.y && cy < rect.y + rect.height)
      if (area === undefined) return false
      return direction === 'left' ? left - px >= area.x : left + box.width + px <= area.x + area.width
    },
    track: (pointer) => {
      if (!dragging.current) return
      const now = performance.now()
      trail.current = trimTrail([...trail.current, { t: now, x: pointer.screenX, y: pointer.screenY }], now)
      origin.current = { x: pointer.screenX - pointer.clientX, y: pointer.screenY - pointer.clientY }
    },
    drag: (phase) => {
      if (phase === 'start') {
        // Catching the character mid-air hands it back to the main-process drag.
        stop(false)
        dragging.current = true
        trail.current = []
        origin.current = undefined
        const measured = measureBody()
        if (measured !== undefined) body.current = measured
        controller.drag('start')
        return
      }
      if (phase === 'move') { controller.drag('move'); return }
      dragging.current = false
      const space = geometry.current
      const from = origin.current
      const box = body.current
      const velocity = enabled && space !== undefined && from !== undefined && box !== undefined
        ? estimateReleaseVelocity(trail.current, performance.now()) : undefined
      trail.current = []
      if (velocity === undefined || space === undefined || from === undefined || box === undefined) { controller.drag('end'); return }
      controller.drag('end', true)
      fly({ ...from, ...velocity }, throwSpace(space.areas, box, space.panels))
    },
  }
}
