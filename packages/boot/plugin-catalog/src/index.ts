/**
 * Marketplace catalog Remote: community (dsh-plugin.org) and Codex
 * (openai/plugins) feeds, Host-side search, and install dispatch.
 */

import { access } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
// Optional: community bundle install when the profile manager is composed.
import type {} from '@deepseek-ai/dsh-plugin-manager'
import type {} from './types.ts'
import {
  communityEntry,
  DEFAULT_COMMUNITY_ORIGIN,
  parseCommunityFeed,
  type CommunityWireRow,
} from './community.ts'
import {
  codexEntry,
  DEFAULT_CODEX_MARKETPLACE_URL,
  DEFAULT_CODEX_PLUGIN_RAW_PREFIX,
  parseCodexMarketplace,
  parseCodexPluginManifest,
  type CodexMarketplacePlugin,
  type CodexPluginManifest,
} from './codex.ts'
import {
  codexSkillsDir,
  disabledCodexSkillsDir,
  setCodexSkillsEnabled,
  installCodexSkills,
  parseCatalogId,
  uninstallCodexSkills,
  unsupportedInstall,
} from './install.ts'
import { filterCatalog, sortCatalog } from './query.ts'
import type {
  CatalogEntry,
  CatalogInstallResult,
  CatalogLocale,
  CatalogSearchQuery,
  CatalogSearchResult,
  CatalogSource,
} from './types.ts'

export type * from './types.ts'
export {
  catalogUpdateAvailable,
  DEFAULT_COMMUNITY_ORIGIN,
  installSpecFromCommands,
  parseCommunityFeed,
} from './community.ts'
export { filterCatalog, sortCatalog } from './query.ts'
export {
  DEFAULT_CODEX_MARKETPLACE_URL,
  DEFAULT_CODEX_PLUGIN_RAW_PREFIX,
  detectKinds,
  parseCodexMarketplace,
  parseCodexPluginManifest,
} from './codex.ts'
export {
  CODEX_SKILLS_HOME_SEGMENT,
  codexSkillsDir,
  parseCatalogId,
} from './install.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    pluginCatalog: PluginCatalog
  }
}

/** Configurable feed origins and cache lifetime. */
export interface Config {
  /** Community API origin (`https://api.dsh-plugin.org`). */
  communityOrigin?: string
  /** Catalog language file: `en` or `zh`. */
  communityLocale?: 'en' | 'zh'
  /** Codex marketplace.json URL. */
  codexMarketplaceUrl?: string
  /** Milliseconds to reuse a successful feed download. */
  cacheTtlMs?: number
  /** HTTP timeout for feed downloads. */
  fetchTimeoutMs?: number
}

/** Aggregated marketplace catalog served over Typert Remote. */
export class PluginCatalog extends TypertRemoteService {
  static inject = ['loader']

  static Config: z<Config> = z.object({
    communityOrigin: z.string().default(DEFAULT_COMMUNITY_ORIGIN),
    communityLocale: z.union([z.const('en'), z.const('zh')]).default('en'),
    codexMarketplaceUrl: z.string().default(DEFAULT_CODEX_MARKETPLACE_URL),
    cacheTtlMs: z.number().default(15 * 60_000),
    fetchTimeoutMs: z.number().default(20_000),
  })

  private communityCache: (FeedCache<CommunityWireRow[]> & { locale: CatalogLocale }) | undefined
  private codexCache: FeedCache<CodexMarketplacePlugin[]> | undefined
  private readonly artworkCache = new Map<string, FeedCache<string | null>>()
  private readonly manifestCache = new Map<string, FeedCache<CodexPluginManifest>>()
  private readonly skillListCache = new Map<string, FeedCache<{ dir: string; names: string[] }>>()

  /**
   * @param ctx - Host context; `pluginManager` is optional for community installs.
   * @param config - feed origins and cache.
   */
  constructor(
    ctx: Context,
    private readonly config: Config = {},
  ) {
    super(ctx, 'pluginCatalog')
  }

