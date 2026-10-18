import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import {
  fitPetBody, fitPetPosition, PET_DEFAULT_BODY, PET_POSITION_LAYOUT_LIMIT, petBodyRect, petDefaultPosition, petDisplayLayout,
  petPlaceRequest, PetPositionStore, revealPetWindow, type PetDisplay,
} from '../src/pet-position.ts'

const SIZE = { width: 340, height: 560 }
const primary: PetDisplay = {
  id: 7, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 40, width: 1920, height: 1040 }, scaleFactor: 1.5,
}
const left: PetDisplay = {
  id: 3, bounds: { x: -1280, y: 0, width: 1280, height: 1024 }, workArea: { x: -1280, y: 0, width: 1280, height: 1024 }, scaleFactor: 1,
}

describe('display layouts and fitting', () => {
  it('keys the layout by display id, bounds and scale regardless of order', () => {
    expect(petDisplayLayout([primary, left])).toBe('3@-1280,0,1280x1024*1|7@0,0,1920x1080*1.5')
    expect(petDisplayLayout([left, primary])).toBe(petDisplayLayout([primary, left]))
  })

  it('places the default at the bottom-right of the work area', () => {
    expect(petDefaultPosition(primary.workArea, SIZE)).toEqual({ x: 1564, y: 504 })
  })

  it('clamps into the work area holding the window center and rejects positions off every display', () => {
    expect(fitPetPosition({ x: -200, y: 10.4 }, [primary, left], SIZE)).toEqual({ x: -340, y: 10 })
    expect(fitPetPosition({ x: 1700, y: 700 }, [primary, left], SIZE)).toEqual({ x: 1580, y: 520 })
    expect(fitPetPosition({ x: 4000, y: 0 }, [primary, left], SIZE)).toBeUndefined()
    const tiny: PetDisplay = { ...left, workArea: { x: 0, y: 0, width: 100, height: 100 }, bounds: { x: 0, y: 0, width: 400, height: 600 } }
    expect(fitPetPosition({ x: 10, y: 10 }, [tiny], SIZE)).toEqual({ x: 0, y: 0 })
  })
})

describe('body fitting and renderer requests', () => {
  it('keeps the body inside the work area holding the body centre, letting the bubble room leave the screen', () => {
    expect(fitPetBody({ x: -214, y: -412 }, [primary, left], PET_DEFAULT_BODY)).toEqual({ x: -164, y: 40 - 412 })
    expect(fitPetBody({ x: -1500, y: -412 }, [primary, left], PET_DEFAULT_BODY)).toEqual({ x: -1280 - 164, y: -412 })
    expect(fitPetBody({ x: 1600, y: 560 }, [primary, left], PET_DEFAULT_BODY)).toEqual({ x: 1588, y: 528 })
    // Above the primary work area (taskbar strip at the top) the body is pushed down below it.
    expect(fitPetBody({ x: 100, y: -440 }, [primary, left], PET_DEFAULT_BODY)).toEqual({ x: 100, y: 40 - 412 })
    expect(fitPetBody({ x: 5000, y: 0 }, [primary, left], PET_DEFAULT_BODY)).toBeUndefined()
  })

  it('reveals the whole window on the display of the body, even when the window centre is off screen', () => {
    expect(revealPetWindow({ x: -100, y: -400 }, [primary, left], SIZE, PET_DEFAULT_BODY)).toEqual({ x: 0, y: 40 })
    expect(revealPetWindow({ x: -1500, y: -400 }, [primary, left], SIZE, PET_DEFAULT_BODY)).toEqual({ x: -1280, y: 0 })
    expect(revealPetWindow({ x: 5000, y: 0 }, [primary, left], SIZE, PET_DEFAULT_BODY)).toBeUndefined()
  })

  it('accepts only finite non-empty bodies inside the window and finite bounded origins', () => {
    expect(petBodyRect({ x: 164, y: 412, width: 168, height: 140 }, SIZE)).toEqual(PET_DEFAULT_BODY)
    for (const bad of [null, 'x', { x: 0, y: 0, width: 0, height: 1 }, { x: 0, y: 0, width: 341.5, height: 1 }, { x: Number.NaN, y: 0, width: 1, height: 1 },
      { x: -5, y: 0, width: 1, height: 1 }, { x: '0', y: 0, width: 1, height: 1 }]) {
      expect(petBodyRect(bad, SIZE)).toBeUndefined()
    }
    expect(petPlaceRequest({ x: 1, y: 2 })).toEqual({ point: { x: 1, y: 2 }, final: false })
    expect(petPlaceRequest({ x: 1, y: 2, final: true })).toEqual({ point: { x: 1, y: 2 }, final: true })
    for (const bad of [null, { x: 1 }, { x: Infinity, y: 0 }, { x: 0, y: -2e6 }]) expect(petPlaceRequest(bad)).toBeUndefined()
  })
})

describe('PetPositionStore', () => {
  let directory: string
  let warn: MockInstance<typeof console.warn>
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'pet-position-'))
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(async () => {
    warn.mockRestore()
    await rm(directory, { recursive: true, force: true })
  })

  it('starts empty without a file and writes positions that a new store reads back', async () => {
    const path = join(directory, 'nested', 'pet-window.json')
    const store = new PetPositionStore(path)
    expect(store.get('a')).toBeUndefined()
    await store.set('a', { x: 1, y: 2 })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ version: 1, layouts: { a: { x: 1, y: 2 } } })
    expect(new PetPositionStore(path).get('a')).toEqual({ x: 1, y: 2 })
    expect(warn).not.toHaveBeenCalled()
  })

  it('keeps the most recently used layouts only', async () => {
    const path = join(directory, 'pet-window.json')
    const store = new PetPositionStore(path)
    for (let index = 0; index <= PET_POSITION_LAYOUT_LIMIT; index += 1) void store.set(`l${String(index)}`, { x: index, y: 0 })
    await store.set('l1', { x: 9, y: 9 })
    const reloaded = new PetPositionStore(path)
    expect(reloaded.get('l0')).toBeUndefined()
    expect(reloaded.get('l1')).toEqual({ x: 9, y: 9 })
    expect(reloaded.get(`l${String(PET_POSITION_LAYOUT_LIMIT)}`)).toEqual({ x: PET_POSITION_LAYOUT_LIMIT, y: 0 })
  })

  it('ignores damaged files and invalid entries', async () => {
    const path = join(directory, 'pet-window.json')
    await writeFile(path, '{ not json')
    expect(new PetPositionStore(path).get('a')).toBeUndefined()
    await writeFile(path, JSON.stringify({ version: 2, layouts: {} }))
    expect(new PetPositionStore(path).get('a')).toBeUndefined()
    await writeFile(path, 'null')
    expect(new PetPositionStore(path).get('a')).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(3)
    await writeFile(path, JSON.stringify({ version: 1, layouts: { a: { x: 1, y: 'no' }, b: null, c: { x: 3, y: 4, extra: true } } }))
    const store = new PetPositionStore(path)
    expect(store.get('a')).toBeUndefined()
    expect(store.get('b')).toBeUndefined()
    expect(store.get('c')).toEqual({ x: 3, y: 4 })
  })

  it('warns when the file cannot be read or written', async () => {
    const store = new PetPositionStore(directory)
    expect(warn).toHaveBeenCalledWith('desktop pet: positions unreadable', expect.anything())
    await store.set('a', { x: 1, y: 1 })
    expect(warn).toHaveBeenCalledWith('desktop pet: positions not saved', expect.anything())
    expect(store.get('a')).toEqual({ x: 1, y: 1 })
  })
})
