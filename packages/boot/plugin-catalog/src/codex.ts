/** Codex official plugin feed from github.com/openai/plugins. */

import type { CatalogCompatibility, CatalogEntry, CatalogKind } from './types.ts'

/** Raw marketplace root at openai/plugins. */
export const DEFAULT_CODEX_MARKETPLACE_URL =
  'https://raw.githubusercontent.com/openai/plugins/main/.agents/plugins/marketplace.json'

/** Raw plugin root prefix for openai/plugins. */
export const DEFAULT_CODEX_PLUGIN_RAW_PREFIX =
  'https://raw.githubusercontent.com/openai/plugins/main/plugins'

/** One marketplace.json plugin row. */
export interface CodexMarketplacePlugin {
  name: string
  source?: { source?: string; path?: string }
  policy?: { installation?: string; authentication?: string }
  category?: string
}

/** Marketplace.json root. */
export interface CodexMarketplace {
  name?: string
  interface?: { displayName?: string }
  plugins: CodexMarketplacePlugin[]
}

/** Subset of `.codex-plugin/plugin.json` used for detail and kind detection. */
export interface CodexPluginManifest {
  name?: string
  version?: string
  description?: string
  author?: { name?: string; url?: string }
  homepage?: string
  repository?: string
  skills?: string
  mcpServers?: unknown
  interface?: {
    displayName?: string
    shortDescription?: string
    longDescription?: string
    developerName?: string
    category?: string
    logo?: string
    websiteURL?: string
  }
}

/**
 * Parse the Codex marketplace JSON.
 * @param raw - decoded JSON.
 * @returns marketplace with a plugins array.
 */
export function parseCodexMarketplace(raw: unknown): CodexMarketplace {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Codex marketplace must be a JSON object')
  }
  const root = raw as Record<string, unknown>
  const pluginsRaw = root.plugins
  if (!Array.isArray(pluginsRaw)) {
    throw new Error('Codex marketplace.plugins must be an array')
  }
  const plugins: CodexMarketplacePlugin[] = []
  for (const item of pluginsRaw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error('Codex marketplace plugin must be an object')
    }
    const row = item as Record<string, unknown>
    if (typeof row.name !== 'string' || row.name.length === 0) {
      throw new Error('Codex marketplace plugin requires name')
    }
    const source = asRecord(row.source) as CodexMarketplacePlugin['source']
    const policy = asRecord(row.policy) as CodexMarketplacePlugin['policy']
    const category = typeof row.category === 'string' ? row.category : undefined
    plugins.push({
      name: row.name,
      ...source === undefined ? {} : { source },
      ...policy === undefined ? {} : { policy },
      ...category === undefined ? {} : { category },
    })
  }
  const name = typeof root.name === 'string' ? root.name : undefined
  const iface = asRecord(root.interface) as CodexMarketplace['interface']
  return {
    ...name === undefined ? {} : { name },
    ...iface === undefined ? {} : { interface: iface },
    plugins,
  }
}

/**
 * Parse a Codex plugin.json body.
 * @param raw - decoded JSON.
 * @returns Parsed Codex plugin manifest object.
 */
export function parseCodexPluginManifest(raw: unknown): CodexPluginManifest {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Codex plugin.json must be a JSON object')
  }
  return raw
}

/**
 * Build a list entry from the marketplace row (manifest optional).
 * @param plugin - marketplace row.
 * @param manifest - optional plugin.json.
 * @param surfaces - detected files: skills, mcp, hooks.
 * @param installed - whether skills are already materialized under DSH home.
 * @returns Normalized catalog entry.
 */