  /**
   * Search the aggregated catalog.
   * @param query - text, source, Hub category, Codex kind, sort, and pagination.
   * @returns one page of entries; feed failures throw a RemoteError.
   */
  @Remote
  async search(query?: CatalogSearchQuery): Promise<CatalogSearchResult> {
    const resolved = query ?? {}
    const pageSize = clamp(resolved.pageSize ?? 24, 1, 50)
    const page = Math.max(1, resolved.page ?? 1)
    const source = resolved.source
    const locale: CatalogLocale = resolved.locale === 'zh' ? 'zh' : 'en'
    const installed = await this.installedPackages()
    const entries: CatalogEntry[] = []
    try {
      if (source === undefined || source === 'community') {
        for (const row of await this.loadCommunity(locale)) {
          const entry = communityEntry(row, installed.names, installed.versions)
          entries.push({ ...entry, enabled: installed.enabled.has(entry.name.toLowerCase()) })
        }
      }
      if (source === undefined || source === 'codex') {
        for (const plugin of await this.loadCodexMarketplace()) {
          entries.push(await this.codexListEntry(plugin))
        }
      }
    } catch (error: unknown) {
      throw feedError(error)
    }
    const queryFilter = resolved.query === undefined ? {} : { query: resolved.query }
    const afterQuery = filterCatalog(entries, queryFilter)
    const installedCount = afterQuery.filter(entry => entry.installed).length
    const filtered = sortCatalog(
      filterCatalog(entries, {
        ...queryFilter,
        ...resolved.category === undefined ? {} : { category: resolved.category },
        ...resolved.kind === undefined ? {} : { kind: resolved.kind },
        ...resolved.installedOnly === true ? { installedOnly: true } : {},
      }),
      resolved.sort ?? 'stars',
    )
    const total = filtered.length
    const start = (page - 1) * pageSize
    return {
      entries: await Promise.all(filtered.slice(start, start + pageSize).map(async (entry) => {
        if (entry.source !== 'codex') return await this.communityArtwork(entry)
        const manifest = await this.loadCodexManifest(entry.name)
        return {
          ...codexEntry({ name: entry.name }, manifest, { skills: true, mcp: false, hooks: false }, entry.installed),
          enabled: entry.enabled === true,
        }
      })),
      total,
      page,
      pageSize,
      queryTotal: afterQuery.length,
      installedCount,
    }
  }

  /**
   * Read one entry by id, enriching Codex rows with plugin.json detail.
   * @param id - `community:…` or `codex:…`.
   * @returns catalog entry matching the given identifier.
   */
  @Remote
  async get(id: string): Promise<CatalogEntry> {
    const parsed = parseCatalogId(id)
    if (parsed === undefined) {
      throw new RemoteError('plugin-catalog/not-found', `unknown catalog id "${id}"`, { id })
    }
    try {
      if (parsed.source === 'community') {
        const installed = await this.installedPackages()
        const row = (await this.loadCommunity(
          this.communityCache?.locale ?? this.config.communityLocale ?? 'en',
        )).find(item =>
          (item.r ?? `${item.o}/${item.s}`) === parsed.key
          || `${item.o}/${item.s}` === parsed.key)
        if (row === undefined) {
          throw new RemoteError(
            'plugin-catalog/not-found',
            `community plugin "${parsed.key}" not found`,
            { id },
          )
        }
        const entry = communityEntry(row, installed.names, installed.versions)
        return await this.communityArtwork({ ...entry, enabled: installed.enabled.has(entry.name.toLowerCase()) })
      }
      const plugin = (await this.loadCodexMarketplace()).find(item => item.name === parsed.key)
      if (plugin === undefined) {
        throw new RemoteError(
          'plugin-catalog/not-found',
          `Codex plugin "${parsed.key}" not found`,
          { id },
        )
      }
      return await this.codexDetailEntry(plugin)
    } catch (error: unknown) {
      if (isRemoteError(error)) throw error
      throw feedError(error)
    }
  }

  /**
   * Install a marketplace entry.
   * Named `installEntry` because the client Remote namespace service already defines `install`.
   * @param id - catalog entry id.
   * @returns installation outcome.
   */
  @Remote
  async installEntry(id: string): Promise<CatalogInstallResult> {
    let entry: CatalogEntry
    try {
      entry = await this.get(id)
    } catch (error: unknown) {
      if (isRemoteError(error) && error.code === 'plugin-catalog/not-found') {
        return { ok: false, code: 'not-found', message: error.message }
      }
      throw error
    }
    if (entry.source === 'community') {
      return await this.installCommunity(entry)
    }
    return await this.installCodex(entry)
  }

