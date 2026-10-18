/** Immutable built-in character media, delivered separately from the client bundle. */
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { parsePetPack } from './pack.ts'
import type { PetMotionClip, PetPackState } from './types.ts'

/** Host route serving only shipped character media. */
export const PET_MEDIA_PATH = '/pet-motion'
const root = new URL('../packs/whaletail-maid/', import.meta.url)

/** Read only the shipped manifest; request paths are never filesystem inputs.
 * @returns the pack description and allowlisted HTTP handler.
 */
export async function builtinAssets(): Promise<{
  pack: PetPackState
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
}> {
  const parsed = parsePetPack(JSON.parse(await readFile(new URL('pet.json', root), 'utf8')))
  if (!parsed.ok) throw new Error(`pet: invalid built-in pack: ${parsed.errors.join('; ')}`)
  const motion: {
    width: number
    height: number
    clips: Record<string, {
      file: string
      loop: boolean
      durationMs: number
      sha256?: string
      sheet?: { columns: number; rows: number; frames: number; startFrame?: number }
    }>
  } =
    JSON.parse(await readFile(new URL('motion.json', root), 'utf8'))
  const files = new Map<string, { readonly file: URL; readonly mediaType: string }>()
  const assets: Record<string, string> = {}
  for (const clip of Object.values(parsed.pack.clips)) {
    if (!('frames' in clip)) continue
    for (const path of clip.frames) {
      const url = `${PET_MEDIA_PATH}/frames/${path.split('/').at(-1)}`
      assets[path] = url
      files.set(url, { file: new URL(path, root), mediaType: 'image/webp' })
    }
  }
  const clips: Record<string, PetMotionClip> = {}
  for (const [name, clip] of Object.entries(motion.clips)) {
    const extension = clip.sheet === undefined ? 'webm' : 'png'
    const mediaPath = `${PET_MEDIA_PATH}/v1/${clip.file.split('/').at(-1) ?? `${name}.${extension}`}`
    const url = `${mediaPath}?v=${clip.sha256 ?? 'builtin'}`
    clips[name] = { url, loop: clip.loop, durationMs: clip.durationMs, ...clip.sheet === undefined ? {} : { sheet: clip.sheet } }
    files.set(mediaPath, { file: new URL(clip.file, root), mediaType: clip.sheet === undefined ? 'video/webm' : 'image/png' })
  }
  const pack: PetPackState = {
    pack: { manifest: parsed.pack, assets, dev: false, motion: { width: motion.width, height: motion.height, clips } },
    problems: [],
  }
  return {
    pack,
    /** Serve an allowlisted file, including HEAD and single byte ranges required by Chromium. */
    async handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return
      }
      const file = files.get(new URL(req.url ?? '/', 'http://pet.local').pathname)
      if (file === undefined) { res.writeHead(404); res.end(); return }
      const bytes = await readFile(file.file)
      const range = req.headers.range
      const headers = { 'content-type': file.mediaType, 'cache-control': 'public, max-age=86400', 'accept-ranges': 'bytes' }
      let start = 0
      let end = bytes.length - 1
      if (range !== undefined) {
        const match = /^bytes=(\d*)-(\d*)$/u.exec(range)
        if (match !== null && (match[1] !== '' || match[2] !== '')) {
          if (match[1] === '') start = Math.max(0, bytes.length - Number(match[2]))
          else {
            start = Number(match[1])
            if (match[2] !== '') end = Math.min(end, Number(match[2]))
          }
        } else start = bytes.length
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= bytes.length) {
          res.writeHead(416, { ...headers, 'content-range': `bytes */${bytes.length}` }); res.end(); return
        }
      }
      res.writeHead(range === undefined ? 200 : 206, {
        ...headers, 'content-length': end - start + 1,
        ...range === undefined ? {} : { 'content-range': `bytes ${start}-${end}/${bytes.length}` },
      })
      res.end(req.method === 'HEAD' ? undefined : bytes.subarray(start, end + 1))
    },
  }
}
