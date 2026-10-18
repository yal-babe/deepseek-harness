import { describe, expect, it } from 'vitest'
import {
  decidePetIgnore, PET_OFF_BODY_RELEASE_MS, PET_TOPMOST_REASSERT_MS, petPointerZone, petWindowsFallbacks, shouldReassertTopmost,
} from '../src/pet-fallbacks.ts'

const bounds = { x: 100, y: 100, width: 340, height: 560 }
const body = { x: 164, y: 412, width: 168, height: 140 }
const onBody = { x: 100 + 200, y: 100 + 450 }
const inMargin = { x: 110, y: 110 }
const outside = { x: 50, y: 50 }
const base = { bounds, body, ignoring: true, dragging: false, panelOpen: false, offBodyMs: 0 }

describe('Windows safeguard configuration', () => {
  it('runs both on Windows unless turned off, and neither elsewhere unless turned on', () => {
    expect(petWindowsFallbacks({}, 'win32')).toEqual({ pointerPoll: true, topmostWatchdog: true })
    expect(petWindowsFallbacks({}, 'darwin')).toEqual({ pointerPoll: false, topmostWatchdog: false })
    expect(petWindowsFallbacks({ DSH_PET_POINTER_POLL: '0', DSH_PET_TOPMOST_WATCHDOG: 'false' }, 'win32'))
      .toEqual({ pointerPoll: false, topmostWatchdog: false })
    expect(petWindowsFallbacks({ DSH_PET_POINTER_POLL: '1', DSH_PET_TOPMOST_WATCHDOG: 'true' }, 'linux'))
      .toEqual({ pointerPoll: true, topmostWatchdog: true })
    expect(petWindowsFallbacks({ DSH_PET_POINTER_POLL: 'yes' }, 'win32').pointerPoll).toBe(true)
  })
})

describe('click-through fallback', () => {
  it('locates the cursor outside, on the body, or in the margin', () => {
    expect(petPointerZone(bounds, outside, body)).toBe('outside')
    expect(petPointerZone(bounds, { x: 440, y: 300 }, body)).toBe('outside')
    expect(petPointerZone(bounds, onBody, body)).toBe('body')
    expect(petPointerZone(bounds, inMargin, body)).toBe('margin')
  })

  it('takes input over the body and passes it through outside', () => {
    expect(decidePetIgnore({ ...base, point: onBody })).toBe(false)
    expect(decidePetIgnore({ ...base, point: outside, ignoring: false })).toBe(true)
  })

  it('keeps the margin state until the cursor rests there long enough', () => {
    expect(decidePetIgnore({ ...base, point: inMargin, ignoring: false })).toBe(false)
    expect(decidePetIgnore({ ...base, point: inMargin, ignoring: true })).toBe(true)
    expect(decidePetIgnore({ ...base, point: inMargin, ignoring: false, offBodyMs: PET_OFF_BODY_RELEASE_MS })).toBe(true)
  })

  it('never lets position interrupt a drag, and leaves an open panel to the renderer', () => {
    expect(decidePetIgnore({ ...base, point: outside, dragging: true })).toBe(false)
    expect(decidePetIgnore({ ...base, point: outside, panelOpen: true, ignoring: false })).toBe(false)
    expect(decidePetIgnore({ ...base, point: onBody, panelOpen: true, ignoring: true })).toBe(true)
  })
})

describe('keep-on-top watchdog', () => {
  const live = { destroyed: false, visible: true, paused: false }

  it('re-asserts at most every interval for a live visible window', () => {
    expect(shouldReassertTopmost({ ...live, nowMs: 1000, lastAssertMs: 1000 })).toBe(false)
    expect(shouldReassertTopmost({ ...live, nowMs: 1000 + PET_TOPMOST_REASSERT_MS - 1, lastAssertMs: 1000 })).toBe(false)
    expect(shouldReassertTopmost({ ...live, nowMs: 1000 + PET_TOPMOST_REASSERT_MS, lastAssertMs: 1000 })).toBe(true)
  })

  it('treats a clock that moved backwards as due, and skips hidden, destroyed, or paused windows', () => {
    expect(shouldReassertTopmost({ ...live, nowMs: 500, lastAssertMs: 1000 })).toBe(true)
    expect(shouldReassertTopmost({ ...live, nowMs: 1e9, lastAssertMs: 0, visible: false })).toBe(false)
    expect(shouldReassertTopmost({ ...live, nowMs: 1e9, lastAssertMs: 0, destroyed: true })).toBe(false)
    expect(shouldReassertTopmost({ ...live, nowMs: 1e9, lastAssertMs: 0, paused: true })).toBe(false)
  })
})
