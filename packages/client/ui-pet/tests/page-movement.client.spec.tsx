// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePagePosition } from '../src/client/usePagePosition.ts'

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  vi.spyOn(Math, 'random').mockReturnValue(0)
})
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.useRealTimers() })

it('moves more often when lively, keeps intermediate positions, and cancels on interaction', () => {
  const { result, rerender, unmount } = renderHook(({ wander, size }) => usePagePosition(wander, size, 'lively'), {
    initialProps: { wander: true, size: 100 },
  })
  const start = Number(result.current.style.left)
  act(() => { vi.advanceTimersByTime(8000) })
  expect(result.current.wandering).toBe(true)
  act(() => { vi.advanceTimersByTime(1500) })
  const middle = Number(result.current.style.left)
  expect(middle).toBeLessThan(start)
  expect(middle).toBeGreaterThan(start - 120)
  rerender({ wander: false, size: 100 })
  act(() => { vi.advanceTimersByTime(20000) })
  expect(result.current.style.left).toBe(middle)
  expect(result.current.wandering).toBe(false)
  act(() => { vi.advanceTimersByTime(0) })
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it('reclamps a resized pet and does not accumulate movement while hidden', () => {
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  const { result, rerender, unmount } = renderHook(({ size }) => usePagePosition(true, size, 'lively'), {
    initialProps: { size: 100 },
  })
  const start = result.current.style.left
  act(() => { vi.advanceTimersByTime(60000) })
  expect(result.current.style.left).toBe(start)
  hidden.mockReturnValue(false)
  rerender({ size: 200 })
  expect(Number(result.current.style.left)).toBeLessThanOrEqual(innerWidth - 224 - 8)
  expect(Number(result.current.style.top)).toBeLessThanOrEqual(innerHeight - 284 - 8)
  act(() => { vi.advanceTimersByTime(0) })
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})

describe('drag physics', () => {
  const FAKE = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] as const
  beforeEach(() => { vi.useRealTimers(); vi.useFakeTimers({ toFake: [...FAKE] }) })

  function grab(result: { current: ReturnType<typeof usePagePosition> }, x: number, y: number): void {
    act(() => { result.current.begin(x, y); result.current.drag('start') })
  }

  it('follows the pointer on a spring and puts the character down where it was released slowly', () => {
    const { result, unmount } = renderHook(() => usePagePosition(false, 100, 'normal', true))
    const start = { x: Number(result.current.style.left), y: Number(result.current.style.top) }
    grab(result, 500, 400)
    act(() => { result.current.track(400, 300); result.current.drag('move'); vi.advanceTimersByTime(16) })
    // The spring lags behind the pointer on the first frame.
    expect(Number(result.current.style.left)).toBeGreaterThan(start.x - 100)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(Number(result.current.style.left)).toBeCloseTo(start.x - 100, 0)
    act(() => { vi.advanceTimersByTime(400); result.current.drag('end') })
    expect(result.current.flying).toBe(false)
    expect(JSON.parse(localStorage.getItem('dsh-pet:page-position')!)).toEqual({ x: start.x - 100, y: start.y - 100 })
    act(() => { vi.advanceTimersByTime(0) })
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('throws a flung character, which lands on the viewport floor and is saved there', () => {
    const { result, unmount } = renderHook(() => usePagePosition(false, 100, 'normal', true))
    grab(result, 500, 400)
    for (let step = 1; step <= 6; step++) {
      act(() => { vi.advanceTimersByTime(16); result.current.track(500 - step * 40, 400 - step * 30); result.current.drag('move') })
    }
    act(() => { result.current.drag('end') })
    expect(result.current.flying).toBe(true)
    act(() => { vi.advanceTimersByTime(20000) })
    expect(result.current.flying).toBe(false)
    const floor = innerHeight - 142 - 8
    expect(Number(result.current.style.top)).toBe(floor)
    expect(JSON.parse(localStorage.getItem('dsh-pet:page-position')!)).toMatchObject({ y: floor })
    act(() => { vi.advanceTimersByTime(0) })
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('catches a character in the air, and moves directly without physics', () => {
    const { result, rerender, unmount } = renderHook(({ throwing }) => usePagePosition(false, 100, 'normal', throwing), {
      initialProps: { throwing: true },
    })
    grab(result, 500, 400)
    for (let step = 1; step <= 6; step++) {
      act(() => { vi.advanceTimersByTime(16); result.current.track(500, 400 - step * 50); result.current.drag('move') })
    }
    act(() => { result.current.drag('end'); vi.advanceTimersByTime(48) })
    expect(result.current.flying).toBe(true)
    act(() => { result.current.begin(10, 10) })
    expect(result.current.flying).toBe(false)
    const caught = result.current.style.top
    act(() => { vi.advanceTimersByTime(1000) })
    expect(result.current.style.top).toBe(caught)
    rerender({ throwing: false })
    const left = Number(result.current.style.left)
    grab(result, 300, 300)
    act(() => { result.current.track(250, 300); result.current.drag('move') })
    expect(Number(result.current.style.left)).toBe(left - 50)
    act(() => { result.current.track(150, 300); vi.advanceTimersByTime(16); result.current.drag('end') })
    expect(result.current.flying).toBe(false)
    act(() => { vi.advanceTimersByTime(0) })
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
