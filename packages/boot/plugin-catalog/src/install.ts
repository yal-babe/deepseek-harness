/** Install / uninstall helpers for marketplace entries. */

import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { CatalogEntry, CatalogInstallResult } from './types.ts'
import { DEFAULT_CODEX_PLUGIN_RAW_PREFIX } from './codex.ts'

/** Directory under `$DSH_HOME` where Codex skills are materialized. */
export const CODEX_SKILLS_HOME_SEGMENT = 'skills'

/**
 * Parse `community:owner/slug` or `codex:name`.
 * @param id - catalog entry id.
 * @returns Parsed catalog id components or undefined.
 */
export function parseCatalogId(id: string): { source: 'community' | 'codex'; key: string } | undefined {
  const community = /^community:(.+)$/u.exec(id)
  if (community?.[1] !== undefined) return { source: 'community', key: community[1] }
  const codex = /^codex:(.+)$/u.exec(id)
  if (codex?.[1] !== undefined) return { source: 'codex', key: codex[1] }
  return undefined
}

/**
 * Absolute directory for one installed Codex plugin's skills.
 * @param pluginName - Codex plugin name.
 * @param dshHome - optional Harness home override.
 * @returns Absolute directory path for the installed plugin skills.
 */
export function codexSkillsDir(pluginName: string, dshHome?: string): string {
  validatePluginName(pluginName)
  return join(resolveDshHome(dshHome), CODEX_SKILLS_HOME_SEGMENT, `codex-${pluginName}`)
}

/**
 * Whether Codex skills for `pluginName` already exist on disk.
 * @param pluginName - Codex plugin name.
 * @param exists - async existence probe.
 * @param dshHome - optional Harness home override.
 * @returns Promise resolving to true if skills are installed.
 */
export async function codexSkillsInstalled(
  pluginName: string,
  exists: (path: string) => Promise<boolean>,
  dshHome?: string,
): Promise<boolean> {
  return await exists(codexSkillsDir(pluginName, dshHome))
}

/**
 * Materialize Codex skills from the official raw GitHub tree into `$DSH_HOME/skills`.
 * @param pluginName - Codex plugin folder name.
 * @param skillNames - skill directory names under the plugin's skills folder.
 * @param fetchText - HTTP GET that returns response text.
 * @param options - optional home and skills subpath (defaults to `skills`).
 * @returns Installation outcome receipt.
 */
export async function installCodexSkills(
  pluginName: string,
  skillNames: readonly string[],
  fetchText: (url: string) => Promise<string>,
  options: { dshHome?: string; skillsDir?: string; onProgress?: (completed: number, total: number) => void } = {},
): Promise<CatalogInstallResult> {
  if (skillNames.length === 0) {
    return {
      ok: false,
      code: 'unsupported',
      message: 'This Codex plugin declares no installable skills.',
    }
  }
  const skillsDir = (options.skillsDir ?? 'skills').replace(/^\.\//u, '').replace(/\/$/u, '')
  const disabled = disabledCodexSkillsDir(pluginName, options.dshHome)
  const root = await exists(disabled) ? disabled : codexSkillsDir(pluginName, options.dshHome)
  await mkdir(root, { recursive: true })
  try {
    let completed = 0
    for (const skill of skillNames) {
      const url = `${DEFAULT_CODEX_PLUGIN_RAW_PREFIX}/${pluginName}/${skillsDir}/${skill}/SKILL.md`
      const body = await fetchText(url)
      const skillDir = join(root, skill)
      await mkdir(skillDir, { recursive: true })
      await writeFile(join(skillDir, 'SKILL.md'), body, 'utf8')
      options.onProgress?.(++completed, skillNames.length)
    }
  } catch (error: unknown) {
    await rm(root, { recursive: true, force: true }).catch((cleanupError: unknown) => {
      void cleanupError
    })
    return {
      ok: false,
      code: 'failed',
      message: error instanceof Error ? error.message : String(error),
    }
  }
  return {
    ok: true,
    code: 'installed',
    message: `Installed ${String(skillNames.length)} Codex skill(s) under ${root}.`,
  }
}

/**
 * Remove materialized Codex skills for one plugin.
 * @param pluginName - Codex plugin name.
 * @param dshHome - optional Harness home override.
 * @returns Uninstallation outcome receipt.
 */
export async function uninstallCodexSkills(
  pluginName: string,
  dshHome?: string,
): Promise<CatalogInstallResult> {
  const root = codexSkillsDir(pluginName, dshHome)
  try {
    await rm(root, { recursive: true, force: true })
    await rm(disabledCodexSkillsDir(pluginName, dshHome), { recursive: true, force: true })
  } catch (error: unknown) {
    return {
      ok: false,
      code: 'failed',
      message: error instanceof Error ? error.message : String(error),
    }
  }
  return {
    ok: true,
    code: 'uninstalled',
    message: `Removed Codex skills at ${root}.`,
  }
}

/**
 * Build a failure result when install is not available.
 * @param entry - catalog entry.
 * @returns Incompatible or unsupported installation result.
 */
export function unsupportedInstall(entry: CatalogEntry): CatalogInstallResult {
  return {
    ok: false,
    code: entry.compatibility === 'unsupported' ? 'unsupported' : 'incompatible',
    message: entry.compatibilityNote ?? 'This marketplace entry cannot be installed in DSH Studio.',
    entry,
  }
}

/**
 * Directory retaining disabled Codex skills outside the skill discovery roots.
 * @param pluginName - Codex plugin name.
 * @param dshHome - optional Harness home override.
 * @returns the disabled installation directory.
 */
export function disabledCodexSkillsDir(pluginName: string, dshHome?: string): string {
  validatePluginName(pluginName)
  return join(resolveDshHome(dshHome), 'disabled-skills', `codex-${pluginName}`)
}

/**
 * Move installed skills into or out of discovery without deleting their files.
 * @param pluginName - installed Codex plugin name.
 * @param enabled - requested discovery state.
 * @param dshHome - optional Harness home override.
 * @returns the committed state, or a failure leaving the source directory intact.
 */
export async function setCodexSkillsEnabled(
  pluginName: string,
  enabled: boolean,
  dshHome?: string,
): Promise<CatalogInstallResult> {
  const active = codexSkillsDir(pluginName, dshHome)
  const disabled = disabledCodexSkillsDir(pluginName, dshHome)
  const target = enabled ? active : disabled
  const source = enabled ? disabled : active
  try {
    if (!await exists(target)) {
      await mkdir(join(target, '..'), { recursive: true })
      await rename(source, target)
    }
    return { ok: true, code: enabled ? 'enabled' : 'disabled', message: enabled ? 'Enabled.' : 'Disabled.' }
  } catch (error: unknown) {
    return { ok: false, code: 'failed', message: error instanceof Error ? error.message : String(error) }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

function validatePluginName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name)) throw new Error('Invalid Codex plugin name.')
}
