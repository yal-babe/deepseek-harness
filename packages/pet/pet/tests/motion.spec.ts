import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePetMotion, type PetMotionManifest } from '../src/motion.ts'

const BUILTIN = join(import.meta.dirname, '..', 'packs', 'whaletail-maid')
const SHA = 'a'.repeat(64)
const UPSTREAM_COMMIT = '091b27b40f9eeecc814bedb691fe214ec2b48299'

function builtin(): PetMotionManifest {
  const result = parsePetMotion(JSON.parse(readFileSync(join(BUILTIN, 'motion.json'), 'utf8')))
  if (!result.ok) throw new Error(result.errors.join('; '))
  return result.manifest
}

function minimal(extra: Record<string, unknown> = {}, clipExtra: Record<string, unknown> = {}): unknown {
  return {
    formatVersion: 2, renderer: 'vp9-alpha', width: 412, height: 344,
    clips: { idle: { file: 'assets/motion/idle.webm', loop: true, durationMs: 1000, sha256: SHA, source: { file: 'a.webm', sha256: SHA }, ...clipExtra } },
    ...extra,
  }
}

describe('built-in motion.json', () => {
  it('validates, and every media file matches its recorded SHA-256', () => {
    const manifest = builtin()
    expect(manifest).toMatchObject({ width: 412, height: 344 })
    const files = new Map(Object.values(manifest.clips).map(clip => [clip.file, clip.sha256]))
    for (const [file, sha256] of files) {
      expect(createHash('sha256').update(readFileSync(join(BUILTIN, file))).digest('hex'), file).toBe(sha256)
    }
  })

  it('records the pinned upstream commit, source digest, and generation of every dsh-pet clip', () => {
    const imported = Object.entries(builtin().clips).filter(([, clip]) => clip.source.kind === 'dsh-pet-webm')
    expect(imported.map(([name]) => name).sort())
      .toEqual(['balance_empty', 'balance_frown', 'balance_full', 'balance_jingle', 'balance_low', 'balance_steady',
        'click_bounce', 'click_huff', 'click_shy', 'crab_walk', 'float_step', 'look_around', 'turn_run'])
    for (const [name, clip] of imported) {
      expect(clip.source, name).toMatchObject({
        repository: 'https://github.com/PC2005-cloud/dsh-pet', commit: UPSTREAM_COMMIT, crop: [100, 0, 412, 344], fps: 24,
        generation: { tool: '豆包 (Doubao)', prompt: { file: 'prompts/桌面宠物 10 秒动作提示词.md' } },
      })
      expect(clip.label, name).toBeDefined()
    }
    expect(builtin().clips.look_around?.turn).toBe(true)
  })

  it('records measured travel only for gaits whose feet carry the body, with the upstream chain weights', () => {
    const { clips, chain } = builtin()
    expect(chain).toMatchObject({ idle: 10, turn: 5, move: 5 })
    for (const name of ['crab_walk', 'float_step']) {
      const move = clips[name]!.move!
      expect(move, name).toMatchObject({ direction: 'left', leadMs: 2000, tailMs: 2000 })
      expect(move.travel, name).toHaveLength(clips[name]!.frames!)
      // Stand-still ends: no travel before the lead or after the tail.
      expect(move.travel[48], name).toBe(0)
      expect(move.travel.at(-1), name).toBe(move.travel[192])
      expect(move.travel.at(-1)!, name).toBeGreaterThanOrEqual(20)
      expect(move.slip!.synced, name).toBeLessThan(move.slip!.inPlace)
    }
    // The run turns away and steps on the spot; its feet show no consistent travel.
    expect(clips.turn_run?.move).toBeUndefined()
  })

  it('records the upstream event tiers and splits the click responses by body area', () => {
    const { events, clicks, categories } = builtin()
    expect(events?.balance).toEqual([['balance_full'], ['balance_jingle'], ['balance_steady'], ['balance_frown'], ['balance_low'], ['balance_empty']])
    expect(events?.workStatus).toEqual([['thinking'], ['working'], ['working_command'], ['waiting'], ['success'], ['error']])
    expect(events?.whisper).toBeUndefined()
    expect(clicks).toEqual({ head: ['head_pat', 'click_shy'], body: ['poke', 'click_bounce', 'click_huff'], tail: ['tail'] })
    // Event clips play on events only; the autonomous chain and the menu never draw them.
    const members = new Set(categories.flatMap(category => category.clips))
    expect(events!.balance!.flat().filter(name => members.has(name))).toEqual([])
  })

  it('puts every menu action into one category and keeps the autonomous chain to idle and play', () => {
    const { categories } = builtin()
    expect(categories.map(category => category.id)).toEqual(['small', 'play', 'interact', 'eat', 'rest', 'work', 'move'])
    expect(categories.find(category => category.id === 'move')?.clips).toEqual(['swim', 'crab_walk', 'float_step', 'turn_run'])
    expect(categories.filter(category => category.life.length > 0).map(category => [category.id, category.life]))
      .toEqual([['small', ['idle']], ['play', ['play']]])
    const members = categories.flatMap(category => category.clips)
    expect(new Set(members).size).toBe(members.length)
  })
})