  /**
   * Uninstall a marketplace entry.
   * @param id - catalog entry id.
   * @returns uninstallation outcome.
   */
  @Remote
  async uninstall(id: string): Promise<CatalogInstallResult> {
    let entry: CatalogEntry
    try {
      entry = await this.get(id)
    } catch (error: unknown) {
      if (isRemoteError(error) && error.code === 'plugin-catalog/not-found') {
        return { ok: false, code: 'not-found', message: error.message }
      }
      throw error
    }
    if (entry.source === 'community') {
      return await this.uninstallCommunity(entry)
    }
    const result = await uninstallCodexSkills(entry.name)
    return { ...result, entry: await this.get(id).catch(() => entry) }
  }

  /**
   * Persist activation for an installed marketplace entry.
   * @param id - catalog entry id.
   * @param enabled - whether the bundle or skills should be available.
   * @returns the committed entry and any restart requirement; failures remain visible.
   */
  @Remote
  async setEnabled(id: string, enabled: boolean): Promise<CatalogInstallResult> {
    const entry = await this.get(id)
    if (!entry.installed) return { ok: false, code: 'not-found', message: 'Install this plugin first.', entry }
    if (entry.source === 'codex') {
      const result = await setCodexSkillsEnabled(entry.name, enabled)
      return { ...result, entry: await this.get(id) }
    }
    const manager = this.ctx.get('pluginManager')
    if (manager === undefined) {
      return { ok: false, code: 'missing-manager', message: 'Plugin manager is unavailable.', entry }
    }
    const change = await manager.setBundleEnabled(entry.name, enabled)
    const ok = change.application !== 'failed' && change.application !== 'cancelled'
    return {
      ok,
      code: ok ? enabled ? 'enabled' : 'disabled' : 'failed',
      message: change.error?.code ?? change.application,
      restartRequired: change.application === 'restart-required',
      entry: await this.get(id),
    }
  }

  private async installCommunity(entry: CatalogEntry): Promise<CatalogInstallResult> {
    if (entry.installSpec === undefined || entry.compatibility !== 'full') {
      return unsupportedInstall(entry)
    }
    const manager = this.ctx.get('pluginManager')
    if (manager === undefined) {
      return {
        ok: false,
        code: 'missing-manager',
        message: 'Plugin manager is not available in this profile.',
        entry,
      }
    }
    try {
      const inspection = await manager.inspect(entry.installSpec)
      if (inspection.status === 'refused') {
        return {
          ok: false,
          code: inspection.problem === 'not-a-bundle' || inspection.problem === 'already-installed'
            ? 'incompatible'
            : 'failed',
          message: inspection.reason,
          entry,
        }
      }
      const change = await manager.installBundle(entry.installSpec, {
        enabled: !entry.installed || entry.enabled === true,
        saveExact: false,
      })
      return {
        ok: change.application !== 'failed' && change.application !== 'cancelled',
        code: change.application === 'failed' || change.application === 'cancelled' ? 'failed' : 'installed',
        message: change.application === 'restart-required'
          ? 'Installed; restart the application to finish loading.'
          : 'Installed.',
        restartRequired: change.application === 'restart-required',
        entry: await this.get(entry.id).catch(() => entry),
      }
    } catch (error: unknown) {
      return {
        ok: false,
        code: 'failed',
        message: error instanceof Error ? error.message : String(error),
        entry,
      }
    }
  }

  private async uninstallCommunity(entry: CatalogEntry): Promise<CatalogInstallResult> {
    const manager = this.ctx.get('pluginManager')
    if (manager === undefined) {
      return {
        ok: false,
        code: 'missing-manager',
        message: 'Plugin manager is not available in this profile.',
        entry,
      }
    }
    try {
      const change = await manager.removeBundle(entry.name)
      return {
        ok: change.application !== 'failed' && change.application !== 'cancelled',
        code: change.application === 'failed' || change.application === 'cancelled' ? 'failed' : 'uninstalled',
        message: change.application === 'restart-required'
          ? 'Uninstalled; restart the application to finish unloading.'
          : 'Uninstalled.',
        restartRequired: change.application === 'restart-required',
        entry: await this.get(entry.id).catch(() => ({ ...entry, installed: false })),
      }
    } catch (error: unknown) {
      return {
        ok: false,
        code: 'failed',
        message: error instanceof Error ? error.message : String(error),
        entry,
      }
    }
  }

  private async installCodex(entry: CatalogEntry): Promise<CatalogInstallResult> {
    if (entry.compatibility === 'unsupported' || !entry.kinds.includes('skill')) {
      return unsupportedInstall(entry)
    }
    const listed = await this.listCodexSkills(entry.name)
    const result = await installCodexSkills(
      entry.name,
      listed.names,
      url => this.fetchText(url),
      { skillsDir: listed.dir },
    )
    return { ...result, entry: await this.get(entry.id).catch(() => entry) }
  }

