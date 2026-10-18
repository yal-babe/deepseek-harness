/**
 * Validated media description of a pack (`motion.json`, format version 2):
 * playable clips, the categories the weighted animation chain and the action
 * menu draw from, and where every clip came from. Browser-safe and pure; the
 * Host reads the shipped file through it before serving any media.
 *
 * Source records distinguish four producers, each owned by one import tool so
 * that no tool rewrites another's clips:
 * - no `kind`: frames re-encoded from dsh-dafeiyu (`tools/import-motion.py`);
 * - `generated`: generated sprite sheets (`tools/import-generated-motion.py`);
 * - `dsh-pet-webm`: transparent clips of PC2005-cloud/dsh-pet, cropped and
 *   re-encoded (`tools/import-dshpet-webm.py`);
 * - `ai-video`: clips produced by an AI-video pipeline from a green-screen
 *   source, with the generation record the pipeline requires.
 */
import { isPetPackPath } from './pack.ts'

/** Localized text carried by the pack itself. */
export interface PetMotionText {
  readonly zh: string
  readonly en: string
}

/** How an AI video was generated: tool, prompt, and the inputs needed to reproduce or audit it. */
export interface PetMotionGeneration {
  /** Video generation tool, as named by whoever generated the clip. */
  readonly tool: string
  /** Model or version, when known. */
  readonly model?: string
  /** Prompt: inline text, or a section of a prompt file pinned by digest. */
  readonly prompt: { readonly text: string } | { readonly file: string; readonly section: string; readonly sha256?: string }
  /** SHA-256 of the reference image, when one was used. */
  readonly referenceSha256?: string
  /** Seed, when the tool reports one. */
  readonly seed?: string
  /** Generation date (`YYYY-MM-DD`), when known. */
  readonly date?: string
  /** How the green screen was removed, such as manual keying or HSV chroma keying. */
  readonly keying?: string
  /** Where the facts above are stated, when they come from a third party. */
  readonly statedIn?: string
}

/** Where one clip came from. Unknown producers are rejected. */
export type PetMotionSource =
  | { readonly kind?: undefined; readonly file: string; readonly sha256: string; readonly [key: string]: unknown }
  | { readonly kind: 'generated'; readonly [key: string]: unknown }
  | {
    readonly kind: 'dsh-pet-webm'
    /** Upstream repository. */
    readonly repository: string
    /** Full upstream commit the source file was read at. */
    readonly commit: string
    /** Repository-relative source path. */
    readonly file: string
    /** SHA-256 of the source file. */
    readonly sha256: string
    /** Source frames encoded. */
    readonly frameCount: number
    /** Source frame rate. */
    readonly fps: number
    /** Shared crop window `[x, y, width, height]` in source pixels. */
    readonly crop: readonly [number, number, number, number]
    /** Generation record of the upstream clip, as stated upstream. */
    readonly generation: PetMotionGeneration
  }
  | {
    readonly kind: 'ai-video'
    /** Source video (green screen or keyed master): a pack-external path or storage reference. */
    readonly file: string
    /** SHA-256 of the source video. */
    readonly sha256: string
    /** Source frame rate. */
    readonly fps: number
    /** Shared crop window `[x, y, width, height]`, when one was applied. */
    readonly crop?: readonly [number, number, number, number]
    /** Generation record. */
    readonly generation: PetMotionGeneration
  }

/** One playable clip. */
export interface PetMotionEntry {
  /** Pack-relative media path (`.webm` or sprite `.png`). */
  readonly file: string
  readonly loop: boolean
  readonly durationMs: number
  /** Frames played. */
  readonly frames?: number
  /** SHA-256 of the media file; versions the media URL. */
  readonly sha256: string
  readonly sheet?: { readonly columns: number; readonly rows: number; readonly frames: number; readonly startFrame?: number }
  /** The clip ends facing the other way; the character keeps the new facing. */
  readonly turn?: boolean
  /** `false` when the clip must never be mirrored, such as clips with text. */
  readonly mirror?: boolean
  /** Menu name when no Client dictionary names the clip. */
  readonly label?: PetMotionText
  readonly source: PetMotionSource
}

