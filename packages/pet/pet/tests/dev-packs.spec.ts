import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadPetDevPacks, PET_DEV_PACK_MAX_FILE_BYTES, petDevPackDirectory } from '../src/dev-packs.ts'
import { PET_PACK_REQUIRED_SLOTS } from '../src/pack.ts'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'pet-dev-packs-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

async function pack(name: string, edit: (manifest: Record<string, unknown>) => void = () => {}, files = true): Promise<string> {
  const dir = join(root, name)
  await mkdir(join(dir, 'assets'), { recursive: true })
  const clips: Record<string, unknown> = {}
  for (const slot of PET_PACK_REQUIRED_SLOTS) clips[slot] = { frames: [slot === 'dragging' ? 'assets/a.PNG' : 'assets/a.webp'], loop: true }
  const manifest: Record<string, unknown> = {
    formatVersion: 2, id: name, version: '0.1.0', name: { en: name }, author: 'dev', license: { code: 'MIT', assets: 'MIT' },
    engines: { petRuntime: '^1', petApi: '^1' }, renderer: 'frames', canvas: { width: 10, height: 10, anchor: [5, 9] }, fps: 8, clips,
  }
  edit(manifest)
  await writeFile(join(dir, 'pet.json'), JSON.stringify(manifest))
  if (files) {
    await writeFile(join(dir, 'assets', 'a.webp'), Buffer.from('RIFF'))
    await writeFile(join(dir, 'assets', 'a.PNG'), Buffer.from('PNG'))
  }
  return dir
}

const env = (dir: string) => ({ DSH_PET_DEV: '1', DSH_PET_DEV_PACKS: dir })

describe('petDevPackDirectory', () => {
  it('needs both variables', () => {
    expect(petDevPackDirectory({})).toBeUndefined()
    expect(petDevPackDirectory({ DSH_PET_DEV: '1' })).toBeUndefined()
    expect(petDevPackDirectory({ DSH_PET_DEV: '1', DSH_PET_DEV_PACKS: '' })).toBeUndefined()
    expect(petDevPackDirectory({ DSH_PET_DEV: 'true', DSH_PET_DEV_PACKS: '/x' })).toBeUndefined()
    expect(petDevPackDirectory(env('/x'))).toBe('/x')
  })
})

describe('loadPetDevPacks', () => {
  it('offers nothing when the switch is off', async () => {
    expect(await loadPetDevPacks({})).toEqual({ pack: null, problems: [] })
  })

  it('loads the first valid pack with frames as data URLs and reports skipped ones', async () => {
    await pack('a-broken', (manifest) => { manifest.renderer = 'live2d' })
    await pack('b-good')
    await pack('c-later')
    await writeFile(join(root, 'stray.txt'), 'not a pack')
    const state = await loadPetDevPacks(env(root))
    expect(state.pack?.manifest.id).toBe('b-good')
    expect(state.pack?.dev).toBe(true)
    expect(state.pack?.assets).toEqual({
      'assets/a.webp': `data:image/webp;base64,${Buffer.from('RIFF').toString('base64')}`,
      'assets/a.PNG': `data:image/png;base64,${Buffer.from('PNG').toString('base64')}`,
    })
    expect(state.problems).toEqual(['a-broken: renderer live2d is not supported; this runtime renders frames'])
  })

  it('rejects unreadable manifests, missing or escaping files, and oversized frames', async () => {
    await mkdir(join(root, 'a-nojson'))
    await pack('b-missing', () => {}, false)
    const escape = await pack('c-escape', () => {}, false)
    await writeFile(join(root, 'outside.webp'), 'x')
    await symlink(join(root, 'outside.webp'), join(escape, 'assets', 'a.webp'))
    const big = await pack('d-big')
    await writeFile(join(big, 'assets', 'a.webp'), Buffer.alloc(PET_DEV_PACK_MAX_FILE_BYTES + 1))
    const state = await loadPetDevPacks(env(root))
    expect(state.pack).toBeNull()
    expect(state.problems).toEqual([
      expect.stringMatching(/^a-nojson: pet\.json unreadable: /u),
      'b-missing: assets/a.webp is missing or outside the pack',
      'c-escape: assets/a.webp is missing or outside the pack',
      `d-big: assets/a.webp exceeds ${String(PET_DEV_PACK_MAX_FILE_BYTES)} bytes`,
    ])
  })

  it('caps the total frame size of a pack', async () => {
    const dir = await pack('many', (manifest) => {
      const clips = manifest.clips as Record<string, { frames: string[] }>
      clips.idle!.frames = Array.from({ length: 8 }, (_, index) => `assets/f${String(index)}.webp`)
    })
    for (let index = 0; index < 8; index += 1) await writeFile(join(dir, 'assets', `f${String(index)}.webp`), Buffer.alloc(PET_DEV_PACK_MAX_FILE_BYTES))
    const state = await loadPetDevPacks(env(root))
    expect(state.problems).toEqual(['many: frames exceed 31457280 bytes in total'])
  })

  it('reports a missing or empty directory', async () => {
    expect((await loadPetDevPacks(env(join(root, 'nope')))).problems).toEqual([expect.stringContaining('nope: ENOENT')])
    expect((await loadPetDevPacks(env(root))).problems).toEqual([`${root}: no pack directories`])
  })
})
