import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isPetPackPath, parsePetPack, PET_PACK_REQUIRED_SLOTS, petPackFiles, resolvePetClip, satisfiesCaret, type PetPackManifest,
} from '../src/pack.ts'

const BUILTIN = join(import.meta.dirname, '..', 'packs', 'whaletail-maid')

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const clips: Record<string, unknown> = {}
  for (const slot of PET_PACK_REQUIRED_SLOTS) clips[slot] = { frames: [`assets/${slot}-1.webp`], loop: true }
  return {
    formatVersion: 2, id: 'demo', version: '1.2.3', name: { en: 'Demo' }, author: 'me',
    license: { code: 'MIT', assets: 'CC-BY-4.0' }, engines: { petRuntime: '^1.0.0', petApi: '^1' },
    renderer: 'frames', canvas: { width: 100, height: 120, anchor: [50, 110] }, fps: 12, clips, ...overrides,
  }
}

function errors(value: unknown): readonly string[] {
  const result = parsePetPack(value)
  return result.ok ? [] : result.errors
}

describe('built-in pack', () => {
  it('ships a valid whaletail-maid@1.0.0 whose files, lines, and license exist', () => {
    const result = parsePetPack(JSON.parse(readFileSync(join(BUILTIN, 'pet.json'), 'utf8')))
    expect(result.ok).toBe(true)
    const pack = (result as { pack: PetPackManifest }).pack
    expect(`${pack.id}@${pack.version}`).toBe('whaletail-maid@1.0.0')
    expect(pack.name).toEqual({ en: 'Whaletail Maid', zh: '鲸尾女仆' })
    for (const file of petPackFiles(pack)) expect(existsSync(join(BUILTIN, file)), file).toBe(true)
    expect(petPackFiles(pack)).toHaveLength(36)
    const lines = JSON.parse(readFileSync(join(BUILTIN, pack.persona!.lines), 'utf8')) as { formatVersion: number; lines: Record<string, unknown[]> }
    expect(lines.formatVersion).toBe(2)
    for (const entries of Object.values(lines.lines)) {
      for (const entry of entries) expect(entry).toEqual({ zh: expect.any(String) as unknown, en: expect.any(String) as unknown })
    }
    expect(readFileSync(join(BUILTIN, 'LICENSE'), 'utf8')).toContain('Copyright (c) 2026 PC2005-cloud')
    expect(resolvePetClip(pack, 'dragging')).toBe(resolvePetClip(pack, 'idle'))
  })
})

