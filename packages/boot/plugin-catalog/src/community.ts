/** dsh-plugin.org catalog feed: compact JSON list at api.dsh-plugin.org. */

import type { CatalogEntry } from './types.ts'

/** Default community catalog origin (API center, not the marketing site). */
export const DEFAULT_COMMUNITY_ORIGIN = 'https://api.dsh-plugin.org'

/** Compact wire row from `GET /plugins.{lang}.json`. */
export interface CommunityWireRow {
  /** Slug. */
  s: string
  /** GitHub owner. */
  o: string
  /** Display / package name. */
  n: string
  /** Optional artwork URL supplied by the catalog. */
  iconUrl?: string
  /** Version label (often `v1.2.3`). */
  vr?: string
  /** Category id. */
  c?: string
  /** Tags. */
  t?: string[]
  /** Feature bullets. */
  f?: string[]
  /** Description. */
  d?: string
  /** `owner/repo`. */
  r?: string
  /** Preferred install CLI line. */
  ic?: string
  /** GitHub install CLI line. */
  igc?: string
  /** `verified` | `unconfirmed`. */
  v?: string
  /** Updated ISO timestamp. */
  u?: string
  /** Added date. */
  a?: string
  /** Stars. */
  sg?: number
  /** Forks. */
  fk?: number
}

/**
 * Parse a community catalog JSON body.
 * @param raw - decoded JSON.
 * @returns validated rows; throws when the feed is not an array of objects.
 */
export function parseCommunityFeed(raw: unknown): CommunityWireRow[] {
  if (!Array.isArray(raw)) {
    throw new Error('community catalog must be a JSON array')
  }
  const rows: CommunityWireRow[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error('community catalog entry must be an object')
    }
    const row = entry as Record<string, unknown>
    const s = stringField(row, 's')
    const o = stringField(row, 'o')
    const n = stringField(row, 'n')
    if (s === undefined || o === undefined || n === undefined) {
      throw new Error('community catalog entry requires s, o, and n')
    }
    const iconUrl = optionalString(row, 'iconUrl')
    const vr = optionalString(row, 'vr')
    const c = optionalString(row, 'c')
    const t = stringArray(row, 't')
    const f = stringArray(row, 'f')
    const d = optionalString(row, 'd')
    const repository = typeof row.r === 'object' && row.r !== null ? row.r as Record<string, unknown> : undefined
    const r = repository === undefined ? optionalString(row, 'r') : optionalString(repository, 'repo')
    const ic = optionalString(row, 'ic')
    const igc = optionalString(row, 'igc')
    const v = optionalString(row, 'v')
    const u = optionalString(row, 'u')
    const a = optionalString(row, 'a')
    const sg = optionalNumber(row, 'sg')
    const fk = optionalNumber(row, 'fk')
    rows.push({
      s, o, n,
      ...iconUrl === undefined ? {} : { iconUrl },
      ...vr === undefined ? {} : { vr },
      ...c === undefined ? {} : { c },
      ...t === undefined ? {} : { t },
      ...f === undefined ? {} : { f },
      ...d === undefined ? {} : { d },
      ...r === undefined ? {} : { r },
      ...ic === undefined ? {} : { ic },
      ...igc === undefined ? {} : { igc },
      ...v === undefined ? {} : { v },
      ...u === undefined ? {} : { u },
      ...a === undefined ? {} : { a },
      ...sg === undefined ? {} : { sg },
      ...fk === undefined ? {} : { fk },
    })
  }
  return rows
}

/**
 * Map one community wire row into a catalog entry.
 * @param row - validated wire row.
 * @param installedNames - profile-installed package names (lowercase).
 * @param installedVersions - name → version for installed packages.
 * @returns Normalized catalog entry.
 */
