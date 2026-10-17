// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
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
