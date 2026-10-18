/**
 * Credit for the built-in character. Its assets come from PC2005-cloud/dsh-pet,
 * whose terms allow non-commercial use only and require the upstream address
 * wherever the character is introduced or shown (see the pack's
 * `UPSTREAM_ASSET_TERMS.md`). The address is read from the built-in `pet.json`
 * so the settings page and the pack name the same source.
 */
import builtinManifest from '@deepseek-ai/dsh-pet/packs/whaletail-maid/pet.json'

/** Upstream repository of the built-in character, from `pet.json` `license.source`. */
export const PET_CHARACTER_SOURCE: string = builtinManifest.license.source
