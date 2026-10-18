/**
 * Team-internal development switch for local pet packs (design §5.6 ③):
 * `DSH_PET_DEV=1` with `DSH_PET_DEV_PACKS=<dir>` loads character packs from the
 * subdirectories of `<dir>` without signatures and marks them as development
 * packs. The first valid pack by directory name is used; invalid packs are
 * reported and skipped, so the Client keeps the built-in pack.
 */
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { extname, join, sep } from 'node:path'
import { parsePetLines } from './lines.ts'
import { parsePetPack, petPackFiles } from './pack.ts'
import type { PetPackState, PetPackView } from './types.ts'

/** Largest frame image a development pack may ship, in bytes. */
export const PET_DEV_PACK_MAX_FILE_BYTES = 4 * 1024 * 1024

/** Largest total of frame images in one development pack, in bytes. */
export const PET_DEV_PACK_MAX_TOTAL_BYTES = 30 * 1024 * 1024

/** Environment variables the switch reads. */
export interface PetDevPackEnv {
  readonly DSH_PET_DEV?: string | undefined
  readonly DSH_PET_DEV_PACKS?: string | undefined
}

/**
 * Directory of development packs when the switch is on.
 * @param env - process environment.
 * @returns the directory, or `undefined` when development packs are off.
 */
export function petDevPackDirectory(env: PetDevPackEnv): string | undefined {
  const dir = env.DSH_PET_DEV_PACKS
  return env.DSH_PET_DEV === '1' && dir !== undefined && dir.length > 0 ? dir : undefined
}

async function loadPack(root: string): Promise<PetPackView> {
  const manifestPath = join(root, 'pet.json')
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(`pet.json unreadable: ${(error as Error).message}`, { cause: error })
  }
  const parsed = parsePetPack(raw)
  if (!parsed.ok) throw new Error(parsed.errors.join('; '))
  const realRoot = await realpath(root)
  const assets: Record<string, string> = {}
  let total = 0
  for (const file of petPackFiles(parsed.pack)) {
    const real = await realpath(join(root, ...file.split('/'))).catch(() => undefined)
    if (real === undefined || !real.startsWith(realRoot + sep)) throw new Error(`${file} is missing or outside the pack`)
    const { size } = await stat(real)
    if (size > PET_DEV_PACK_MAX_FILE_BYTES) throw new Error(`${file} exceeds ${String(PET_DEV_PACK_MAX_FILE_BYTES)} bytes`)
    total += size
    if (total > PET_DEV_PACK_MAX_TOTAL_BYTES) throw new Error(`frames exceed ${String(PET_DEV_PACK_MAX_TOTAL_BYTES)} bytes in total`)
    // The parser admits only .webp and .png frames.
    const type = extname(file).toLowerCase() === '.png' ? 'image/png' : 'image/webp'
    assets[file] = `data:${type};base64,${(await readFile(real)).toString('base64')}`
  }
  const linesFile = parsed.pack.persona?.lines
  if (linesFile === undefined) return { manifest: parsed.pack, assets, dev: true }
  const real = await realpath(join(root, ...linesFile.split('/'))).catch(() => undefined)
  if (real === undefined || !real.startsWith(realRoot + sep)) throw new Error(`${linesFile} is missing or outside the pack`)
  if ((await stat(real)).size > PET_DEV_PACK_MAX_FILE_BYTES) throw new Error(`${linesFile} exceeds ${String(PET_DEV_PACK_MAX_FILE_BYTES)} bytes`)
  let rawLines: unknown
  try {
    rawLines = JSON.parse(await readFile(real, 'utf8'))
  } catch (error) {
    throw new Error(`${linesFile} unreadable: ${(error as Error).message}`, { cause: error })
  }
  const lines = parsePetLines(rawLines)
  if (!lines.ok) throw new Error(`${linesFile}: ${lines.errors.join('; ')}`)
  return { manifest: parsed.pack, assets, dev: true, lines: lines.table }
}

/**
 * Load the first valid development pack.
 * @param env - process environment.
 * @returns the active pack (or `null`) and one problem line per skipped directory.
 */
export async function loadPetDevPacks(env: PetDevPackEnv): Promise<PetPackState> {
  const dir = petDevPackDirectory(env)
  if (dir === undefined) return { pack: null, problems: [] }
  let names: string[]
  try {
    names = (await readdir(dir, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  } catch (error) {
    return { pack: null, problems: [`${dir}: ${(error as Error).message}`] }
  }
  const problems: string[] = []
  for (const name of names) {
    try {
      return { pack: await loadPack(join(dir, name)), problems }
    } catch (error) {
      problems.push(`${name}: ${(error as Error).message}`)
    }
  }
  if (names.length === 0) problems.push(`${dir}: no pack directories`)
  return { pack: null, problems }
}
