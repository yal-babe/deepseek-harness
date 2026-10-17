/**
 * Character frames of the pet. The built-in pack `whaletail-maid@1.0.0` lives
 * in `@deepseek-ai/dsh-pet/packs/whaletail-maid` (MIT, Copyright (c) 2026
 * PC2005-cloud; see its LICENSE); its `pet.json` is validated here like any
 * other pack, and its frames are bundled as data URLs. A development pack the
 * Host offers replaces it at runtime.
 */
import type { PetAgentState, PetPackState, PetMotionView } from '@deepseek-ai/dsh-pet/types'
import { parsePetPack, resolvePetClip, type PetPackManifest, type PetPackText } from '@deepseek-ai/dsh-pet/pack'
import builtinManifest from '@deepseek-ai/dsh-pet/packs/whaletail-maid/pet.json'
import idle1 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/idle-1.webp'
import idle2 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/idle-2.webp'
import idle3 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/idle-3.webp'
import idle4 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/idle-4.webp'
import idle5 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/idle-5.webp'
import idle6 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/idle-6.webp'
import thinking1 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/thinking-1.webp'
import thinking2 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/thinking-2.webp'
import thinking3 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/thinking-3.webp'
import thinking4 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/thinking-4.webp'
import thinking5 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/thinking-5.webp'
import thinking6 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/thinking-6.webp'
import working1 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/working-1.webp'
import working2 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/working-2.webp'
import working3 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/working-3.webp'
import working4 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/working-4.webp'
import working5 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/working-5.webp'
import working6 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/working-6.webp'
import waiting1 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/waiting-1.webp'
import waiting2 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/waiting-2.webp'
import waiting3 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/waiting-3.webp'
import waiting4 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/waiting-4.webp'
import waiting5 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/waiting-5.webp'
import waiting6 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/waiting-6.webp'
import success1 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/success-1.webp'
import success2 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/success-2.webp'
import success3 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/success-3.webp'
import success4 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/success-4.webp'
import success5 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/success-5.webp'
import success6 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/success-6.webp'
import error1 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/error-1.webp'
import error2 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/error-2.webp'
import error3 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/error-3.webp'
import error4 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/error-4.webp'
import error5 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/error-5.webp'
import error6 from '@deepseek-ai/dsh-pet/packs/whaletail-maid/assets/frames/error-6.webp'

/** Animation clips the character plays. */
export type PetClip = 'idle' | 'thinking' | 'working' | 'waiting' | 'success' | 'error'

const CLIPS: readonly PetClip[] = ['idle', 'thinking', 'working', 'waiting', 'success', 'error']

/** Frames, timing, and identity of the pack the character renders. */
export interface PetFrameSet {
  /** Pack id and version, e.g. `whaletail-maid@1.0.0`. */
  readonly key: string
  readonly name: PetPackText
  readonly fps: number
  /** Image URL lists per clip. */
  readonly frames: Readonly<Record<PetClip, readonly string[]>>
  /** Unsigned development pack; the character shows a marker. */
  readonly motion?: PetMotionView
  readonly loops?: Readonly<Record<PetClip, boolean>>
  readonly dev: boolean
}

/**
 * Build the frame set of a validated pack.
 * @param manifest - validated `pet.json`.
 * @param assets - image URL per pack-relative path.
 * @param dev - whether the pack came through the development switch.
 * @returns the frame set.
 * @throws Error when a frame the manifest names has no asset.
 */
export function petFrameSet(manifest: PetPackManifest, assets: Readonly<Record<string, string>>, dev: boolean): PetFrameSet {
  const frames = {} as Record<PetClip, readonly string[]>
  for (const clip of CLIPS) {
    frames[clip] = resolvePetClip(manifest, clip).frames.map((path) => {
      const url = assets[path]
      if (url === undefined) throw new Error(`pet pack ${manifest.id}: missing frame ${path}`)
      return url
    })
  }
  const loops = Object.fromEntries(CLIPS.map(clip => [clip, resolvePetClip(manifest, clip).loop])) as Record<PetClip, boolean>
  return { key: `${manifest.id}@${manifest.version}`, name: manifest.name, fps: manifest.fps, frames, loops, dev }
}

