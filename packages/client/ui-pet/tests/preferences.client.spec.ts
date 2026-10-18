import { describe, expect, it, vi } from 'vitest'
import {
  isSnoozed, parsePreferences, PET_PREFERENCES_KEY, PetPreferenceStore, throwEnabled, type PreferenceStorage, type PreferenceStorageEvent,
} from '../src/client/preferences.ts'

describe('parsePreferences', () => {
  it('persists independent activity and accessibility options while rejecting invalid levels', () => {
    expect(parsePreferences('{"activity":"lively","effects":false,"interactive":true,"roam":true,"throw":false,"reducedMotion":true}'))
      .toMatchObject({ activity: 'lively', effects: false, interactive: true, roam: true, throw: false, reducedMotion: true })
    expect(parsePreferences('{"throw":"no"}')).not.toHaveProperty('throw')
    expect(parsePreferences('{"activity":"every-second","effects":"yes"}')).toEqual({ notify: false, snoozeUntil: undefined })
  })

  it('falls back to defaults field by field', () => {
    expect(parsePreferences(null)).toEqual({ notify: false, snoozeUntil: undefined })
    expect(parsePreferences('{')).toEqual({ notify: false, snoozeUntil: undefined })
    expect(parsePreferences('null')).toEqual({ notify: false, snoozeUntil: undefined })
    expect(parsePreferences('{"notify":"yes","snoozeUntil":"x"}')).toEqual({ notify: false, snoozeUntil: undefined })
    expect(parsePreferences('{"notify":true,"snoozeUntil":5}')).toEqual({ notify: true, snoozeUntil: 5 })
  })
})

describe('PetPreferenceStore', () => {
  it('loads, updates, and writes through to storage', () => {
    const data = new Map<string, string>([[PET_PREFERENCES_KEY, '{"notify":true}']])
    const storage: PreferenceStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value) } }
    const store = new PetPreferenceStore(storage)
    expect(store.snapshot.getSnapshot().notify).toBe(true)
    const listener = vi.fn()
    store.snapshot.subscribe(listener)
    store.update({ snoozeUntil: 10 })
    expect(listener).toHaveBeenCalled()
    expect(JSON.parse(data.get(PET_PREFERENCES_KEY)!)).toEqual({ notify: true, snoozeUntil: 10 })
  })

  it('follows writes of other documents to its own key', () => {
    const store = new PetPreferenceStore(undefined)
    const target = new EventTarget()
    const source = {
      addEventListener: (type: 'storage', listener: (event: { key: string | null; newValue: string | null }) => void) => {
        target.addEventListener(type, (event) => { listener((event as CustomEvent<PreferenceStorageEvent>).detail) })
      },
      removeEventListener: vi.fn(),
    }
    const stop = store.follow(source)
    target.dispatchEvent(new CustomEvent('storage', { detail: { key: 'other', newValue: '{"notify":true}' } }))
    expect(store.snapshot.getSnapshot().notify).toBe(false)
    target.dispatchEvent(new CustomEvent('storage', { detail: { key: PET_PREFERENCES_KEY, newValue: '{"notify":true}' } }))
    expect(store.snapshot.getSnapshot().notify).toBe(true)
    stop()
    expect(source.removeEventListener).toHaveBeenCalledWith('storage', expect.any(Function))
  })

  it('keeps working in memory when storage throws', () => {
    const storage: PreferenceStorage = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    }
    const store = new PetPreferenceStore(storage)
    store.update({ notify: true })
    expect(store.snapshot.getSnapshot().notify).toBe(true)
    const memory = new PetPreferenceStore(undefined)
    memory.update({ notify: true })
    expect(memory.snapshot.getSnapshot().notify).toBe(true)
  })
})

describe('isSnoozed', () => {
  it('is active only before the snooze end', () => {
    expect(isSnoozed({ notify: true, snoozeUntil: undefined }, 5)).toBe(false)
    expect(isSnoozed({ notify: true, snoozeUntil: 10 }, 5)).toBe(true)
    expect(isSnoozed({ notify: true, snoozeUntil: 10 }, 10)).toBe(false)
  })
})

it('validates new preferences on load, local writes and cross-window reads', () => {
  const parsed = parsePreferences(JSON.stringify({ name: '  小鱼  ', size: 500, life: 'rest', actions: ['bubbles', 'unknown', 'bubbles'] }))
  expect(parsed).toMatchObject({ name: '小鱼', size: 200, life: 'rest', actions: ['bubbles'] })
  expect(parsePreferences('{"size":null,"life":"working","actions":"all"}')).toEqual({ notify: false, snoozeUntil: undefined })
  const store = new PetPreferenceStore(undefined)
  store.update({ name: ' ', size: 0, life: 'play', actions: [] })
  expect(store.snapshot.getSnapshot()).toEqual({ notify: false, snoozeUntil: undefined, size: 50, life: 'play', actions: [] })
})

it('keeps valid unique pack clip names and the lines switch', () => {
  const many = Array.from({ length: 300 }, (_, index) => `c${index}`)
  expect(parsePreferences(JSON.stringify({ clips: ['sign', 'Sign', 'sign', 3, 'look_around', '../x'], lines: false })))
    .toMatchObject({ clips: ['sign', 'look_around'], lines: false })
  expect(parsePreferences(JSON.stringify({ clips: many })).clips).toHaveLength(256)
  expect(parsePreferences('{"clips":"all","lines":"no"}')).toEqual({ notify: false, snoozeUntil: undefined })
  expect(parsePreferences('{"clips":[]}').clips).toEqual([])
  expect(parsePreferences('{"occasions":false}').occasions).toBe(false)
  expect(parsePreferences('{"occasions":"no"}').occasions).toBeUndefined()
})

it('throws by default, never under reduced motion, and not when turned off', () => {
  const base = { notify: false, snoozeUntil: undefined }
  expect(throwEnabled(base, false)).toBe(true)
  expect(throwEnabled(base, true)).toBe(false)
  expect(throwEnabled({ ...base, reducedMotion: true }, false)).toBe(false)
  expect(throwEnabled({ ...base, throw: false }, false)).toBe(false)
})
