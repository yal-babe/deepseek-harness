// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PetMotion } from '../src/client/PetMotion.tsx'
import { PetSprite } from '../src/client/PetSprite.tsx'
import { idleDelay, lifeActions, mirrorsClip, nextChainClip, nextIdleClip, roamDelay, taskClip } from '../src/client/motion.ts'
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
  it('reserves play activities for entertainment and honors the device allowlist', () => {
    expect(lifeActions('idle')).toEqual(['stretch', 'yawn', 'daydream', 'observe', 'groom'])
    expect(lifeActions('play')).toEqual(['bubbles', 'celebrate', 'chaseBubbles', 'playBall', 'tailSpin'])
    expect(lifeActions('play', ['yawn', 'playBall'])).toEqual(['playBall'])
    expect(lifeActions('play', [])).toEqual([])
    expect(lifeActions('rest')).toEqual([])
  })

  it('plays different autonomous clips in idle and entertainment', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const withPlay = { ...motion, clips: { ...motion.clips, play_ball: clip('play_ball') } }
    const props = { motion: withPlay, state: 'IDLE' as const, dragging: false, paused: false, onFailure: vi.fn() }
    const view = render(<PetMotion {...props} preferences={{ ...preferences, life: 'idle' }} />)
    act(() => { vi.advanceTimersByTime(8000) })
    expect(view.container.querySelector('video')!.getAttribute('src')).toBe('/idle_stretch.webm')
    fireEvent.ended(view.container.querySelector('video')!)
    view.rerender(<PetMotion {...props} preferences={{ ...preferences, life: 'play', actions: ['playBall'] }} />)
    act(() => { vi.advanceTimersByTime(6000) })
    expect(view.container.querySelector('video')!.getAttribute('src')).toBe('/play_ball.webm')
  })

  it('uses distinct rest intervals and does not repeat the last idle action', () => {
    expect(idleDelay('quiet', 0)).toBe(20000)
    expect(idleDelay('lively', 1)).toBe(7000)
    expect(nextIdleClip('idle_stretch', 0)).not.toBe('idle_stretch')
    expect(taskClip('WORKING', 'search')).toBe('working_search')
    expect(taskClip('WORKING', 'test')).toBe('working_command')
  })

  it('rests after the idle clip ends and immediately returns to a new task', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const props = { motion, state: 'IDLE' as const, dragging: false, preferences: { ...preferences, actions: ['stretch', 'yawn'] as const }, paused: false, onFailure: vi.fn() }
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

  it('keeps a deliberate menu choice until landing completes', () => {
    const props = { motion, state: 'IDLE' as const, dragging: true, preferences, paused: false, onFailure: vi.fn() }
    const view = render(<PetMotion {...props} />)
    view.rerender(<PetMotion {...props} dragging={false} />)
    const action = { action: 'headPat' as const, serial: 1, interrupt: true }
    view.rerender(<PetMotion {...props} dragging={false} action={action} />)
    expect(view.container.querySelector('video')!.getAttribute('src')).toBe('/dragging_release.webm')
    fireEvent.ended(view.container.querySelector('video')!)
    expect(view.container.querySelector('video')!.getAttribute('src')).toBe('/head_pat.webm')
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
    fireEvent.load(view.container.querySelector('img')!)
    act(() => { vi.advanceTimersByTime(1000); vi.advanceTimersToNextFrame() })
    expect(onEnd).toHaveBeenCalledOnce()
    act(() => { vi.advanceTimersByTime(5000) })
    expect(onEnd).toHaveBeenCalledOnce()
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

it('uses only available actions and permits an empty autonomous list', () => {
  expect(nextIdleClip('bubbles', 0, ['bubbles'])).toBe('bubbles')
  expect(nextIdleClip(undefined, 0, [])).toBeUndefined()
  expect(roamDelay('lively', 0)).toBe(8000)
  expect(roamDelay('quiet', 1)).toBe(90000)
  const view = render(<PetMotion motion={motion} state="IDLE" dragging={false}
    preferences={{ ...preferences, actions: [] }} paused={false} onFailure={vi.fn()} />)
  act(() => { vi.advanceTimersByTime(120000) })
  expect(view.container.querySelector('video')?.getAttribute('src')).toBe('/idle.webm')
  view.unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it('holds a resting pose until work starts and resumes rest after work', () => {
  const sleeping = { ...motion, clips: { ...motion.clips, sleep: { url: '/sleep.png', durationMs: 3200,
    loop: false, sheet: { columns: 4, rows: 2, frames: 8 } } } }
  const props = { motion: sleeping, state: 'IDLE' as const, dragging: false,
    preferences: { ...preferences, life: 'rest' as const }, paused: false, onFailure: vi.fn() }
  const view = render(<PetMotion {...props} />)
  const pose = view.container.querySelector<HTMLElement>('[data-pet-sprite]')!
  const position = pose.style.backgroundPosition
  act(() => { vi.advanceTimersByTime(120000) })
  expect(pose.style.backgroundPosition).toBe(position)
  expect(vi.getTimerCount()).toBe(0)
  view.rerender(<PetMotion {...props} state="WORKING" />)
  expect(view.container.querySelector('video')?.getAttribute('src')).toBe('/working.webm')
  view.rerender(<PetMotion {...props} />)
  expect(view.container.querySelector('[data-pet-sprite]')).toBeTruthy()
})

it('uses a continuous animation with bubbles instead of playing the eight-pose sheet', () => {
  const lowFrame = { ...motion, clips: { ...motion.clips,
    bubbles: { url: '/bubbles.png', durationMs: 3200, loop: false, sheet: { columns: 4, rows: 2, frames: 8 } },
  } }
  const view = render(<PetMotion motion={lowFrame} state="IDLE" dragging={false} preferences={preferences}
    paused={false} action={{ action: 'bubbles', serial: 1 }} onFailure={vi.fn()} />)
  expect(view.container.querySelector('video')?.getAttribute('src')).toBe('/idle.webm')
  expect(view.container.querySelector('[data-pet-sprite]')).toBeNull()
  expect(view.container.querySelector('[data-effect="bubbles"]')).toBeTruthy()
})


it('rotates thinking variants without repeating the current clip and yields to tool work', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0)
  const variants = { ...motion, clips: { ...motion.clips,
    thinking_chin: clip('thinking_chin'), thinking_idea: clip('thinking_idea'), work_read: clip('work_read'),
  } }
  const props = { motion: variants, state: 'THINKING' as const, dragging: false, preferences, paused: false, onFailure: vi.fn() }
  const view = render(<PetMotion {...props} />)
  const source = () => view.container.querySelector('video')!.getAttribute('src')
  expect(source()).toBe('/thinking_chin.webm')
  fireEvent.ended(view.container.querySelector('video')!)
  expect(source()).toBe('/thinking.webm')
  expect(view.container.querySelector('video')!.loop).toBe(false)
  view.rerender(<PetMotion {...props} state="WORKING" activity="search" />)
  expect(source()).toBe('/working_search.webm')
})


it('keeps the left-facing swim artwork aligned with travel direction', () => {
  const travel = { ...motion, clips: { ...motion.clips,
    swim_start: clip('swim_start'), swim_loop: clip('swim_loop', true), swim_stop: clip('swim_stop'),
  } }
  const props = { motion: travel, state: 'IDLE' as const, dragging: false, preferences, paused: false, onFailure: vi.fn() }
  const view = render(<PetMotion {...props} movement={{ moving: true, direction: 'left' }} />)
  const visual = () => view.container.querySelector<HTMLElement>('[data-pet-clip]')!
  expect(visual().style.transform).toBe('')
  view.rerender(<PetMotion {...props} movement={{ moving: true, direction: 'right' }} />)
  expect(visual().style.transform).toBe('scaleX(-1)')
  fireEvent.ended(view.container.querySelector('video')!)
  expect(visual().dataset.petClip).toBe('swim_loop')
  expect(visual().style.transform).toBe('scaleX(-1)')
})

describe('categorized animation chain', () => {
  const label = { zh: '甲', en: 'A' }
  const categorized: PetMotionView = {
    ...motion,
    clips: { ...motion.clips, look_around: { ...clip('look_around'), turn: true }, play_ball: clip('play_ball'), sign: { ...clip('sign'), mirror: false } },
    categories: [
      { id: 'small', label, weight: 20, life: ['idle'], clips: ['idle_stretch', 'look_around', 'missing'] },
      { id: 'text', label, weight: 10, life: ['idle'], clips: ['sign'] },
      { id: 'play', label, weight: 20, life: ['play'], clips: ['play_ball'] },
      { id: 'interact', label, weight: 0, life: [], clips: ['head_pat'] },
    ],
  }
  const sequence = (...values: number[]) => () => values.shift() ?? 0

  it('picks a category by weight, then a fresh available clip, honoring the allowlist', () => {
    expect(nextChainClip(categorized, 'idle', undefined, undefined, sequence(0, 0))).toBe('idle_stretch')
    expect(nextChainClip(categorized, 'idle', undefined, 'idle_stretch', sequence(0, 0))).toBe('look_around')
    expect(nextChainClip(categorized, 'idle', undefined, undefined, sequence(0.7, 0))).toBe('sign')
    expect(nextChainClip(categorized, 'idle', [], undefined, sequence(0, 0))).toBe('look_around')
    expect(nextChainClip(categorized, 'play', undefined, undefined, sequence(0.99, 0))).toBe('play_ball')
    expect(nextChainClip(categorized, 'play', ['stretch'], undefined, sequence(0, 0))).toBeUndefined()
    expect(nextChainClip(categorized, 'rest', undefined, undefined, sequence(0, 0))).toBeUndefined()
    expect(nextChainClip(motion, 'idle', ['yawn'], undefined, sequence(0))).toBe('idle_yawn')
  })

  it('keeps the facing a turn clip ends on, except for unmirrorable clips', () => {
    expect(mirrorsClip(categorized, 'idle', true)).toBe(true)
    expect(mirrorsClip(categorized, 'sign', true)).toBe(false)
    expect(mirrorsClip(categorized, 'swim_loop', true)).toBe(false)
    expect(mirrorsClip(categorized, 'idle', false)).toBe(false)
    const props = { motion: categorized, state: 'IDLE' as const, dragging: false, preferences, paused: false, onFailure: vi.fn() }
    const view = render(<PetMotion {...props} action={{ clip: 'look_around', serial: 1 }} />)
    const content = () => view.container.querySelector<HTMLElement>('[data-pet-clip]')!
    expect(content().dataset.petClip).toBe('look_around')
    expect(content().style.transform).toBe('')
    fireEvent.ended(view.container.querySelector('video')!)
    expect(content().dataset.petClip).toBe('idle')
    expect(content().dataset.petFacing).toBe('right')
    expect(content().style.transform).toBe('scaleX(-1)')
    view.rerender(<PetMotion {...props} action={{ clip: 'look_around', serial: 2, interrupt: true }} />)
    expect(content().dataset.petClip).toBe('look_around')
    expect(content().style.transform).toBe('scaleX(-1)')
    fireEvent.ended(view.container.querySelector('video')!)
    expect(content().dataset.petFacing).toBe('left')
    view.rerender(<PetMotion {...props} action={{ clip: 'head_pat', serial: 3, interrupt: true }} />)
    expect(content().dataset.petClip).toBe('head_pat')
    fireEvent.ended(view.container.querySelector('video')!)
    expect(content().dataset.petFacing).toBe('left')
  })
})