export function codexEntry(
  plugin: CodexMarketplacePlugin,
  manifest: CodexPluginManifest | undefined,
  surfaces: { skills: boolean; mcp: boolean; hooks: boolean },
  installed: boolean,
): CatalogEntry {
  const kinds = detectKinds(manifest, surfaces)
  const primary = kinds[0] ?? 'skill'
  const { compatibility, compatibilityNote } = compatibilityFor(kinds)
  const title = manifest?.interface?.displayName ?? plugin.name
  const description = manifest?.interface?.shortDescription
    ?? manifest?.description
    ?? ''
  const author = manifest?.interface?.developerName
    ?? manifest?.author?.name
    ?? 'OpenAI'
  const long = manifest?.interface?.longDescription ?? manifest?.description ?? description
  const version = manifest?.version
  const logo = manifest?.interface?.logo
  const iconUrl = logo === undefined
    ? undefined
    : new URL(logo, `${DEFAULT_CODEX_PLUGIN_RAW_PREFIX}/${plugin.name}/`).href
  const category = plugin.category ?? manifest?.interface?.category
  const installedVersion = installed ? version : undefined
  return {
    id: `codex:${plugin.name}`,
    source: 'codex',
    kind: primary,
    kinds,
    compatibility,
    compatibilityNote,
    name: plugin.name,
    title,
    description,
    author,
    ...version === undefined ? {} : { version },
    homepageUrl: manifest?.homepage ?? manifest?.interface?.websiteURL
      ?? 'https://github.com/openai/plugins',
    repositoryUrl: manifest?.repository ?? 'https://github.com/openai/plugins',
    ...iconUrl === undefined ? {} : { iconUrl },
    readme: [
      long,
      '',
      '### Surfaces',
      '',
      kinds.map(kind => `- ${kind}`).join('\n') || '- (none detected)',
      '',
      `### Compatibility\n\n${compatibilityNote}`,
    ].filter(Boolean).join('\n'),
    ...category === undefined ? {} : { category },
    tags: kinds,
    installed,
    ...installedVersion === undefined ? {} : { installedVersion },
  }
}

/**
 * Detect Codex surfaces from manifest fields and optional file probes.
 * @param manifest - optional plugin manifest.
 * @param surfaces - detected surface flags.
 * @returns Detected catalog kinds array.
 */
export function detectKinds(
  manifest: CodexPluginManifest | undefined,
  surfaces: { skills: boolean; mcp: boolean; hooks: boolean },
): CatalogKind[] {
  const kinds: CatalogKind[] = []
  if (surfaces.skills || (typeof manifest?.skills === 'string' && manifest.skills.length > 0)) {
    kinds.push('skill')
  }
  if (surfaces.mcp || manifest?.mcpServers !== undefined) {
    kinds.push('mcp')
  }
  if (surfaces.hooks) kinds.push('hook')
  return kinds.length > 0 ? kinds : ['skill']
}

function compatibilityFor(kinds: readonly CatalogKind[]): {
  compatibility: CatalogCompatibility
  compatibilityNote: string
} {
  const hasSkill = kinds.includes('skill')
  const hasMcp = kinds.includes('mcp')
  const hasHook = kinds.includes('hook')
  if (hasSkill && !hasMcp && !hasHook) {
    return {
      compatibility: 'partial',
      compatibilityNote: 'DSH can materialize Codex skills under $DSH_HOME/skills; apps and ChatGPT-only surfaces stay unsupported.',
    }
  }
  if (hasSkill || hasMcp) {
    return {
      compatibility: 'partial',
      compatibilityNote: hasMcp
        ? 'Skills can be installed into DSH; MCP servers need a matching dsh-mcp-client entry (shown in the detail notes). Hooks are not auto-installed.'
        : 'Skills can be installed into DSH. Other Codex surfaces are not auto-installed.',
    }
  }
  if (hasHook) {
    return {
      compatibility: 'unsupported',
      compatibilityNote: 'Codex hooks are not one-click installable; use dsh-hooks-codex with a local hooks.json.',
    }
  }
  return {
    compatibility: 'unsupported',
    compatibilityNote: 'No DSH-installable surface was detected for this Codex plugin.',
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}
