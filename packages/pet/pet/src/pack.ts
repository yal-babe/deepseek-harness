/**
 * Studio Pet pack format v2 (`pet.json`): the pure, browser-safe parser shared
 * by the Host dev-pack loader and the Client renderer. A pack is a directory
 * (`pet.json`, `lines.json`, `assets/`, `LICENSE`), not an npm plugin. This
 * runtime renders the `frames` renderer only; other renderers, missing
 * required slots, unsafe paths, and unmet engines are rejected so the caller
 * falls back to the built-in pack ("misconfiguration fails loud").
 */

/** Pack format this runtime reads. */
export const PET_PACK_FORMAT_VERSION = 2

/** Pet runtime version that `engines.petRuntime` is matched against. */
export const PET_RUNTIME_VERSION = '1.0.0'

/** Pet script API major that `engines.petApi` is matched against. */
export const PET_API_VERSION = '1.0.0'

/** Slots every character pack provides, directly or through `ref`. */
export const PET_PACK_REQUIRED_SLOTS = ['idle', 'thinking', 'working', 'waiting', 'success', 'error', 'dragging'] as const

/** A required animation slot. */
export type PetRequiredSlot = typeof PET_PACK_REQUIRED_SLOTS[number]

/** Slot a missing optional slot falls back to (design §5.1); slots without an entry play nothing when absent. */
export const PET_SLOT_FALLBACK: Readonly<Record<string, string>> = {
  thinking: 'idle',
  working: 'thinking',
  waiting: 'thinking',
  success: 'idle',
  error: 'idle',
  dragging: 'idle',
  landing: 'idle',
  talk: 'thinking',
  work_search: 'working',
  work_edit: 'working',
  work_command: 'working',
  work_test: 'working',
  work_tool: 'working',
  work_tidy: 'working',
  catch: 'waiting',
  sleep: 'idle',
  focus: 'working',
  celebrate_big: 'success',
}

const OPTIONAL_SLOTS = new Set([
  ...Object.keys(PET_SLOT_FALLBACK), 'sweat', 'head_pat', 'poke', 'tail', 'wake', 'hungry', 'eat_token',
  'greet_morning', 'greet_noon', 'greet_evening', 'greet_night', 'enter', 'exit',
])

/** Frame image extensions the `frames` renderer accepts. */
export const PET_PACK_IMAGE_EXTENSIONS = ['.webp', '.png'] as const

/** Localized display text; `en` is the fallback. */
export interface PetPackText {
  readonly zh?: string
  readonly en: string
}

/** A clip with its own frames, or a reference to another slot of the same pack. */
export type PetPackClip =
  | { readonly frames: readonly string[]; readonly loop: boolean }
  | { readonly ref: string }

/** Validated `pet.json` of a character pack. */
export interface PetPackManifest {
  readonly formatVersion: typeof PET_PACK_FORMAT_VERSION
  /** Lowercase id, e.g. `whaletail-maid`. */
  readonly id: string
  /** Semantic version, e.g. `1.0.0`. */
  readonly version: string
  readonly name: PetPackText
  readonly author: string
  readonly license: { readonly code: string; readonly assets: string; readonly source?: string }
  readonly engines: { readonly petRuntime: string; readonly petApi: string }
  readonly renderer: 'frames'
  /** Logical canvas in pixels and the anchor point that stands on the ground. */
  readonly canvas: { readonly width: number; readonly height: number; readonly anchor: readonly [number, number] }
  readonly fps: number
  readonly clips: Readonly<Record<string, PetPackClip>>
  /** Persona presets and the pack-relative lines table. */
  readonly persona?: { readonly presets: readonly string[]; readonly default: string; readonly lines: string }
}

/** Parse outcome; `errors` lists every problem found. */
export type PetPackResult =
  | { readonly ok: true; readonly pack: PetPackManifest }
  | { readonly ok: false; readonly errors: readonly string[] }

/** Frames of one resolved slot. */
export interface PetResolvedClip {
  readonly frames: readonly string[]
  readonly loop: boolean
}

/**
 * Whether a path stays inside the pack: relative, `/`-separated, without `.` or `..` segments.
 * @param path - path from `pet.json`.
 * @returns true for a safe pack-relative path.
 */
