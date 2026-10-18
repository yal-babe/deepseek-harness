// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PetMotionView } from '@deepseek-ai/dsh-pet/types'
import { PetSprite } from '../src/client/PetSprite.tsx'
import { useMotionPhases } from '../src/client/useMotionPhases.ts'

const motion: PetMotionView = { width: 208, height: 208, clips: Object.fromEntries([
  'swim_start', 'swim_loop', 'swim_stop', 'pillow_enter', 'pillow_loop', 'pillow_wake',
].map(name => [name, { url: `/${name}.png`, durationMs: 1000, loop: name.endsWith('_loop') }])) }
const options = { moving: false, resting: false, idle: true, reduced: false }
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('persistent motion phases', () => {
  it('enters sleep, holds its loop and wakes only after rest is disabled', () => {
    const view = renderHook(props => useMotionPhases(motion, props), { initialProps: { ...options, resting: true } })
    expect(view.result.current.clip).toBe('pillow_enter')
    act(() => { view.result.current.finish('pillow_enter') })
    expect(view.result.current.clip).toBe('pillow_loop')
    act(() => { vi.advanceTimersByTime(120000) })
    expect(view.result.current.clip).toBe('pillow_loop')
    view.rerender(options)
    expect(view.result.current.clip).toBe('pillow_wake')
    act(() => { view.result.current.finish('pillow_wake') })
    expect(view.result.current.clip).toBeUndefined()
  })

  it('swims while moving, decelerates on arrival and yields immediately to work', () => {
    const view = renderHook(props => useMotionPhases(motion, props), { initialProps: options })
    view.rerender({ ...options, moving: true })
    expect(view.result.current.clip).toBe('swim_start')
    act(() => { view.result.current.finish('swim_start') })
    expect(view.result.current.clip).toBe('swim_loop')
    view.rerender(options)
    expect(view.result.current.clip).toBe('swim_stop')
    view.rerender({ ...options, idle: false })
    expect(view.result.current.clip).toBeUndefined()
    view.rerender({ ...options, resting: true })
    expect(view.result.current.clip).toBe('pillow_enter')
    view.rerender({ ...options, resting: true, reduced: true })
    expect(view.result.current.clip).toBe('pillow_loop')
  })
})

it('waits for image decoding, plays at 24 fps, offsets segments and preserves active time across pauses', () => {
  const sheet = { columns: 8, rows: 6, frames: 24, startFrame: 24 }
  const clip = { url: '/thoughts.png', durationMs: 1000, loop: false, sheet }
  const props = { clip, sheet, paused: false, poster: '/poster.png', onEnd: vi.fn(), onFailure: vi.fn() }
  const view = render(<PetSprite {...props} />)
  const sprite = () => view.container.querySelector<HTMLElement>('[data-pet-sprite]')!
  expect(sprite().style.backgroundImage).toContain('poster.png')
  act(() => { vi.advanceTimersByTime(5000) })
  expect(props.onEnd).not.toHaveBeenCalled()
  expect(sprite().dataset.petFrame).toBe('24')
  fireEvent.load(view.container.querySelector('img')!)
  act(() => { vi.advanceTimersByTime(256) })
  expect(Number(sprite().dataset.petFrame)).toBeGreaterThanOrEqual(29)
  expect(Number(sprite().dataset.petFrame)).toBeLessThanOrEqual(30)
  const beforePause = sprite().dataset.petFrame
  view.rerender(<PetSprite {...props} paused />)
  act(() => { vi.advanceTimersByTime(10000) })
  expect(sprite().dataset.petFrame).toBe(beforePause)
  view.rerender(<PetSprite {...props} />)
  act(() => { vi.advanceTimersByTime(256) })
  expect(Number(sprite().dataset.petFrame)).toBeGreaterThanOrEqual(35)
  expect(Number(sprite().dataset.petFrame)).toBeLessThanOrEqual(36)
  act(() => { vi.advanceTimersByTime(512) })
  expect(props.onEnd).toHaveBeenCalledOnce()
  expect(sprite().dataset.petFrame).toBe('47')
  view.unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it('loops inside its declared segment instead of playing entry or exit cells', () => {
  const sheet = { columns: 8, rows: 7, frames: 24, startFrame: 16 }
  const clip = { url: '/sleep.png', durationMs: 1000, loop: true, sheet }
  const onEnd = vi.fn()
  const view = render(<PetSprite clip={clip} sheet={sheet} paused={false} loop knownReady onEnd={onEnd} onFailure={vi.fn()} />)
  act(() => { vi.advanceTimersByTime(2512) })
  const index = Number(view.container.querySelector<HTMLElement>('[data-pet-sprite]')!.dataset.petFrame)
  expect(index).toBeGreaterThanOrEqual(16)
  expect(index).toBeLessThan(40)
  expect(onEnd).not.toHaveBeenCalled()
  const distinct = new Set<number>()
  for (let tick = 0; tick < 64; tick++) {
    act(() => { vi.advanceTimersToNextFrame() })
    distinct.add(Number(view.container.querySelector<HTMLElement>('[data-pet-sprite]')!.dataset.petFrame))
  }
  expect(distinct.size).toBe(24)
  view.unmount()
  expect(vi.getTimerCount()).toBe(0)
})
