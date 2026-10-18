/** Real Loader YAML composition: route delivery, range requests and disposal. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import PetService from '../src/index.ts'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

describe('built-in motion in a Loader composition', () => {
  it('delivers media, rejects traversal and releases the pet route on disposal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pet-media-loader-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const ctx = new Context()
    cleanup.push(() => ctx.fiber.dispose())
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await writeFile(join(root, 'cordis.yml'), [
      '- name: cordis:pet-test-webserver', '  config:', '    host: 127.0.0.1', '    port: 0',
      '- name: cordis:pet-test-character', '',
    ].join('\n'))
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.builtins['pet-test-webserver'] = WebServer
    ctx.loader.builtins['pet-test-character'] = PetService
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(root, 'cordis.yml')).href } })
    await ctx.loader.await()
    const pack = await ctx.pet.pack()
    expect(pack.pack?.dev).toBe(false)
    const clips = pack.pack!.motion!.clips
    expect(Object.keys(clips)).toEqual(expect.arrayContaining([
      'bubbles', 'celebrate', 'nuzzle', 'sleep_enter', 'sleep_loop', 'sleep_wake',
      'idle_daydream', 'idle_observe', 'idle_groom', 'swim_start', 'swim_loop', 'swim_stop',
      'play_bubbles', 'play_ball', 'play_tailspin', 'work_read', 'thinking_chin', 'thinking_idea',
      'pillow_enter', 'pillow_loop', 'pillow_wake',
    ]))
    expect(clips.sleep_enter!.url).toBe(clips.sleep_loop!.url)
    expect(clips.sleep_loop!.url).toBe(clips.sleep_wake!.url)
    expect(clips.sleep_loop!.sheet?.startFrame).toBe(13)
    expect(clips.thinking_idea!.sheet?.startFrame).toBe(24)
    expect(new URL(clips.bubbles!.url, 'http://localhost').searchParams.get('v')).toMatch(/^[a-f0-9]{64}$/)
    const base = ctx.webServer.getOrigin()
    const url = base + clips.idle!.url
    const full = await fetch(url)
    expect(full.status).toBe(200)
    expect(full.headers.get('content-type')).toBe('video/webm')
    const bytes = new Uint8Array(await full.arrayBuffer())
    expect(bytes.length).toBeGreaterThan(1000)
    const partial = await fetch(url, { headers: { range: 'bytes=0-31' } })
    expect(partial.status).toBe(206)
    expect(new Uint8Array(await partial.arrayBuffer())).toEqual(bytes.slice(0, 32))
    const suffix = await fetch(url, { headers: { range: 'bytes=-16' } })
    expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(bytes.slice(-16))
    const head = await fetch(url, { method: 'HEAD' })
    expect(head.headers.get('content-length')).toBe(String(bytes.length))
    expect(await head.text()).toBe('')
    for (const range of ['bytes=999999999-', 'bytes=10-2', 'bytes=0-1,3-4', 'bytes=-0']) {
      expect((await fetch(url, { headers: { range } })).status).toBe(416)
    }
    expect((await fetch(url, { method: 'POST' })).status).toBe(405)
    expect((await fetch(base + '/pet-motion/v1/not-a-clip.webm')).status).toBe(404)
    expect((await fetch(base + '/pet-motion/%2e%2e/package.json')).status).toBe(404)
    // Every atlas must match its declared grid; ranged headers avoid downloading all media twice.
    const sprites = Object.values(clips).filter(clip => clip.sheet !== undefined)
    for (const clip of [...new Map(sprites.map(clip => [clip.url, clip])).values()]) {
      const sprite = await fetch(base + clip.url, { headers: { range: 'bytes=0-23' } })
      expect(sprite.status).toBe(206)
      expect(sprite.headers.get('content-type')).toBe('image/png')
      const header = new DataView(await sprite.arrayBuffer())
      expect(header.getUint32(0)).toBe(0x89504e47)
      expect(header.getUint32(16)).toBe(clip.sheet!.columns * 208)
      expect(header.getUint32(20)).toBe(clip.sheet!.rows * 208)
    }
    for (const clip of sprites) {
      expect((clip.sheet!.startFrame ?? 0) + clip.sheet!.frames).toBeLessThanOrEqual(clip.sheet!.columns * clip.sheet!.rows)
    }
    const petFiber = [...ctx.loader.entries()].find(entry => entry.options.name === 'cordis:pet-test-character')!.fiber!
    await petFiber.dispose()
    expect((await fetch(url)).status).toBe(404)
  })
})