  private async codexListEntry(plugin: CodexMarketplacePlugin): Promise<CatalogEntry> {
    const enabled = await pathExists(codexSkillsDir(plugin.name))
    const installed = enabled || await pathExists(disabledCodexSkillsDir(plugin.name))
    return { ...codexEntry(plugin, undefined, { skills: true, mcp: false, hooks: false }, installed), enabled }
  }

  private async codexDetailEntry(plugin: CodexMarketplacePlugin): Promise<CatalogEntry> {
    const manifest = await this.loadCodexManifest(plugin.name)
    const listed = await this.listCodexSkills(plugin.name)
    const mcp = await this.probeCodexFile(plugin.name, '.mcp.json')
    const hooks = await this.probeCodexFile(plugin.name, 'hooks.json')
    const enabled = await pathExists(codexSkillsDir(plugin.name))
    const installed = enabled || await pathExists(disabledCodexSkillsDir(plugin.name))
    return { ...codexEntry(
      plugin,
      manifest,
      { skills: listed.names.length > 0 || manifest?.skills !== undefined, mcp, hooks },
      installed,
    ), enabled }
  }

  private async loadCommunity(locale: CatalogLocale): Promise<CommunityWireRow[]> {
    const ttl = this.config.cacheTtlMs ?? 15 * 60_000
    if (
      this.communityCache !== undefined
      && this.communityCache.locale === locale
      && Date.now() - this.communityCache.fetchedAt < ttl
    ) {
      return this.communityCache.value
    }
    const origin = (this.config.communityOrigin ?? DEFAULT_COMMUNITY_ORIGIN).replace(/\/$/u, '')
    const text = await this.fetchText(`${origin}/plugins.${locale}.json`)
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch (error: unknown) {
      throw new Error(`community catalog JSON is invalid: ${error instanceof Error ? error.message : String(error)}`)
    }
    const value = parseCommunityFeed(raw)
    this.communityCache = { fetchedAt: Date.now(), value, locale }
    return value
  }

  private async loadCodexMarketplace(): Promise<CodexMarketplacePlugin[]> {
    const ttl = this.config.cacheTtlMs ?? 15 * 60_000
    if (this.codexCache !== undefined && Date.now() - this.codexCache.fetchedAt < ttl) {
      return this.codexCache.value
    }
    const text = await this.fetchText(this.config.codexMarketplaceUrl ?? DEFAULT_CODEX_MARKETPLACE_URL)
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch (error: unknown) {
      throw new Error(`Codex marketplace JSON is invalid: ${error instanceof Error ? error.message : String(error)}`)
    }
    const value = parseCodexMarketplace(raw).plugins
    this.codexCache = { fetchedAt: Date.now(), value }
    return value
  }

  private async loadCodexManifest(name: string): Promise<CodexPluginManifest | undefined> {
    const ttl = this.config.cacheTtlMs ?? 15 * 60_000
    const cached = this.manifestCache.get(name)
    if (cached !== undefined && Date.now() - cached.fetchedAt < ttl) return cached.value
    try {
      const text = await this.fetchText(
        `${DEFAULT_CODEX_PLUGIN_RAW_PREFIX}/${name}/.codex-plugin/plugin.json`,
      )
      const value = parseCodexPluginManifest(JSON.parse(text))
      this.manifestCache.set(name, { fetchedAt: Date.now(), value })
      return value
    } catch (manifestError: unknown) {
      void manifestError
      return undefined
    }
  }

