import { describe, expect, it } from 'vitest'
import { parsePetPack, type PetPackManifest } from '@deepseek-ai/dsh-pet/pack'
import manifest from '@deepseek-ai/dsh-pet/packs/whaletail-maid/pet.json'
import { BUILTIN_FRAME_SET, clipFor, offeredFrameSet, petFrameSet } from '../src/client/frames.ts'

const builtin = (parsePetPack(manifest) as { pack: PetPackManifest }).pack

describe('clipFor', () => {
  it.each([
    ['IDLE', 'idle'], ['DISCONNECTED', 'idle'], ['THINKING', 'thinking'], ['WORKING', 'working'],
    ['WAITING', 'waiting'], ['SUCCESS', 'success'], ['ERROR', 'error'],
  ] as const)('%s plays %s', (state, clip) => {
    expect(clipFor(state)).toBe(clip)
    expect(BUILTIN_FRAME_SET.frames[clip]).toHaveLength(6)
  })
})

describe('pack frame sets', () => {
  it('renders the built-in whaletail-maid pack at its own frame rate', () => {
    expect(BUILTIN_FRAME_SET).toMatchObject({ key: 'whaletail-maid@1.0.0', fps: 6, dev: false, name: { zh: '鲸尾女仆' } })
  })

  it('needs an asset for every frame', () => {
    expect(() => petFrameSet(builtin, {}, true)).toThrow('pet pack whaletail-maid: missing frame assets/frames/idle-1.webp')
  })

  it('takes an offered pack only when it validates and resolves', () => {
    const assets = Object.fromEntries(Object.values(builtin.clips).flatMap(clip => 'frames' in clip ? clip.frames : []).map(path => [path, path]))
    expect(offeredFrameSet({ pack: null, problems: [] })).toBeUndefined()
    expect(offeredFrameSet({ pack: { manifest: { ...builtin, fps: 0 }, assets, dev: true }, problems: [] })).toBeUndefined()
    expect(offeredFrameSet({ pack: { manifest: builtin, assets: {}, dev: true }, problems: [] })).toBeUndefined()
    expect(offeredFrameSet({ pack: { manifest: builtin, assets, dev: true }, problems: [] })).toMatchObject({ dev: true, key: 'whaletail-maid@1.0.0' })
  })

  it('carries a line table only when it validates again', () => {
    const assets = Object.fromEntries(Object.values(builtin.clips).flatMap(clip => 'frames' in clip ? clip.frames : []).map(path => [path, path]))
    const lines = { formatVersion: 2 as const, lines: { 'greet.noon': [{ zh: '午安', en: 'Good noon' }] } }
    const offer = (table: unknown) =>
      offeredFrameSet({ pack: { manifest: builtin, assets, dev: false, lines: table as typeof lines }, problems: [] })
    expect(offer(lines)?.lines).toEqual(lines)
    expect(offer({ formatVersion: 1, lines: {} })).toMatchObject({ key: 'whaletail-maid@1.0.0' })
    expect(offer({ formatVersion: 1, lines: {} })?.lines).toBeUndefined()
  })
})