const BUILTIN_ASSETS: Readonly<Record<string, string>> = {
  'assets/frames/idle-1.webp': idle1,
  'assets/frames/idle-2.webp': idle2,
  'assets/frames/idle-3.webp': idle3,
  'assets/frames/idle-4.webp': idle4,
  'assets/frames/idle-5.webp': idle5,
  'assets/frames/idle-6.webp': idle6,
  'assets/frames/thinking-1.webp': thinking1,
  'assets/frames/thinking-2.webp': thinking2,
  'assets/frames/thinking-3.webp': thinking3,
  'assets/frames/thinking-4.webp': thinking4,
  'assets/frames/thinking-5.webp': thinking5,
  'assets/frames/thinking-6.webp': thinking6,
  'assets/frames/working-1.webp': working1,
  'assets/frames/working-2.webp': working2,
  'assets/frames/working-3.webp': working3,
  'assets/frames/working-4.webp': working4,
  'assets/frames/working-5.webp': working5,
  'assets/frames/working-6.webp': working6,
  'assets/frames/waiting-1.webp': waiting1,
  'assets/frames/waiting-2.webp': waiting2,
  'assets/frames/waiting-3.webp': waiting3,
  'assets/frames/waiting-4.webp': waiting4,
  'assets/frames/waiting-5.webp': waiting5,
  'assets/frames/waiting-6.webp': waiting6,
  'assets/frames/success-1.webp': success1,
  'assets/frames/success-2.webp': success2,
  'assets/frames/success-3.webp': success3,
  'assets/frames/success-4.webp': success4,
  'assets/frames/success-5.webp': success5,
  'assets/frames/success-6.webp': success6,
  'assets/frames/error-1.webp': error1,
  'assets/frames/error-2.webp': error2,
  'assets/frames/error-3.webp': error3,
  'assets/frames/error-4.webp': error4,
  'assets/frames/error-5.webp': error5,
  'assets/frames/error-6.webp': error6,
}

/**
 * Validate a manifest or fail loud.
 * @param value - `pet.json` value.
 * @returns the validated manifest.
 * @throws Error listing every problem.
 */
export function requirePetPack(value: unknown): PetPackManifest {
  const parsed = parsePetPack(value)
  if (!parsed.ok) throw new Error(`pet pack is invalid: ${parsed.errors.join('; ')}`)
  return parsed.pack
}

/** Frame set of the built-in `whaletail-maid` pack. */
export const BUILTIN_FRAME_SET: PetFrameSet = petFrameSet(requirePetPack(builtinManifest), BUILTIN_ASSETS, false)

/**
 * Clip played for an aggregated character state. A lost Host connection keeps
 * the idle clip; the renderer dims it.
 * @param state - aggregated or connection-derived state.
 * @returns the clip to play.
 */
export function clipFor(state: PetAgentState): PetClip {
  switch (state) {
    case 'THINKING': return 'thinking'
    case 'WORKING': return 'working'
    case 'WAITING': return 'waiting'
    case 'SUCCESS': return 'success'
    case 'ERROR': return 'error'
    case 'IDLE':
    case 'DISCONNECTED':
      return 'idle'
  }
}

/**
 * Frame set of the pack the Host offers. The manifest is validated again on
 * this side; anything unusable keeps the built-in pack.
 * @param state - `pet.pack()` result.
 * @returns the offered frame set, or `undefined` to keep the built-in pack.
 */
export function offeredFrameSet(state: PetPackState): PetFrameSet | undefined {
  const offered = state.pack
  if (offered === null) return undefined
  try {
    return {
      ...petFrameSet(requirePetPack(offered.manifest), offered.assets, offered.dev),
      ...offered.motion === undefined ? {} : { motion: offered.motion },
    }
  } catch (_unusable) {
    // An invalid manifest or a frame without an asset makes the whole pack unusable.
    return undefined
  }
}
