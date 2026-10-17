import { describe, expect, it } from 'vitest'
import { clampPetPoint, readPetPoint } from '../src/client/page-position.ts'

describe('Web character placement', () => {
  it('restores finite coordinates and confines them after shrinking the viewport', () => {
    expect(readPetPoint('{"x":480,"y":320}', 800, 600)).toEqual({ x: 480, y: 320 })
    expect(readPetPoint('{"x":480,"y":320}', 300, 200)).toEqual({ x: 180, y: 71 })
  })

  it('ignores malformed and non-finite records and starts near the composer', () => {
    for (const raw of [null, 'bad', 'null', '{}', '{"x":"3","y":1}', '{"x":1e999,"y":2}']) {
      expect(readPetPoint(raw, 800, 600)).toEqual({ x: 664, y: 383 })
    }
  })

  it('keeps tiny windows and negative coordinates finite', () => {
    expect(clampPetPoint({ x: -400, y: -300 }, 20, 20)).toEqual({ x: 8, y: 8 })
    expect(clampPetPoint({ x: 800, y: 600 }, 800, 600)).toEqual({ x: 680, y: 471 })
  })
})
