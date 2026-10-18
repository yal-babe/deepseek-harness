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
    // Every upstream clip ships once: 92 through this importer (the nap split into four), the other 14 through import-motion.py.
    expect(imported).toHaveLength(94)
    const upstream = new Set(imported.map(([, clip]) => clip.source.file.split('/').at(-1)))
    const earlier = new Set(Object.values(builtin().clips).filter(clip => clip.source.kind === undefined).map(clip => clip.source.file))
    expect(upstream.size).toBe(92)
    expect(earlier.size).toBe(14)
    expect([...earlier].filter(file => upstream.has(file))).toEqual([])
    for (const [name, clip] of imported) {
      expect(clip.source, name).toMatchObject({
        repository: 'https://github.com/PC2005-cloud/dsh-pet', commit: UPSTREAM_COMMIT, crop: [100, 0, 412, 344], fps: 24,
        generation: { tool: '豆包 (Doubao)', prompt: { file: 'prompts/桌面宠物 10 秒动作提示词.md' } },
      })
      expect(clip.label, name).toBeDefined()
    }
    expect(builtin().clips.look_around?.turn).toBe(true)
  })

  it('splits the upstream nap into adjoining entry, loop, and wake frame windows', () => {
    const { clips } = builtin()
    const windows = ['doze_enter', 'doze_loop', 'doze_wake'].map((name) => {
      const source = clips[name]!.source
      return source.kind === 'dsh-pet-webm' ? { file: source.file, frames: source.frames, count: source.frameCount } : undefined
    })
    expect(windows.map(window => window?.frames)).toEqual([[0, 72], [72, 170], [170, 241]])
    expect(new Set(windows.map(window => window?.file)).size).toBe(1)
    expect(windows[0]?.count).toBe(241)
    expect(['doze_enter', 'doze_loop', 'doze_wake'].map(name => [clips[name]!.loop, clips[name]!.frames])).toEqual([[false, 72], [true, 98], [false, 71]])
    expect(clips.doze_startle?.source).toMatchObject({ frames: [60, 241] })
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
    expect(events?.whisper).toEqual(['whisper_wipe_desk', 'whisper_daydream', 'whisper_screen'])
    expect(clicks).toEqual({ head: ['head_pat', 'click_shy'], body: ['poke', 'click_bounce', 'click_huff'], tail: ['tail'] })
    // Event clips play on events only; the autonomous chain and the menu never draw them.
    const members = new Set(categories.flatMap(category => category.clips))
    expect(events!.balance!.flat().filter(name => members.has(name))).toEqual([])
  })

  it('puts every menu action into one category and keeps the autonomous chain to idle and play', () => {
    const { categories } = builtin()
    expect(categories.map(category => category.id)).toEqual(['small', 'play', 'dance', 'talent', 'games', 'interact', 'eat', 'festival', 'move'])
    expect(categories.find(category => category.id === 'move')?.clips).toEqual(['crab_walk', 'float_step'])
    expect(categories.find(category => category.id === 'small')?.clips.slice(0, 4)).toEqual(['idle_stretch', 'idle_yawn', 'look_around', 'whisper_daydream'])
    // Play draws the in-place video clips until AI-video play clips are added to the category.
    expect(categories.find(category => category.id === 'play')?.clips).toEqual(['click_bounce', 'click_huff', 'turn_run'])
    expect(categories.filter(category => category.life.length > 0).map(category => [category.id, category.life])).toEqual([
      ['small', ['idle']], ['play', ['play']], ['dance', ['idle', 'play']], ['talent', ['idle', 'play']], ['games', ['idle', 'play']],
      ['eat', ['idle', 'play']], ['festival', ['idle', 'play']],
    ])
    // Dances, talents, and games share one pause; meals and festivals have their own.
    const cooled = categories.filter(category => category.cooldown !== undefined)
    expect(Object.fromEntries(cooled.map(category => [category.id, category.cooldown])))
      .toEqual({
        dance: { group: 'fun', ms: 180000 }, talent: { group: 'fun', ms: 180000 }, games: { group: 'fun', ms: 180000 },
        eat: { group: 'eat', ms: 1200000 }, festival: { group: 'festival', ms: 600000 },
      })
    const members = categories.flatMap(category => category.clips)
    expect(new Set(members).size).toBe(members.length)
  })

  it('schedules every meal, snack, and festival clip, with the lunar festivals in their own rules', () => {
    const { categories, schedule, clips } = builtin()
    const scheduled = new Set(schedule?.rules.flatMap(rule => rule.clips))
    for (const id of ['eat', 'festival']) {
      expect(categories.find(category => category.id === id)?.clips.filter(clip => !scheduled.has(clip)), id).toEqual([])
    }
    const festivalOf = (clip: string): string[] =>
      schedule!.rules.filter(rule => rule.clips.includes(clip)).flatMap(rule => rule.festivals ?? [])
    expect(festivalOf('red_envelope')).toEqual(['spring-festival-eve', 'spring-festival'])
    expect(festivalOf('tangyuan')).toEqual(['lantern-festival'])
    expect(festivalOf('zongzi')).toEqual(['dragon-boat'])
    expect(festivalOf('needle_threading')).toEqual(['qixi'])
    expect(festivalOf('mooncake')).toEqual(['mid-autumn'])
    expect(festivalOf('chongyang_cake')).toEqual(['double-ninth'])
    expect(festivalOf('laba_porridge')).toEqual(['laba'])
    const hoursOf = (clip: string): unknown[] => schedule!.rules.filter(rule => rule.clips.includes(clip)).map(rule => rule.hours)
    expect(hoursOf('breakfast')).toEqual([[[7, 9]]])
    expect(hoursOf('lunch')).toEqual([[[11, 13]]])
    expect(hoursOf('dinner')).toEqual([[[17, 19]]])
    expect(hoursOf('snack_munch')).toEqual([[[15, 17], [21, 23]]])
    // Text in the artwork must not mirror.
    expect(['what_to_eat', 'write_fu', 'thinking_deep'].map(name => clips[name]?.mirror)).toEqual([false, false, false])
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
        sheet: { file: 'assets/motion/sheet.webm', loop: false, durationMs: 1, sha256: SHA, sheet: { columns: 0 }, source: { file: 'x', sha256: SHA } },
        retired: { file: 'assets/motion/retired.webm', loop: false, durationMs: 1, sha256: SHA, source: { kind: 'generated' } },
      },
    })
    expect(result.ok).toBe(false)
    expect(result.ok ? [] : result.errors).toEqual(expect.arrayContaining([
      'formatVersion must be 2', 'renderer must be vp9-alpha', 'width and height must be positive',
      'clip "Bad": name must be lowercase snake_case', 'clip "Bad": loop must be a boolean', 'clip "Bad": turn must be a boolean',
      'clip "Bad": unknown source kind "mystery"', 'clip "sheet": file must be a pack-relative assets/motion/*.png path',
      'clip "retired": unknown source kind "generated"',
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
    const phase = { ...upstream, commit: 'a'.repeat(40), frameCount: 241, generation: { tool: 't', prompt: { file: 'p.md', section: 's' } } }
    const split = parsePetMotion(minimal({}, { source: { ...phase, frames: [72, 170] } }))
    expect(split.ok && split.manifest.clips.idle?.source).toMatchObject({ frames: [72, 170] })
    for (const frames of [[170, 72], [0, 242], [1]]) {
      const wrong = parsePetMotion(minimal({}, { source: { ...phase, frames } }))
      expect(wrong.ok ? [] : wrong.errors).toEqual(['clip "idle": dsh-pet-webm frames must be [start, end) source frames within frameCount'])
    }
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

  it('checks schedule rules and category cooldowns', () => {
    const category = { id: 'eat', label: { zh: '吃', en: 'Eat' }, weight: 1, life: ['idle'], clips: ['idle'] }
    const accepted = parsePetMotion(minimal({
      categories: [{ ...category, cooldown: { group: 'eat', ms: 60000 } }],
      schedule: { statedIn: 'test', rules: [{ id: 'lunch', hours: [[11, 13]], months: [1, 12], festivals: ['mid-autumn'], clips: ['idle'] }] },
    }))
    expect(accepted.ok && accepted.manifest.schedule).toEqual({
      statedIn: 'test', rules: [{ id: 'lunch', hours: [[11, 13]], months: [1, 12], festivals: ['mid-autumn'], clips: ['idle'] }],
    })
    expect(accepted.ok && accepted.manifest.categories[0]?.cooldown).toEqual({ group: 'eat', ms: 60000 })
    const rejected = parsePetMotion(minimal({
      categories: [{ ...category, cooldown: { group: 'Eat', ms: 0 } }],
      schedule: { rules: [
        { id: 'Bad', clips: ['idle'], hours: [[9, 9]] },
        { id: 'late', hours: [[20, 25]], clips: ['idle'] },
        { id: 'month', months: [0], clips: ['idle'] },
        { id: 'feast', festivals: ['birthday'], clips: ['idle'] },
        { id: 'always', clips: ['idle'] },
        { id: 'ghost', months: [1], clips: ['missing'] },
      ] },
    }))
    expect(rejected.ok ? [] : rejected.errors).toEqual([
      'category "eat": cooldown needs a kebab-case group and positive ms',
      'schedule rule 0: id must be lowercase kebab-case',
      'schedule rule "late": hours must list [from, to) ranges within 0 to 24',
      'schedule rule "month": months must list months 1 to 12',
      'schedule rule "feast": festivals must name known festivals',
      'schedule rule "always" needs hours, months, or festivals',
      'schedule rule "ghost" clips names unknown clips: missing',
    ])
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
