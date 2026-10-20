/** Read the community website's initial entries and category shards without executing its scripts. */
import z from 'zod'
import { parseCommunityFeed, type CommunityWireRow } from './community.ts'

const pluginSchema = z.object({
  slug: z.string().min(1), ownerSlug: z.string().min(1), name: z.string().min(1),
  displayName: z.string().nullish(), version: z.string().nullish(), description: z.string().nullish(),
  category: z.string().nullish(), topics: z.array(z.string()).nullish(), features: z.array(z.string()).nullish(),
  source: z.object({ repo: z.string().nullish(), npmPackage: z.string().nullish() }).nullish(),
  install: z.object({
    webInstallable: z.boolean().nullish(), githubCommand: z.string().nullish(), command: z.string().nullish(),
    manualInstallReason: z.string().nullish(), installReason: z.string().nullish(),
  }).nullish(),
  compatibility: z.object({ status: z.string().nullish() }).nullish(),
  dates: z.object({ repoUpdatedAt: z.string().nullish(), addedAt: z.string().nullish() }).nullish(),
  stats: z.object({ stargazers_count: z.number().nullish(), forks_count: z.number().nullish() }).nullish(),
})
const directorySchema = z.object({
  initialPlugins: z.array(pluginSchema),
  shardManifest: z.record(z.string(), z.array(z.string())),
})

/**
 * Decode rich website entries into the shared community representation.
 * @param raw - downloaded JSON array from one directory shard.
 * @returns rows retaining the website's installation restrictions.
 */
export function parseDirectoryRows(raw: unknown): CommunityWireRow[] {
  return parseCommunityFeed(z.array(pluginSchema).parse(raw).map(plugin => ({
    s: plugin.slug, o: plugin.ownerSlug, n: plugin.displayName || plugin.name,
    vr: plugin.version, d: plugin.description, c: plugin.category, t: plugin.topics, f: plugin.features,
    r: plugin.source?.repo || `${plugin.ownerSlug}/${plugin.slug}`,
    ic: plugin.source?.npmPackage ? `dsh plugin add ${plugin.source.npmPackage}` : plugin.install?.command,
    igc: plugin.install?.githubCommand, v: plugin.compatibility?.status,
    u: plugin.dates?.repoUpdatedAt, a: plugin.dates?.addedAt,
    sg: plugin.stats?.stargazers_count, fk: plugin.stats?.forks_count,
    webInstallable: plugin.install?.webInstallable ?? false,
    installNote: plugin.install?.manualInstallReason || plugin.install?.installReason,
  })))
}

/**
 * Decode the directory props from JSON flight packets embedded in the website HTML.
 * @param html - public directory document; scripts are parsed as JSON, never evaluated.
 * @returns initial rows and the category shard paths; rejects missing or malformed metadata.
 */
export function parseDirectoryPage(html: string): { rows: CommunityWireRow[]; shards: string[] } {
  const fragments: string[] = []
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/giu)) {
    const script = match[1]?.trim().replace(/;$/u, '') ?? ''
    const prefix = 'self.__next_f.push('
    if (!script.startsWith(prefix) || !script.endsWith(')')) continue
    const packet: unknown = JSON.parse(script.slice(prefix.length, -1))
    if (Array.isArray(packet) && packet[0] === 1 && typeof packet[1] === 'string') fragments.push(packet[1])
  }
  for (const line of fragments.join('').split('\n')) {
    const separator = line.indexOf(':')
    const payload = line.slice(separator + 1)
    if (separator < 0 || !payload.startsWith('[')) continue
    const pending: unknown[] = [JSON.parse(payload)]
    while (pending.length > 0) {
      const value = pending.pop()
      if (Array.isArray(value)) { pending.push(...value); continue }
      if (typeof value !== 'object' || value === null) continue
      if ('initialPlugins' in value && 'shardManifest' in value) {
        const directory = directorySchema.parse(value)
        return {
          rows: parseDirectoryRows(directory.initialPlugins),
          shards: [...new Set(Object.values(directory.shardManifest).flat())],
        }
      }
      pending.push(...Object.values(value))
    }
  }
  throw new Error('Community directory metadata is unavailable; the website directory format may have changed')
}
