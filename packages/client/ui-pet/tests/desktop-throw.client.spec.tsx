// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { PetController } from '../src/client/controller.ts'
import { PetPreferenceStore } from '../src/client/preferences.ts'
import { petDesktopGeometry, type DesktopPetBridge } from '../src/client/surface.ts'
import { PET_BODY_ATTRIBUTE, useDesktopThrow } from '../src/client/useDesktopThrow.ts'
import { S2 } from './fixtures.ts'

const FAKE = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] as const
const area = { x: 0, y: 0, width: 1920, height: 1040 }
const panel = { x: 0, y: 0, width: 1920, height: 1080 }
const GEOMETRY = { window: { x: 1000, y: 400, width: 340, height: 560 }, areas: [area], panels: [panel] }

function bench(partial: Partial<DesktopPetBridge> = {}) {
  let geometry: ((value: unknown) => void) | undefined
  const bridge = {
    protocolVersion: 1, role: 'pet', setInteractive: vi.fn(), setVisible: vi.fn(), openMain: vi.fn(),
    onOpenSession: () => () => {}, onQuickAsk: () => () => {}, onVisibleRequest: () => () => {},
    drag: vi.fn(), place: vi.fn(), body: vi.fn(), reveal: vi.fn(),
    onGeometry: vi.fn((listener: (value: unknown) => void) => { geometry = listener; return () => { geometry = undefined } }),
    ...partial,
  } as DesktopPetBridge & { drag: ReturnType<typeof vi.fn>; place: ReturnType<typeof vi.fn>; body: ReturnType<typeof vi.fn> }
  const controller = new PetController({
    view: createSnapshotStore({ snapshot: undefined, connected: true }, { flush: 'sync' }),
    sessionStatus: createSnapshotStore(new Map(), { flush: 'sync' }),
    quickAsk: {
      createSession: vi.fn(async () => ({ ok: true as const, value: { sessionId: S2 } })), upload: vi.fn(),
      prompt: vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } })), requestId: () => brandString<SessionRequestId>('r'),
    },
    setVisible: vi.fn(async () => {}), acknowledge: vi.fn(async () => {}), bridge, openSession: vi.fn(),
    preferences: new PetPreferenceStore(undefined), notifications: undefined, now: () => 0,
  })
  return { bridge, controller, emit: (value: unknown) => { geometry?.(value) } }
}

let body: HTMLElement
beforeEach(() => {
  vi.useFakeTimers({ toFake: [...FAKE] })
  body = document.createElement('span')
  body.setAttribute(PET_BODY_ATTRIBUTE, '')
  body.getBoundingClientRect = () => ({ left: 164, top: 412, width: 168, height: 140 }) as DOMRect
  document.body.append(body)
})
afterEach(() => { cleanup(); body.remove(); vi.useRealTimers() })

function fling(result: { current: ReturnType<typeof useDesktopThrow> }, dx: number, dy: number): void {
  act(() => { result.current.drag('start') })
  for (let step = 0; step <= 6; step++) {
    act(() => {
      vi.advanceTimersByTime(16)
      result.current.track({ screenX: 1200 + step * dx, screenY: 900 + step * dy, clientX: 200, clientY: 500 })
      result.current.drag('move')
    })
  }
  act(() => { result.current.drag('end') })
}