describe('parsePetMotion', () => {
  it('accepts a minimal manifest without categories', () => {
    const result = parsePetMotion(minimal())
    expect(result.ok && result.manifest.categories).toEqual([])
  })

  it('reports every structural problem at once', () => {
    const result = parsePetMotion({
      formatVersion: 1, renderer: 'h264', width: 0, height: 1,
      clips: {
        Bad: { file: '../idle.webm', loop: 'yes', durationMs: 0, sha256: 'x', turn: 1, source: { kind: 'mystery' } },
        sheet: { file: 'assets/motion/sheet.webm', loop: false, durationMs: 1, sha256: SHA, sheet: { columns: 0 }, source: { kind: 'generated' } },
      },
    })
    expect(result.ok).toBe(false)
    expect(result.ok ? [] : result.errors).toEqual(expect.arrayContaining([
      'formatVersion must be 2', 'renderer must be vp9-alpha', 'width and height must be positive',
      'clip "Bad": name must be lowercase snake_case', 'clip "Bad": loop must be a boolean', 'clip "Bad": turn must be a boolean',
      'clip "Bad": unknown source kind "mystery"', 'clip "sheet": file must be a pack-relative assets/motion/*.png path',
    ]))
    expect(parsePetMotion([])).toEqual({ ok: false, errors: ['motion.json must be an object'] })
  })

  it('requires a full generation record for upstream and AI-video sources', () => {
    const upstream = { kind: 'dsh-pet-webm', repository: 'r', commit: 'abc', file: 'f', sha256: SHA, frameCount: 1, fps: 24, crop: [0, 0, 1, 1], generation: { tool: 't' } }
    const bad = parsePetMotion(minimal({}, { source: upstream }))
    expect(bad.ok ? [] : bad.errors).toEqual([
      'clip "idle": generation prompt must be inline text or a file section',
      'clip "idle": dsh-pet-webm source needs repository, full commit, file, SHA-256, frameCount, fps, and crop',
    ])
    const video = {
      kind: 'ai-video', file: 'storage://pet/idle-v1.mov', sha256: SHA, fps: 24,
      generation: { tool: 'Tool', model: 'v2', prompt: { text: 'Stand still' }, referenceSha256: SHA, seed: '42', date: '2026-10-18' },
    }
    const good = parsePetMotion(minimal({}, { source: video }))
    expect(good.ok && good.manifest.clips.idle?.source).toEqual(video)
    const wrongDate = parsePetMotion(minimal({}, { source: { ...video, generation: { ...video.generation, date: 'today' } } }))
    expect(wrongDate.ok ? [] : wrongDate.errors).toEqual(['clip "idle": generation date is malformed'])
  })

  it('checks measured travel and chain weights', () => {
    const travel = Array.from({ length: 4 }, (_, index) => index)
    const ok = parsePetMotion(minimal({ chain: { idle: 1, turn: 0, move: 2 } }, { frames: 4, move: { direction: 'left', travel, leadMs: 0, tailMs: 0 } }))
    expect(ok.ok && ok.manifest.clips.idle?.move?.travel).toEqual(travel)
    expect(ok.ok && ok.manifest.chain).toEqual({ idle: 1, turn: 0, move: 2 })
    const bad = parsePetMotion(minimal({ chain: { idle: -1 } }, { frames: 4, move: { direction: 'up', travel: [1, 2], leadMs: 0, tailMs: 0 } }))
    expect(bad.ok ? [] : bad.errors).toEqual([
      'clip "idle": move needs a direction, a travel entry per frame starting at 0, leadMs, and tailMs',
      'chain needs non-negative idle, turn, and move weights',
    ])
    const sprite = parsePetMotion(minimal({}, { move: { direction: 'left', travel: [0], leadMs: 0, tailMs: 0 } }))
    expect(sprite.ok ? [] : sprite.errors).toContain('clip "idle": move needs a video clip with frames')
  })

  it('checks event tiers and click areas against the known clips', () => {
    const tiers = (count: number): string[][] => Array.from({ length: count }, () => ['idle'])
    const ok = parsePetMotion(minimal({
      events: { balance: tiers(6), workStatus: tiers(6), whisper: ['idle'], statedIn: 'config' }, clicks: { head: ['idle'], tail: ['idle'] },
    }))
    expect(ok.ok && ok.manifest.events).toEqual({ balance: tiers(6), workStatus: tiers(6), whisper: ['idle'], statedIn: 'config' })
    expect(ok.ok && ok.manifest.clicks).toEqual({ head: ['idle'], tail: ['idle'] })
    const bad = parsePetMotion(minimal({
      events: { balance: tiers(5), workStatus: [...tiers(5), ['ghost']], whisper: [], chatter: [] }, clicks: { paw: ['idle'], body: ['ghost'] },
    }))
    expect(bad.ok ? [] : bad.errors).toEqual([
      'events has unknown entries: chatter',
      'event balance needs exactly 6 tiers',
      'event workStatus tier 5 names unknown clips: ghost',
      'event whisper must list clip names',
      'clicks: unknown body area "paw"',
      'clicks body names unknown clips: ghost',
    ])
    const malformed = parsePetMotion(minimal({ events: [], clicks: 'head' }))
    expect(malformed.ok ? [] : malformed.errors).toEqual(['events must be an object', 'clicks must be an object'])
  })

  it('checks categories: ids, labels, weights, life states, known clips, and single membership', () => {
    const label = { zh: '甲', en: 'A' }
    const result = parsePetMotion(minimal({
      categories: [
        { id: 'small', label, weight: 1, life: ['idle'], clips: ['idle'] },
        { id: 'small', label: { zh: '' }, weight: -1, life: ['rest'], clips: ['idle', 'ghost'] },
        { id: 'Bad' },
      ],
    }))
    expect(result.ok ? [] : result.errors).toEqual([
      'category "small" is listed twice', 'category "small": label needs non-empty zh and en', 'category "small": weight must be non-negative',
      'category "small": life must list idle and/or play', 'clip "idle" is in categories "small" and "small"', 'category "small": unknown clip "ghost"',
      'category 2: id must be lowercase kebab-case',
    ])
  })
})
