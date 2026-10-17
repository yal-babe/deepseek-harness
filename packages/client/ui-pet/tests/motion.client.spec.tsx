// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PetMotion } from '../src/client/PetMotion.tsx'
import { PetSprite } from '../src/client/PetSprite.tsx'
import { idleDelay, nextIdleClip, taskClip } from '../src/client/motion.ts'
import type { PetMotionView } from '@deepseek-ai/dsh-pet/types'

const clip = (name: string, loop = false) => ({ url: `/${name}.webm`, durationMs: 1000, loop })
const motion: PetMotionView = { width: 206, height: 172, clips: Object.fromEntries([
  'idle', 'thinking', 'working', 'working_search', 'working_command', 'waiting', 'success', 'error',
  'dragging', 'dragging_release', 'head_pat', 'idle_stretch', 'idle_yawn', 'eat_token',
].map(name => [name, clip(name, ['idle', 'thinking', 'working', 'dragging'].includes(name))])) }
const preferences = { notify: false, snoozeUntil: undefined }
beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('motion scheduling', () => {
  it('uses distinct rest intervals and does not repeat the last idle action', () => {
    expect(idleDelay('quiet', 0)).toBe(45000)
    expect(idleDelay('lively', 1)).toBe(22000)
    expect(nextIdleClip('idle_stretch', 0)).not.toBe('idle_stretch')
    expect(taskClip('WORKING', 'search')).toBe('working_search')
    expect(taskClip('WORKING', 'test')).toBe('working_command')
  })

  it('rests after the idle clip ends and immediately returns to a new task', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const props = { motion, state: 'IDLE' as const, dragging: false, preferences, paused: false, onFailure: vi.fn() }
    const view = render(<PetMotion {...props} />)
    const source = () => view.container.querySelector('video')!.getAttribute('src')
    expect(source()).toBe('/idle.webm')
    act(() => { vi.advanceTimersByTime(25000) })
    expect(source()).toBe('/idle_stretch.webm')
    act(() => { vi.advanceTimersByTime(50000) })
    expect(source()).toBe('/idle_stretch.webm')
    fireEvent.ended(view.container.querySelector('video')!)
    expect(source()).toBe('/idle.webm')
    act(() => { vi.advanceTimersByTime(25000) })
    expect(source()).not.toBe('/idle_stretch.webm')
    view.rerender(<PetMotion {...props} state="WORKING" />)
    expect(source()).toBe('/working.webm')
  })

  it('lets dragging and landing finish before showing the latest task', () => {
    const props = { motion, state: 'THINKING' as const, dragging: true, preferences, paused: false, onFailure: vi.fn() }
    const view = render(<PetMotion {...props} />)
    expect(view.container.querySelector('video')!.getAttribute('src')).toBe('/dragging.webm')
    view.rerender(<PetMotion {...props} dragging={false} state="WORKING" />)
    expect(view.container.querySelector('video')!.getAttribute('src')).toBe('/dragging_release.webm')
    view.rerender(<PetMotion {...props} dragging={false} state="WAITING" />)
    expect(view.container.querySelector('video')!.getAttribute('src')).toBe('/dragging_release.webm')
    fireEvent.ended(view.container.querySelector('video')!)
    expect(view.container.querySelector('video')!.getAttribute('src')).toBe('/waiting.webm')
  })

  it('ignores decorations during work, pauses for reduced motion and contains media failures', () => {
    const failure = vi.fn()
    const props = { motion, state: 'WORKING' as const, dragging: false, preferences, paused: false, onFailure: failure }
    const view = render(<PetMotion {...props} action={{ action: 'headPat', serial: 1 }} />)
    expect(view.container.querySelector('video')!.getAttribute('src')).toBe('/working.webm')
    view.rerender(<PetMotion {...props} preferences={{ ...preferences, reducedMotion: true }} />)
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
    fireEvent.error(view.container.querySelector('video')!)
    expect(failure).toHaveBeenCalledOnce()
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('plays sprite poses once and releases its timer on unmount', () => {
    const onEnd = vi.fn()
    const sheet = { ...clip('bubbles'), sheet: { columns: 4, rows: 2, frames: 8 } }
    const view = render(<PetSprite clip={sheet} sheet={sheet.sheet} paused={false} onEnd={onEnd} onFailure={vi.fn()} />)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(onEnd).toHaveBeenCalledOnce()
    act(() => { vi.advanceTimersByTime(5000) })
    expect(onEnd).toHaveBeenCalledOnce()
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
