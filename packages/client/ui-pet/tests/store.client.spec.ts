// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { PetSnapshot } from '@deepseek-ai/dsh-pet/types'
import { displayedState, isPetVisible, PetStore, type PetStreamFactory, type PetStreamItem } from '../src/client/store.ts'
import { snapshot } from './fixtures.ts'

function factory(script: (hooks: { carrierFailed?: (error: Error) => void }) => AsyncGenerator<PetStreamItem>): {
  factory: PetStreamFactory
  dispose: ReturnType<typeof vi.fn>
  opened: { name?: string; ended?: (accepted: boolean) => Error }
} {
  const dispose = vi.fn(async () => {})
  const opened: { name?: string; ended?: (accepted: boolean) => Error } = {}
  return {
    dispose,
    opened,
    factory: {
      $stream: (options) => {
        opened.name = options.name
        opened.ended = options.ended
        const iterable = script(options.carrierFailed === undefined ? {} : { carrierFailed: options.carrierFailed })
        return Object.assign(iterable, { dispose })
      },
    },
  }
}

const item = (value: PetSnapshot, accept = vi.fn()): PetStreamItem => ({ value, accept })

describe('displayedState', () => {
  it('reads DISCONNECTED, IDLE before the first frame, then the primary state', () => {
    expect(displayedState({ snapshot: snapshot({ primary: 'WORKING' }), connected: false })).toBe('DISCONNECTED')
    expect(displayedState({ snapshot: undefined, connected: true })).toBe('IDLE')
    expect(displayedState({ snapshot: snapshot({ primary: 'WAITING' }), connected: true })).toBe('WAITING')
  })
})

describe('isPetVisible', () => {
  it('defaults to shown before the first frame', () => {
    expect(isPetVisible({ snapshot: undefined, connected: false })).toBe(true)
    expect(isPetVisible({ snapshot: snapshot({ visible: false }), connected: true })).toBe(false)
  })
})

describe('PetStore', () => {
  it('publishes frames, marks carrier loss as disconnected, and accepts each frame', async () => {
    const accept = vi.fn()
    const bench = factory(async function* ({ carrierFailed }) {
      yield item(snapshot({ primary: 'THINKING' }), accept)
      carrierFailed?.(new Error('carrier lost'))
      yield item(snapshot({ primary: 'WAITING' }))
    })
    const store = new PetStore(bench.factory, () => (async function* () {})())
    const seen: string[] = []
    store.store.subscribe(() => { seen.push(displayedState(store.store.getSnapshot())) })
    await store.run()
    expect(bench.opened.name).toBe('pet')
    expect(bench.opened.ended?.(true)).toBeInstanceOf(Error)
    expect(accept).toHaveBeenCalledOnce()
    expect(seen).toEqual(['THINKING', 'DISCONNECTED', 'WAITING', 'DISCONNECTED'])
  })

  it('treats a terminal failure as disconnected and stops publishing after dispose', async () => {
    const bench = factory(async function* () {
      yield item(snapshot())
      throw new Error('terminal')
    })
    const store = new PetStore(bench.factory, () => (async function* () {})())
    await store.run()
    expect(store.store.getSnapshot().connected).toBe(false)
    await store.dispose()
    expect(bench.dispose).toHaveBeenCalledOnce()
    const before = store.store.getSnapshot()
    await store.run()
    expect(store.store.getSnapshot()).toBe(before)
  })
})