describe('Desktop throws', () => {
  it('reports the measured body, then throws a fling from the window origin until it lands on the work area floor', () => {
    const { bridge, controller, emit } = bench()
    const { result, unmount } = renderHook(() => useDesktopThrow(controller, true, 100))
    act(() => { vi.advanceTimersByTime(16) })
    expect(bridge.body).toHaveBeenCalledWith({ x: 164, y: 412, width: 168, height: 140 })
    emit(GEOMETRY)
    fling(result, 40, -30)
    expect(bridge.drag).toHaveBeenLastCalledWith('end', { thrown: true })
    expect(result.current.flying).toBe(true)
    act(() => { vi.advanceTimersByTime(30000) })
    expect(result.current.flying).toBe(false)
    const calls = bridge.place.mock.calls
    expect(calls.length).toBeGreaterThan(5)
    // The first step starts near the release origin (screen pointer minus client pointer).
    expect(Math.abs(calls[0]![0].x - (1200 + 6 * 40 - 200))).toBeLessThan(100)
    expect(calls.slice(0, -1).every(call => call[1] === false)).toBe(true)
    expect(calls.at(-1)).toEqual([{ x: expect.any(Number), y: 1040 - 412 - 140 }, true])
    act(() => { vi.advanceTimersByTime(0) })
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ends a slow drag, or any drag without geometry or with throwing off, through the main process', () => {
    const off = bench()
    const disabled = renderHook(() => useDesktopThrow(off.controller, false, 100))
    off.emit(GEOMETRY)
    fling(disabled.result, 40, 0)
    expect(off.bridge.drag).toHaveBeenLastCalledWith('end')
    const none = bench()
    const blind = renderHook(() => useDesktopThrow(none.controller, true, 100))
    fling(blind.result, 40, 0)
    expect(none.bridge.drag).toHaveBeenLastCalledWith('end')
    const slow = bench()
    const gentle = renderHook(() => useDesktopThrow(slow.controller, true, 100))
    slow.emit(GEOMETRY)
    fling(gentle.result, 1, 0)
    expect(slow.bridge.drag).toHaveBeenLastCalledWith('end')
    expect(slow.bridge.place).not.toHaveBeenCalled()
  })

  it('catches the character mid-air without settling, and settles when the window hides or unmounts', () => {
    const { bridge, controller, emit } = bench()
    const { result, unmount } = renderHook(() => useDesktopThrow(controller, true, 100))
    emit(GEOMETRY)
    fling(result, 0, -60)
    act(() => { vi.advanceTimersByTime(50) })
    act(() => { result.current.drag('start') })
    expect(result.current.flying).toBe(false)
    expect(bridge.place.mock.calls.every(call => call[1] === false)).toBe(true)
    expect(bridge.drag).toHaveBeenLastCalledWith('start')
    act(() => { result.current.drag('end') })
    fling(result, 0, -60)
    act(() => { vi.advanceTimersByTime(50) })
    unmount()
    expect(bridge.place).toHaveBeenLastCalledWith(expect.anything(), true)
  })

  it('checks walking room inside the work area that holds the body', () => {
    const { controller, emit } = bench()
    const { result } = renderHook(() => useDesktopThrow(controller, true, 100))
    expect(result.current.room('left', 10)).toBe(false)
    act(() => { vi.advanceTimersByTime(16) })
    emit(GEOMETRY)
    // Body spans 1164–1332 on a 1920-wide work area.
    expect(result.current.room('left', 1164)).toBe(true)
    expect(result.current.room('left', 1165)).toBe(false)
    expect(result.current.room('right', 588)).toBe(true)
    expect(result.current.room('right', 589)).toBe(false)
    emit({ ...GEOMETRY, window: { ...GEOMETRY.window, x: 5000 } })
    expect(result.current.room('right', 1)).toBe(false)
  })

  it('needs a bridge that can place the window', () => {
    expect(bench().controller.canThrow).toBe(true)
    expect(bench({ place: undefined }).controller.canThrow).toBe(false)
    expect(bench({ onGeometry: undefined }).controller.canThrow).toBe(false)
    expect(bench().controller.canWalk).toBe(false)
    const walker = bench({ travel: vi.fn() })
    expect(walker.controller.canWalk).toBe(true)
    walker.controller.travel(3, false)
    expect(walker.bridge.travel).toHaveBeenCalledWith(3, false)
  })
})

describe('Desktop geometry', () => {
  it('accepts finite rectangles with at least one display and falls back to areas for mismatched panels', () => {
    expect(petDesktopGeometry(GEOMETRY)).toEqual(GEOMETRY)
    expect(petDesktopGeometry({ ...GEOMETRY, panels: [] })).toEqual({ ...GEOMETRY, panels: [area] })
    for (const bad of [null, 1, { ...GEOMETRY, areas: [] }, { ...GEOMETRY, window: { x: 0 } },
      { ...GEOMETRY, areas: [{ ...area, width: Infinity }] }, { ...GEOMETRY, panels: [{ ...panel, height: -1 }] }]) {
      expect(petDesktopGeometry(bad)).toBeUndefined()
    }
  })

  it('drops malformed geometry before it reaches a listener', () => {
    const { controller, emit } = bench()
    const listener = vi.fn()
    const stop = controller.onGeometry(listener)
    emit({ nope: true })
    emit(GEOMETRY)
    expect(listener).toHaveBeenCalledExactlyOnceWith(GEOMETRY)
    stop()
    expect(new PetController({ ...{} as never, bridge: undefined } as never).onGeometry(listener)).toBeTypeOf('function')
  })
})