/** One category of the weighted animation chain and the action menu. */
export interface PetMotionCategory {
  readonly id: string
  readonly label: PetMotionText
  /** Relative chance among the categories eligible for the current life state. */
  readonly weight: number
  /** Life states whose autonomous chain draws from this category; empty means menu only. */
  readonly life: readonly ('idle' | 'play')[]
  /** Clip names, in menu order. A clip belongs to at most one category. */
  readonly clips: readonly string[]
}

/** Validated `motion.json`. */
export interface PetMotionManifest {
  readonly formatVersion: 2
  readonly renderer: 'vp9-alpha'
  readonly width: number
  readonly height: number
  readonly clips: Readonly<Record<string, PetMotionEntry>>
  readonly categories: readonly PetMotionCategory[]
}

/** Result of {@link parsePetMotion}: the manifest, or every problem found. */
export type PetMotionParseResult =
  | { readonly ok: true; readonly manifest: PetMotionManifest }
  | { readonly ok: false; readonly errors: readonly string[] }

type Raw = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/u
const COMMIT = /^[0-9a-f]{40}$/u
const NAME = /^[a-z][a-z0-9_]*$/u
const CATEGORY = /^[a-z][a-z0-9-]*$/u
const DATE = /^\d{4}-\d{2}-\d{2}$/u

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function localized(value: unknown): PetMotionText | undefined {
  return isRecord(value) && isText(value['zh']) && isText(value['en']) ? { zh: value['zh'], en: value['en'] } : undefined
}

function crop(value: unknown): readonly [number, number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(count)) return undefined
  const [x, y, width, height] = value as [number, number, number, number]
  return width > 0 && height > 0 ? [x, y, width, height] : undefined
}

function generation(value: unknown, where: string, errors: string[]): PetMotionGeneration | undefined {
  if (!isRecord(value) || !isText(value['tool'])) {
    errors.push(`${where}: generation must name the tool`)
    return undefined
  }
  const prompt = value['prompt']
  let parsedPrompt: PetMotionGeneration['prompt'] | undefined
  if (isRecord(prompt) && isText(prompt['text'])) parsedPrompt = { text: prompt['text'] }
  else if (isRecord(prompt) && isText(prompt['file']) && isText(prompt['section'])
    && (prompt['sha256'] === undefined || (typeof prompt['sha256'] === 'string' && SHA256.test(prompt['sha256'])))) {
    parsedPrompt = { file: prompt['file'], section: prompt['section'], ...typeof prompt['sha256'] === 'string' ? { sha256: prompt['sha256'] } : {} }
  }
  if (parsedPrompt === undefined) errors.push(`${where}: generation prompt must be inline text or a file section`)
  const optional = (key: string, check: (text: string) => boolean = () => true): string | undefined => {
    const field = value[key]
    if (field === undefined) return undefined
    if (isText(field) && check(field)) return field
    errors.push(`${where}: generation ${key} is malformed`)
    return undefined
  }
  const model = optional('model')
  const referenceSha256 = optional('referenceSha256', text => SHA256.test(text))
  const seed = optional('seed')
  const date = optional('date', text => DATE.test(text))
  const keying = optional('keying')
  const statedIn = optional('statedIn')
  if (parsedPrompt === undefined) return undefined
  return {
    tool: value['tool'], prompt: parsedPrompt,
    ...model === undefined ? {} : { model },
    ...referenceSha256 === undefined ? {} : { referenceSha256 },
    ...seed === undefined ? {} : { seed },
    ...date === undefined ? {} : { date },
    ...keying === undefined ? {} : { keying },
    ...statedIn === undefined ? {} : { statedIn },
  }
}

