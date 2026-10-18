// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PetMotion } from '../src/client/PetMotion.tsx'
import { PetSprite } from '../src/client/PetSprite.tsx'
import {
  autonomousPackClips, balanceTier, clickArea, clickClip, clipAllowed, eventClip, idleDelay, lifeActions, mirrorsClip, nextAutonomousClip,
  nextChainClip, nextIdleClip, roamDelay, taskClip, travelAt, travelScale, walkDirection,
} from '../src/client/motion.ts'
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

describe('pack event tiers, click areas, and the pack clip allowlist', () => {
  const tiers = (...names: string[]) => names.map(name => [name])
  const pack: PetMotionView = {
    ...motion,
    clips: { ...motion.clips, poke: clip('poke'), click_bounce: clip('click_bounce'), click_huff: clip('click_huff'), tail: clip('tail'),
      balance_full: clip('balance_full'), balance_empty: clip('balance_empty'), sign: clip('sign'), look_around: { ...clip('look_around'), turn: true } },
    chain: { idle: 1, turn: 1, move: 1 },
    categories: [
      { id: 'small', label: { zh: '小', en: 'Small' }, weight: 1, life: ['idle'], clips: ['idle_stretch', 'sign', 'missing'] },
      { id: 'click', label: { zh: '点', en: 'Click' }, weight: 0, life: [], clips: ['click_bounce'] },
    ],
    events: {
      balance: [['balance_full'], ['missing', 'balance_full'], [], [], [], ['balance_empty']],
      workStatus: tiers('thinking', 'working', 'working_command', 'waiting', 'success', 'error'),
    },
    clicks: { head: ['head_pat'], body: ['poke', 'click_bounce', 'click_huff', 'ghost'] },
  }

  it('maps used percentages to six bands with the last only at exactly 100%', () => {
    expect([0, 19.9, 20, 59, 80, 99.9, 100, 140, -5, Number.NaN].map(balanceTier)).toEqual([0, 0, 1, 2, 4, 4, 5, 5, 0, 0])
  })

  it('picks event candidates the pack has and falls back to built-in task clips', () => {
    expect(eventClip(pack, 'balance', 1)).toBe('balance_full')
    expect(eventClip(pack, 'balance', 2)).toBeUndefined()
    expect(eventClip(motion, 'balance', 0)).toBeUndefined()
    expect(eventClip(pack, 'balance', 5, () => 0.9)).toBe('balance_empty')
    expect(taskClip('WORKING', 'command', pack)).toBe('working_command')
    expect(taskClip('WORKING', 'search', pack)).toBe('working_search')
    const renamed = { ...pack, clips: { ...pack.clips, busy: clip('busy') }, events: { workStatus: tiers('busy', 'busy', 'busy', 'busy', 'busy', 'busy') } }
    expect(['THINKING', 'WORKING', 'WAITING', 'SUCCESS', 'ERROR'].map(state => taskClip(state as 'IDLE', undefined, renamed))).toEqual(Array(5).fill('busy'))
    expect(taskClip('WORKING', 'test', renamed)).toBe('busy')
    expect(taskClip('IDLE', undefined, renamed)).toBe('idle')
  })

  it('splits clicks into head, body, and tail and rotates the pack responses', () => {
    expect([0.1, 0.34, 0.35, 0.72, 0.73, 1].map(clickArea)).toEqual(['head', 'head', 'body', 'body', 'tail', 'tail'])
    expect(clickClip(pack, 'body', () => 0)).toBe('poke')
    expect(clickClip(pack, 'body', () => 0, 'poke')).toBe('click_bounce')
    expect(clickClip(pack, 'body', () => 0.99)).toBe('click_huff')
    expect(clickClip(pack, 'tail', () => 0)).toBe('tail')
    expect(clickClip(undefined, 'head', () => 0)).toBe('head_pat')
  })

  it('lists autonomous pack-only clips and filters them by the device allowlist', () => {
    expect(autonomousPackClips(pack)).toEqual(['sign', 'look_around'])
    expect(autonomousPackClips(undefined)).toEqual([])
    expect(clipAllowed('sign')).toBe(true)
    expect(clipAllowed('sign', undefined, [])).toBe(false)
    expect(clipAllowed('idle_stretch', ['stretch'], [])).toBe(true)
    expect(clipAllowed('idle_stretch', [], ['idle_stretch'])).toBe(false)
    const sequence = (...values: number[]) => () => values.shift() ?? 0
    expect(nextChainClip(pack, 'idle', [], undefined, sequence(0, 0), ['sign'])).toBe('sign')
    expect(nextChainClip(pack, 'idle', [], undefined, sequence(0, 0), [])).toBeUndefined()
    // The turn band lands on a turn clip the allowlist leaves out, so it falls back to the allowed category clip.
    expect(nextAutonomousClip(pack, 'idle', [], undefined, sequence(0.5, 0, 0), { allowed: false, room: () => false }, ['sign'])).toBe('sign')
  })
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

describe('measured walking', () => {
  const move = { direction: 'left' as const, travel: [0, 0, 10, 20, 20], leadMs: 0, tailMs: 0 }
  const walking: PetMotionView = {
    ...motion, width: 412,
    clips: { ...motion.clips, crab: { ...clip('crab'), frames: 5, move }, look_around: { ...clip('look_around'), turn: true } },
    categories: [{ id: 'small', label: { zh: '甲', en: 'A' }, weight: 1, life: ['idle'], clips: ['idle_stretch'] }],
    chain: { idle: 10, turn: 5, move: 5 },
  }
  const sequence = (...values: number[]) => () => values.shift() ?? 0
  const open = { allowed: true, room: () => true }

  it('draws idle, turn, or move by the chain weights, turning when there is no room and idling when walking is off', () => {
    expect(nextAutonomousClip(walking, 'idle', undefined, undefined, sequence(0.1, 0), open)).toBe('idle_stretch')
    expect(nextAutonomousClip(walking, 'idle', undefined, undefined, sequence(0.6, 0), open)).toBe('look_around')
    expect(nextAutonomousClip(walking, 'idle', undefined, undefined, sequence(0.9, 0), open)).toBe('crab')
    expect(nextAutonomousClip(walking, 'idle', undefined, undefined, sequence(0.9, 0), { allowed: true, room: () => false })).toBe('look_around')
    expect(nextAutonomousClip(walking, 'idle', undefined, undefined, sequence(0.9, 0), { allowed: false, room: () => true })).toBe('idle_stretch')
    // Play and packs without weights keep the category chain.
    expect(nextAutonomousClip(walking, 'play', undefined, undefined, sequence(0.9, 0), open)).toBeUndefined()
    expect(nextAutonomousClip({ ...walking, chain: undefined }, 'idle', undefined, undefined, sequence(0.9, 0), open)).toBe('idle_stretch')
    expect(nextAutonomousClip({ ...walking, chain: { idle: 0, turn: 0, move: 0 } }, 'idle', undefined, undefined, sequence(0.9, 0), open))
      .toBe('idle_stretch')
  })

  it('interpolates travel by media time and converts it to screen pixels and direction', () => {
    expect(travelAt(move, 1000, 0)).toBe(0)
    expect(travelAt(move, 1000, 0.5)).toBe(15)
    expect(travelAt(move, 1000, 9)).toBe(20)
    expect(travelAt({ ...move, travel: [] }, 1000, 0.5)).toBe(0)
    expect(travelScale(walking, 100)).toBeCloseTo(168 / 412)
    expect(travelScale(walking, 200)).toBeCloseTo(336 / 412)
    expect(travelScale({ width: 0 })).toBe(0)
    expect(walkDirection(move, false)).toBe('left')
    expect(walkDirection(move, true)).toBe('right')
    expect(walkDirection({ direction: 'right' }, false)).toBe('right')
  })

  it('moves the surface with the playing media and ends the walk with the clip', () => {
    vi.useRealTimers()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame'] })
    const travel = vi.fn()
    const props = { motion: walking, state: 'IDLE' as const, dragging: false, preferences, paused: false, onFailure: vi.fn() }
    const view = render(<PetMotion {...props} walk={{ allowed: true, room: () => true, travel }} action={{ clip: 'crab', serial: 1 }} />)
    const video = view.container.querySelector('video')!
    let time = 0
    Object.defineProperty(video, 'currentTime', { configurable: true, get: () => time, set: (value: number) => { time = value } })
    act(() => { vi.advanceTimersByTime(16) })
    expect(travel).not.toHaveBeenCalled()
    time = 0.5
    act(() => { vi.advanceTimersByTime(16) })
    time = 1
    act(() => { vi.advanceTimersByTime(16) })
    const moved = travel.mock.calls.filter(call => call[1] === false).reduce((sum, call) => sum + (call[0] as number), 0)
    expect(moved).toBeCloseTo(-20 * 168 / 412)
    fireEvent.ended(video)
    expect(travel).toHaveBeenLastCalledWith(0, true)
    expect(view.container.querySelector<HTMLElement>('[data-pet-clip]')!.dataset.petClip).toBe('idle')
    view.unmount()
  })

  it('chooses a walk autonomously only when the surface allows it, otherwise turns', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9)
    const travel = vi.fn()
    const props = { motion: walking, state: 'IDLE' as const, dragging: false, preferences, paused: false, onFailure: vi.fn() }
    const view = render(<PetMotion {...props} walk={{ allowed: true, room: () => false, travel }} />)
    act(() => { vi.advanceTimersByTime(20000) })
    expect(view.container.querySelector<HTMLElement>('[data-pet-clip]')!.dataset.petClip).toBe('look_around')
    fireEvent.ended(view.container.querySelector('video')!)
    const room = vi.fn(() => true)
    view.rerender(<PetMotion {...props} walk={{ allowed: true, room, travel }} />)
    act(() => { vi.advanceTimersByTime(20000) })
    expect(view.container.querySelector<HTMLElement>('[data-pet-clip]')!.dataset.petClip).toBe('crab')
    // After the turn the character faces right, so the walk is checked to the right over the scaled distance.
    expect(room).toHaveBeenCalledWith('right', expect.closeTo(20 * 168 / 412))
  })
})
