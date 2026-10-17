import { describe, expect, it } from 'vitest'
import { clipFor, PET_FRAMES } from '../src/client/frames.ts'

describe('clipFor', () => {
  it.each([
    ['IDLE', 'idle'], ['DISCONNECTED', 'idle'], ['THINKING', 'thinking'], ['WORKING', 'working'],
    ['WAITING', 'waiting'], ['SUCCESS', 'success'], ['ERROR', 'error'],
  ] as const)('%s plays %s', (state, clip) => {
    expect(clipFor(state)).toBe(clip)
    expect(PET_FRAMES[clip]).toHaveLength(6)
  })
})