function source(value: unknown, where: string, errors: string[]): PetMotionSource | undefined {
  if (!isRecord(value)) {
    errors.push(`${where}: source record is required`)
    return undefined
  }
  const kind = value['kind']
  if (kind === undefined) {
    if (isText(value['file']) && typeof value['sha256'] === 'string' && SHA256.test(value['sha256'])) {
      return { ...value, kind: undefined, file: value['file'], sha256: value['sha256'] }
    }
    errors.push(`${where}: imported source must record the source file and its SHA-256`)
    return undefined
  }
  if (kind === 'generated') return { ...value, kind }
  if (kind === 'dsh-pet-webm') {
    const window = crop(value['crop'])
    const record = generation(value['generation'], where, errors)
    const valid = isText(value['repository']) && typeof value['commit'] === 'string' && COMMIT.test(value['commit'])
      && isText(value['file']) && typeof value['sha256'] === 'string' && SHA256.test(value['sha256'])
      && count(value['frameCount']) && positive(value['fps']) && window !== undefined
    if (!valid) errors.push(`${where}: dsh-pet-webm source needs repository, full commit, file, SHA-256, frameCount, fps, and crop`)
    if (!valid || record === undefined || window === undefined) return undefined
    return {
      kind, repository: value['repository'] as string, commit: value['commit'] as string, file: value['file'] as string,
      sha256: value['sha256'] as string, frameCount: value['frameCount'] as number, fps: value['fps'] as number, crop: window, generation: record,
    }
  }
  if (kind === 'ai-video') {
    const record = generation(value['generation'], where, errors)
    const window = value['crop'] === undefined ? undefined : crop(value['crop'])
    const valid = isText(value['file']) && typeof value['sha256'] === 'string' && SHA256.test(value['sha256']) && positive(value['fps'])
      && (value['crop'] === undefined || window !== undefined)
    if (!valid) errors.push(`${where}: ai-video source needs file, SHA-256, fps, and a valid crop when present`)
    if (!valid || record === undefined) return undefined
    return {
      kind, file: value['file'] as string, sha256: value['sha256'] as string, fps: value['fps'] as number,
      ...window === undefined ? {} : { crop: window }, generation: record,
    }
  }
  errors.push(`${where}: unknown source kind ${JSON.stringify(kind)}`)
  return undefined
}

function sheet(value: unknown): PetMotionEntry['sheet'] | 'invalid' | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value) || !positive(value['columns']) || !positive(value['rows']) || !positive(value['frames'])
    || (value['startFrame'] !== undefined && !count(value['startFrame']))) return 'invalid'
  const start = value['startFrame']
  return {
    columns: value['columns'], rows: value['rows'], frames: value['frames'],
    ...typeof start === 'number' ? { startFrame: start } : {},
  }
}