export function isPetPackPath(path: string): boolean {
  if (path.length === 0 || path.length > 260 || path.startsWith('/') || path.includes('\\') || path.includes(':')) return false
  return path.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..')
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/u

/**
 * Match a version against a caret range (`^1`, `^1.2`, `^1.2.3`), the only range form packs use.
 * @param range - range from `engines`.
 * @param version - runtime version `MAJOR.MINOR.PATCH`.
 * @returns whether the version satisfies the range; any other range form is unsatisfied.
 */
export function satisfiesCaret(range: string, version: string): boolean {
  const wanted = /^\^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/u.exec(range)
  const actual = SEMVER.exec(version)
  if (wanted === null || actual === null) return false
  const [, wantMajor, wantMinor = '0', wantPatch = '0'] = wanted
  const [, major, minor, patch] = actual
  if (Number(major) !== Number(wantMajor)) return false
  if (Number(minor) !== Number(wantMinor)) return Number(minor) > Number(wantMinor)
  return Number(patch) >= Number(wantPatch)
}

type Raw = Record<string, unknown>

function record(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isSlot(name: string): boolean {
  return (PET_PACK_REQUIRED_SLOTS as readonly string[]).includes(name) || OPTIONAL_SLOTS.has(name) || /^idle_micro_[a-z0-9_]+$/u.test(name)
}

function parseClip(name: string, value: unknown, errors: string[]): PetPackClip | undefined {
  if (!record(value)) {
    errors.push(`clips.${name} must be an object`)
    return undefined
  }
  if (value.ref !== undefined) {
    if (!text(value.ref)) errors.push(`clips.${name}.ref must name a slot`)
    else return { ref: value.ref }
    return undefined
  }
  const frames = value.frames
  if (!Array.isArray(frames) || frames.length === 0) {
    errors.push(`clips.${name}.frames must list at least one image`)
    return undefined
  }
  const bad = frames.filter(frame => typeof frame !== 'string' || !isPetPackPath(frame)
    || !PET_PACK_IMAGE_EXTENSIONS.some(extension => frame.toLowerCase().endsWith(extension)))
  if (bad.length > 0) {
    errors.push(`clips.${name}.frames has unsafe or unsupported paths: ${bad.map(String).join(', ')}`)
    return undefined
  }
  if (typeof value.loop !== 'boolean') {
    errors.push(`clips.${name}.loop must be true or false`)
    return undefined
  }
  return { frames: frames as string[], loop: value.loop }
}

function checkRefs(clips: Readonly<Record<string, PetPackClip>>, errors: string[]): void {
  for (const start of Object.keys(clips)) {
    const seen = new Set<string>()
    let current = start
    for (;;) {
      const clip = clips[current]
      if (clip === undefined) {
        errors.push(`clips.${start} refers to the missing slot ${current}`)
        break
      }
      if (!('ref' in clip)) break
      if (seen.has(current)) {
        errors.push(`clips.${start} has a reference cycle`)
        break
      }
      seen.add(current)
      current = clip.ref
    }
  }
}

function parsePersona(value: unknown, errors: string[]): PetPackManifest['persona'] {
  if (value === undefined) return undefined
  if (!record(value) || !Array.isArray(value.presets) || !value.presets.every(text) || !text(value.default)
    || !value.presets.includes(value.default) || !text(value.lines) || !isPetPackPath(value.lines)) {
    errors.push('persona must list presets, name one of them as default, and give a pack-relative lines file')
    return undefined
  }
  return { presets: value.presets, default: value.default, lines: value.lines }
}

/**
 * Validate a parsed `pet.json`.
 * @param value - JSON value of the manifest.
 * @returns the manifest, or every problem found.
 */
export function parsePetPack(value: unknown): PetPackResult {
  if (!record(value)) return { ok: false, errors: ['pet.json must be a JSON object'] }
  const errors: string[] = []
  if (value.formatVersion !== PET_PACK_FORMAT_VERSION) errors.push(`formatVersion must be ${String(PET_PACK_FORMAT_VERSION)}`)
  if (value.kind !== undefined && value.kind !== 'character') errors.push('only character packs are supported')
  const id = typeof value.id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/u.test(value.id) ? value.id : undefined
  if (id === undefined) errors.push('id must be lowercase letters, digits, and hyphens')
  const version = typeof value.version === 'string' && SEMVER.test(value.version) ? value.version : undefined
  if (version === undefined) errors.push('version must be MAJOR.MINOR.PATCH')
  const name = record(value.name) && text(value.name.en) && (value.name.zh === undefined || text(value.name.zh))
    ? { en: value.name.en, ...text(value.name.zh) ? { zh: value.name.zh } : {} } : undefined
  if (name === undefined) errors.push('name must give at least an en string')
  if (!text(value.author)) errors.push('author must be a string')
  const license = record(value.license) && text(value.license.code) && text(value.license.assets)
    && (value.license.source === undefined || text(value.license.source))
    ? { code: value.license.code, assets: value.license.assets, ...text(value.license.source) ? { source: value.license.source } : {} }
    : undefined
  if (license === undefined) errors.push('license must give code and assets')
  const engines = record(value.engines) && text(value.engines.petRuntime) && text(value.engines.petApi)
    ? { petRuntime: value.engines.petRuntime, petApi: value.engines.petApi } : undefined
  if (engines === undefined) errors.push('engines must give petRuntime and petApi')
  else {
    if (!satisfiesCaret(engines.petRuntime, PET_RUNTIME_VERSION)) errors.push(`engines.petRuntime ${engines.petRuntime} does not accept ${PET_RUNTIME_VERSION}`)
    if (!satisfiesCaret(engines.petApi, PET_API_VERSION)) errors.push(`engines.petApi ${engines.petApi} does not accept ${PET_API_VERSION}`)
  }
  if (value.renderer !== 'frames') errors.push(`renderer ${String(value.renderer)} is not supported; this runtime renders frames`)
  const canvas = value.canvas
  const size = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= 4096
  const anchor = record(canvas) && Array.isArray(canvas.anchor) && canvas.anchor.length === 2
    && canvas.anchor.every(n => typeof n === 'number' && Number.isFinite(n)) ? canvas.anchor as [number, number] : undefined
  if (!record(canvas) || !size(canvas.width) || !size(canvas.height) || anchor === undefined) {
    errors.push('canvas must give width and height up to 4096 and an [x, y] anchor')
  }
  const fps = typeof value.fps === 'number' && value.fps > 0 && value.fps <= 60 ? value.fps : undefined
  if (fps === undefined) errors.push('fps must be between 0 and 60')
  const clips: Record<string, PetPackClip> = {}
  if (!record(value.clips)) errors.push('clips must be an object')
  else {
    for (const [slot, raw] of Object.entries(value.clips)) {
      if (!isSlot(slot)) {
        errors.push(`clips.${slot} is not a known slot`)
        continue
      }
      const clip = parseClip(slot, raw, errors)
      if (clip !== undefined) clips[slot] = clip
    }
    for (const slot of PET_PACK_REQUIRED_SLOTS) {
      if (!(slot in value.clips)) errors.push(`clips.${slot} is required`)
    }
    checkRefs(clips, errors)
  }
  const persona = parsePersona(value.persona, errors)
  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    pack: {
      formatVersion: PET_PACK_FORMAT_VERSION,
      id: id as string, version: version as string, name: name as PetPackText, author: value.author as string,
      license: license as PetPackManifest['license'], engines: engines as PetPackManifest['engines'],
      renderer: 'frames',
      canvas: { width: (canvas as Raw).width as number, height: (canvas as Raw).height as number, anchor: anchor as [number, number] },
      fps: fps as number,
      clips,
      ...persona === undefined ? {} : { persona },
    },
  }
}

/**
 * Frames for a slot: follow `ref`, then the §5.1 fallback chain, ending at `idle`.
 * @param pack - validated manifest.
 * @param slot - wanted slot.
 * @returns the clip to play; a valid pack always resolves.
 */
export function resolvePetClip(pack: PetPackManifest, slot: string): PetResolvedClip {
  let current = slot
  for (;;) {
    const clip = pack.clips[current]
    if (clip !== undefined) {
      if ('ref' in clip) current = clip.ref
      else return clip
    } else current = PET_SLOT_FALLBACK[current] ?? 'idle'
  }
}

/**
 * Every pack-relative file the manifest names, for loaders that read or check them.
 * @param pack - validated manifest.
 * @returns unique paths in manifest order.
 */
export function petPackFiles(pack: PetPackManifest): readonly string[] {
  const files = new Set<string>()
  for (const clip of Object.values(pack.clips)) if ('frames' in clip) for (const frame of clip.frames) files.add(frame)
  return [...files]
}