describe('parsePetPack', () => {
  it('accepts a minimal pack and keeps optional fields only when present', () => {
    const result = parsePetPack(manifest({
      name: { en: 'Demo', zh: '演示' }, license: { code: 'MIT', assets: 'MIT', source: 'https://example.com' },
      persona: { presets: ['calm'], default: 'calm', lines: 'lines.json' }, kind: 'character',
    }))
    expect(result.ok).toBe(true)
    const pack = (result as { pack: PetPackManifest }).pack
    expect(pack.name.zh).toBe('演示')
    expect(pack.license.source).toBe('https://example.com')
    expect(pack.persona).toEqual({ presets: ['calm'], default: 'calm', lines: 'lines.json' })
    const plain = (parsePetPack(manifest()) as { pack: PetPackManifest }).pack
    expect(plain).not.toHaveProperty('persona')
    expect(plain.license).toEqual({ code: 'MIT', assets: 'CC-BY-4.0' })
    expect(plain.name).toEqual({ en: 'Demo' })
  })

  it('reports every problem of a broken manifest', () => {
    expect(errors(null)).toEqual(['pet.json must be a JSON object'])
    expect(errors({})).toEqual(expect.arrayContaining([
      'formatVersion must be 2', 'id must be lowercase letters, digits, and hyphens', 'version must be MAJOR.MINOR.PATCH',
      'name must give at least an en string', 'author must be a string', 'license must give code and assets',
      'engines must give petRuntime and petApi', 'renderer undefined is not supported; this runtime renders frames',
      'canvas must give width and height up to 4096 and an [x, y] anchor', 'fps must be between 0 and 60', 'clips must be an object',
    ]))
    expect(errors(manifest({ kind: 'content' }))).toEqual(['only character packs are supported'])
    expect(errors(manifest({ name: { en: 'x', zh: 3 } }))).toEqual(['name must give at least an en string'])
    expect(errors(manifest({ license: { code: 'MIT', assets: 'MIT', source: '' } }))).toEqual(['license must give code and assets'])
    expect(errors(manifest({ engines: { petRuntime: '^2.0.0', petApi: '>=1' } }))).toEqual([
      'engines.petRuntime ^2.0.0 does not accept 1.0.0', 'engines.petApi >=1 does not accept 1.0.0',
    ])
    expect(errors(manifest({ renderer: 'spine' }))).toEqual(['renderer spine is not supported; this runtime renders frames'])
    expect(errors(manifest({ canvas: { width: 5000, height: 1, anchor: [0, 0] } }))).toHaveLength(1)
    expect(errors(manifest({ canvas: { width: 1, height: 1, anchor: [0] } }))).toHaveLength(1)
    expect(errors(manifest({ canvas: { width: 1, height: 1, anchor: [0, 'x'] } }))).toHaveLength(1)
    expect(errors(manifest({ canvas: 'big' }))).toHaveLength(1)
    expect(errors(manifest({ fps: 0 }))).toEqual(['fps must be between 0 and 60'])
    expect(errors(manifest({ persona: { presets: ['a'], default: 'b', lines: 'lines.json' } }))).toHaveLength(1)
    expect(errors(manifest({ persona: { presets: ['a'], default: 'a', lines: '../lines.json' } }))).toHaveLength(1)
    expect(errors(manifest({ persona: 'genki' }))).toHaveLength(1)
  })

  it('checks clips: known slots, required slots, frames, paths, loops, and references', () => {
    const base = manifest().clips as Record<string, unknown>
    const withClips = (clips: Record<string, unknown>) => errors(manifest({ clips: { ...base, ...clips } }))
    expect(withClips({ idle_micro_yawn: { ref: 'idle' }, work_edit: { ref: 'working' } })).toEqual([])
    expect(withClips({ dance: { ref: 'idle' } })).toEqual(['clips.dance is not a known slot'])
    expect(withClips({ talk: 3 })).toEqual(['clips.talk must be an object'])
    expect(withClips({ talk: { ref: '' } })).toEqual(['clips.talk.ref must name a slot'])
    expect(withClips({ talk: { frames: [] } })).toEqual(['clips.talk.frames must list at least one image'])
    expect(withClips({ talk: { frames: ['../x.webp', '/abs.png', 'a.gif', 7, 'C:/x.png', 'a\\b.png', './a.png'], loop: true } })).toEqual([
      'clips.talk.frames has unsafe or unsupported paths: ../x.webp, /abs.png, a.gif, 7, C:/x.png, a\\b.png, ./a.png',
    ])
    expect(withClips({ talk: { frames: ['a.PNG'] } })).toEqual(['clips.talk.loop must be true or false'])
    expect(withClips({ talk: { ref: 'sleep' } })).toEqual(['clips.talk refers to the missing slot sleep'])
    expect(withClips({ talk: { ref: 'sleep' }, sleep: { ref: 'talk' } })).toEqual(['clips.talk has a reference cycle', 'clips.sleep has a reference cycle'])
    const { dragging: _dragging, ...missing } = base
    expect(errors(manifest({ clips: missing }))).toEqual(['clips.dragging is required'])
  })
})

describe('pack helpers', () => {
  it('accepts only pack-relative paths', () => {
    expect(isPetPackPath('assets/frames/idle-1.webp')).toBe(true)
    for (const path of ['', '/a', 'a//b', 'a/../b', 'a/./b', 'a\\b', 'c:x', 'x'.repeat(261)]) expect(isPetPackPath(path), path).toBe(false)
  })

  it('matches caret ranges', () => {
    expect(satisfiesCaret('^1', '1.0.0')).toBe(true)
    expect(satisfiesCaret('^1.0.0', '1.4.2')).toBe(true)
    expect(satisfiesCaret('^1.2', '1.1.9')).toBe(false)
    expect(satisfiesCaret('^1.2', '1.3.0')).toBe(true)
    expect(satisfiesCaret('^1.2.3', '1.2.2')).toBe(false)
    expect(satisfiesCaret('^1.2.3', '1.2.3')).toBe(true)
    expect(satisfiesCaret('^2', '1.0.0')).toBe(false)
    expect(satisfiesCaret('1.0.0', '1.0.0')).toBe(false)
    expect(satisfiesCaret('^1', 'v1')).toBe(false)
  })

  it('resolves references and fallbacks and lists unique files', () => {
    const pack = (parsePetPack(manifest({
      clips: { ...(manifest().clips as object), talk: { ref: 'working' }, sleep: { frames: ['assets/idle-1.webp'], loop: true } },
    })) as { pack: PetPackManifest }).pack
    expect(resolvePetClip(pack, 'talk')).toEqual({ frames: ['assets/working-1.webp'], loop: true })
    expect(resolvePetClip(pack, 'work_test')).toEqual({ frames: ['assets/working-1.webp'], loop: true })
    expect(resolvePetClip(pack, 'head_pat')).toEqual({ frames: ['assets/idle-1.webp'], loop: true })
    expect(petPackFiles(pack)).toHaveLength(PET_PACK_REQUIRED_SLOTS.length)
  })
})