function clip(name: string, value: unknown, errors: string[]): PetMotionEntry | undefined {
  const where = `clip "${name}"`
  if (!NAME.test(name)) errors.push(`${where}: name must be lowercase snake_case`)
  if (!isRecord(value)) {
    errors.push(`${where}: must be an object`)
    return undefined
  }
  const file = value['file']
  const parsedSheet = sheet(value['sheet'])
  const extension = parsedSheet === undefined ? '.webm' : '.png'
  if (typeof file !== 'string' || !isPetPackPath(file) || !file.startsWith('assets/motion/') || !file.endsWith(extension)) {
    errors.push(`${where}: file must be a pack-relative assets/motion/*${extension} path`)
  }
  if (parsedSheet === 'invalid') errors.push(`${where}: sheet needs positive columns, rows, frames and a non-negative startFrame`)
  if (typeof value['loop'] !== 'boolean') errors.push(`${where}: loop must be a boolean`)
  if (!positive(value['durationMs'])) errors.push(`${where}: durationMs must be positive`)
  if (value['frames'] !== undefined && !positive(value['frames'])) errors.push(`${where}: frames must be positive`)
  if (typeof value['sha256'] !== 'string' || !SHA256.test(value['sha256'])) errors.push(`${where}: sha256 must be a lowercase SHA-256`)
  for (const key of ['turn', 'mirror'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') errors.push(`${where}: ${key} must be a boolean`)
  }
  const label = value['label'] === undefined ? undefined : localized(value['label'])
  if (value['label'] !== undefined && label === undefined) errors.push(`${where}: label needs non-empty zh and en`)
  const parsedSource = source(value['source'], where, errors)
  if (typeof file !== 'string' || parsedSheet === 'invalid' || parsedSource === undefined) return undefined
  return {
    file, loop: value['loop'] === true, durationMs: value['durationMs'] as number,
    ...positive(value['frames']) ? { frames: value['frames'] } : {},
    sha256: value['sha256'] as string,
    ...parsedSheet === undefined ? {} : { sheet: parsedSheet },
    ...value['turn'] === true ? { turn: true } : {},
    ...value['mirror'] === false ? { mirror: false } : {},
    ...label === undefined ? {} : { label },
    source: parsedSource,
  }
}

function categories(value: unknown, clips: Readonly<Record<string, PetMotionEntry>>, errors: string[]): PetMotionCategory[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    errors.push('categories must be an array')
    return []
  }
  const ids = new Set<string>()
  const owner = new Map<string, string>()
  const result: PetMotionCategory[] = []
  for (const [index, entry] of value.entries()) {
    const where = `category ${String(index)}`
    if (!isRecord(entry) || typeof entry['id'] !== 'string' || !CATEGORY.test(entry['id'])) {
      errors.push(`${where}: id must be lowercase kebab-case`)
      continue
    }
    const id = entry['id']
    if (ids.has(id)) errors.push(`category "${id}" is listed twice`)
    ids.add(id)
    const label = localized(entry['label'])
    if (label === undefined) errors.push(`category "${id}": label needs non-empty zh and en`)
    const weight = entry['weight']
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) errors.push(`category "${id}": weight must be non-negative`)
    const life = entry['life']
    const lifeValid = Array.isArray(life) && life.every(state => state === 'idle' || state === 'play')
    if (!lifeValid) errors.push(`category "${id}": life must list idle and/or play`)
    const members = entry['clips']
    if (!Array.isArray(members) || members.length === 0 || !members.every(name => typeof name === 'string')) {
      errors.push(`category "${id}": clips must list clip names`)
      continue
    }
    for (const name of members as string[]) {
      if (clips[name] === undefined) errors.push(`category "${id}": unknown clip "${name}"`)
      const previous = owner.get(name)
      if (previous !== undefined) errors.push(`clip "${name}" is in categories "${previous}" and "${id}"`)
      owner.set(name, id)
    }
    if (label !== undefined && typeof weight === 'number' && lifeValid) {
      result.push({ id, label, weight, life: life as ('idle' | 'play')[], clips: members as string[] })
    }
  }
  return result
}

/**
 * Validate a parsed `motion.json`.
 * @param value - JSON value read from a pack.
 * @returns the manifest, or all problems at once.
 */
export function parsePetMotion(value: unknown): PetMotionParseResult {
  if (!isRecord(value)) return { ok: false, errors: ['motion.json must be an object'] }
  const errors: string[] = []
  if (value['formatVersion'] !== 2) errors.push('formatVersion must be 2')
  if (value['renderer'] !== 'vp9-alpha') errors.push('renderer must be vp9-alpha')
  if (!positive(value['width']) || !positive(value['height'])) errors.push('width and height must be positive')
  const raw = value['clips']
  const clips: Record<string, PetMotionEntry> = {}
  if (!isRecord(raw) || Object.keys(raw).length === 0) errors.push('clips must name at least one clip')
  else {
    for (const [name, entry] of Object.entries(raw)) {
      const parsed = clip(name, entry, errors)
      if (parsed !== undefined) clips[name] = parsed
    }
  }
  const parsedCategories = categories(value['categories'], clips, errors)
  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    manifest: {
      formatVersion: 2, renderer: 'vp9-alpha', width: value['width'] as number, height: value['height'] as number,
      clips, categories: parsedCategories,
    },
  }
}