export function communityEntry(
  row: CommunityWireRow,
  installedNames: ReadonlySet<string>,
  installedVersions: ReadonlyMap<string, string>,
): CatalogEntry {
  const repo = row.r ?? `${row.o}/${row.s}`
  const installSpec = installSpecFromCommands(row.ic, row.igc, repo)
  const packageName = guessPackageName(row.n, installSpec)
  const installed = packageName !== undefined && installedNames.has(packageName.toLowerCase())
  const features = row.f ?? []
  const readmeParts = [
    row.d ?? '',
    features.length > 0 ? `\n\n### Features\n\n${features.map(line => `- ${line}`).join('\n')}` : '',
    installSpec !== undefined ? `\n\n### Install\n\n\`${installSpec}\`` : '',
  ]
  const version = row.vr?.replace(/^v/u, '')
  const installedVersion = packageName === undefined
    ? undefined
    : installedVersions.get(packageName.toLowerCase())
  return {
    id: `community:${repo}`,
    source: 'community',
    kind: 'bundle',
    kinds: ['bundle'],
    compatibility: installSpec === undefined ? 'unsupported' : 'full',
    ...installSpec === undefined
      ? { compatibilityNote: 'This listing has no installable package or GitHub spec.' }
      : {},
    name: packageName ?? row.n,
    title: row.n,
    ...row.iconUrl === undefined ? {} : { iconUrl: row.iconUrl },
    description: row.d ?? '',
    author: row.o,
    ...version === undefined ? {} : { version },
    ...installSpec === undefined ? {} : { installSpec },
    homepageUrl: `https://dsh-plugin.org/plugins/${row.o}/${row.s}`,
    repositoryUrl: `https://github.com/${repo}`,
    readme: readmeParts.join('').trim(),
    ...row.c === undefined ? {} : { category: row.c },
    ...row.t === undefined ? {} : { tags: row.t },
    verified: row.v === 'verified',
    ...row.sg === undefined ? {} : { stars: row.sg },
    ...row.fk === undefined ? {} : { forks: row.fk },
    ...row.u === undefined ? {} : { updatedAt: row.u },
    ...row.a === undefined ? {} : { addedAt: row.a },
    installed,
    ...installedVersion === undefined ? {} : { installedVersion },
    updateAvailable: catalogUpdateAvailable(installed, version, installedVersion),
  }
}

/**
 * True when the listing version differs from the installed version.
 * @param installed - whether the package is in this profile.
 * @param catalogVersion - directory version.
 * @param installedVersion - profile version.
 * @returns True if catalog version differs from installed version.
 */
export function catalogUpdateAvailable(
  installed: boolean,
  catalogVersion: string | undefined,
  installedVersion: string | undefined,
): boolean {
  if (!installed || catalogVersion === undefined || installedVersion === undefined) return false
  return stripVersion(catalogVersion) !== stripVersion(installedVersion)
}

function stripVersion(value: string): string {
  return value.replace(/^v/iu, '').trim()
}

/**
 * Extract a pnpm-accepting install spec from Hub CLI lines.
 * @param preferred - `ic` command.
 * @param github - `igc` command.
 * @param repo - `owner/repo` fallback.
 * @returns Resolved package install spec or undefined.
 */
export function installSpecFromCommands(
  preferred: string | undefined,
  github: string | undefined,
  repo: string,
): string | undefined {
  for (const line of [preferred, github]) {
    if (line === undefined || line.length === 0) continue
    const parsed = parseAddCommand(line)
    if (parsed !== undefined) return parsed
  }
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repo)) {
    return `github:${repo}`
  }
  return undefined
}

function parseAddCommand(line: string): string | undefined {
  const match = /\badd\s+(\S+)/u.exec(line)
  if (match?.[1] === undefined) return undefined
  const spec = match[1]
  if (spec.startsWith('github:') || spec.startsWith('git+') || spec.startsWith('http')) return spec
  if (/^[@A-Za-z0-9]/.test(spec)) return spec
  return undefined
}

function guessPackageName(displayName: string, installSpec: string | undefined): string | undefined {
  if (installSpec === undefined) return displayName
  if (installSpec.startsWith('github:') || installSpec.startsWith('git+') || installSpec.startsWith('http')) {
    return displayName
  }
  const bare = installSpec.split('@').filter(Boolean)
  if (installSpec.startsWith('@')) {
    return bare.length >= 2 ? `@${bare[0]}/${bare[1]?.split('/')[0] ?? bare[1]}` : installSpec
  }
  return bare[0]
}

function stringField(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalString(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key]
  return typeof value === 'string' ? value : undefined
}

function optionalNumber(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringArray(row: Record<string, unknown>, key: string): string[] | undefined {
  const value = row[key]
  if (!Array.isArray(value)) return undefined
  const out = value.filter((item): item is string => typeof item === 'string')
  return out.length > 0 ? out : undefined
}