  private async listCodexSkills(name: string): Promise<{ dir: string; names: string[] }> {
    const ttl = this.config.cacheTtlMs ?? 15 * 60_000
    const cached = this.skillListCache.get(name)
    if (cached !== undefined && Date.now() - cached.fetchedAt < ttl) return cached.value
    const manifest = await this.loadCodexManifest(name)
    const dir = typeof manifest?.skills === 'string'
      ? manifest.skills.replace(/^\.\//u, '').replace(/\/$/u, '')
      : 'skills'
    const names = await this.fetchCodexSkillDirectory(name, dir)
    const value = { dir, names }
    this.skillListCache.set(name, { fetchedAt: Date.now(), value })
    return value
  }

  private async fetchCodexSkillDirectory(plugin: string, skillsDir: string): Promise<string[]> {
    const api =
      `https://api.github.com/repos/openai/plugins/contents/plugins/${plugin}/${skillsDir}`
    try {
      const text = await this.fetchText(api, { accept: 'application/vnd.github+json' })
      const raw: unknown = JSON.parse(text)
      if (!Array.isArray(raw)) return []
      return raw
        .filter((row): row is { type: string; name: string } =>
          typeof row === 'object' && row !== null
          && (row as { type?: unknown }).type === 'dir'
          && typeof (row as { name?: unknown }).name === 'string')
        .map(row => row.name)
    } catch (listError: unknown) {
      void listError
      return []
    }
  }

  private async probeCodexFile(plugin: string, file: string): Promise<boolean> {
    try {
      await this.fetchText(`${DEFAULT_CODEX_PLUGIN_RAW_PREFIX}/${plugin}/${file}`)
      return true
    } catch (probeError: unknown) {
      void probeError
      return false
    }
  }

  private async communityArtwork(entry: CatalogEntry): Promise<CatalogEntry> {
    if (entry.iconUrl !== undefined) return entry
    const repo = entry.repositoryUrl?.replace('https://github.com/', '')
    if (repo === undefined || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repo)) return entry
    const cached = this.artworkCache.get(repo)
    if (cached !== undefined && Date.now() - cached.fetchedAt < (this.config.cacheTtlMs ?? 15 * 60_000)) {
      return cached.value === null ? entry : { ...entry, iconUrl: cached.value }
    }
    let iconUrl: string | null = null
    try {
      const base = `https://raw.githubusercontent.com/${repo}/HEAD/`
      const raw: unknown = JSON.parse(await this.fetchText(`${base}package.json`))
      if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
        const manifest = raw as Record<string, unknown>
        const exports = typeof manifest.exports === 'object' && manifest.exports !== null
          ? manifest.exports as Record<string, unknown> : undefined
        const icon = manifest.icon ?? exports?.['./icon']
        if (typeof icon === 'string') {
          const url = new URL(icon, base)
          if (url.protocol === 'https:' || url.protocol === 'http:') iconUrl = url.href
        }
      }
    } catch (error: unknown) {
      // Optional artwork is independent of catalog availability; failed probes expire with the feed cache.
      void error
    }
    this.artworkCache.set(repo, { fetchedAt: Date.now(), value: iconUrl })
    return iconUrl === null ? entry : { ...entry, iconUrl }
  }

  private async installedPackages(): Promise<{
    names: Set<string>
    versions: Map<string, string>
    enabled: Set<string>
  }> {
    const names = new Set<string>()
    const versions = new Map<string, string>()
    const enabled = new Set<string>()
    const manager = this.ctx.get('pluginManager')
    if (manager === undefined) return { names, versions, enabled }
    try {
      const bundles = await manager.listBundles()
      for (const bundle of bundles) {
        if (!bundle.installed) continue
        names.add(bundle.name.toLowerCase())
        if (bundle.enabled) enabled.add(bundle.name.toLowerCase())
        if (bundle.version !== undefined) versions.set(bundle.name.toLowerCase(), bundle.version)
      }
    } catch (inventoryError: unknown) {
      // Inventory is best-effort for marketplace badges.
      void inventoryError
    }
    return { names, versions, enabled }
  }

  private async fetchText(
    url: string,
    headers: Record<string, string> = {},
  ): Promise<string> {
    const timeoutMs = this.config.fetchTimeoutMs ?? 20_000
    const signal = AbortSignal.timeout(timeoutMs)
    const response = await fetch(url, {
      signal,
      headers: {
        'user-agent': 'dsh-plugin-catalog/0.2.1',
        ...headers,
      },
    })
    if (!response.ok) {
      throw new Error(`GET ${url} failed with ${String(response.status)}`)
    }
    return await response.text()
  }
}

export default PluginCatalog

interface FeedCache<T> {
  fetchedAt: number
  value: T
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function feedError(error: unknown): RemoteError {
  const reason = error instanceof Error ? error.message : String(error)
  return new RemoteError(
    'plugin-catalog/feed-failed',
    reason,
    { reason },
    { cause: error },
  )
}

function isRemoteError(error: unknown): error is RemoteError {
  return typeof error === 'object' && error !== null
    && (error as { isDSHRemoteError?: unknown }).isDSHRemoteError === true
    && typeof (error as { code?: unknown }).code === 'string'
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (accessError: unknown) {
    void accessError
    return false
  }
}

/** Source filter values accepted by search. */
export type { CatalogSource }
