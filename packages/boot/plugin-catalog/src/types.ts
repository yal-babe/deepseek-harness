/** Shared marketplace catalog records for Host Remotes and the Settings UI. */

import type {} from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Catalog id is not `community:…` / `codex:…`, or the feed has no such row. */
    'plugin-catalog/not-found': { readonly id: string }
    /** A configured feed failed to download or failed validation. */
    'plugin-catalog/feed-failed': { readonly reason: string }
  }
}

/** Catalog origin shown as a source badge. */
export type CatalogSource = 'community' | 'codex'

/** Capability surface a marketplace entry contributes. */
export type CatalogKind = 'bundle' | 'skill' | 'mcp' | 'hook'

/** How far DSH can install or adapt this entry today. */
export type CatalogCompatibility = 'full' | 'partial' | 'unsupported'

/** One marketplace entry after Host normalization. */
export interface CatalogEntry {
  /** Stable id: `community:<owner>/<slug>` or `codex:<name>`. */
  id: string
  source: CatalogSource
  /** Primary capability; additional surfaces appear in `kinds`. */
  kind: CatalogKind
  /** Every detected surface for Codex multi-surface plugins. */
  kinds: readonly CatalogKind[]
  compatibility: CatalogCompatibility
  name: string
  title: string
  description: string
  author: string
  version?: string
  /** pnpm/git install spec when `kind` is `bundle` and install is supported. */
  installSpec?: string
  homepageUrl?: string
  repositoryUrl?: string
  iconUrl?: string
  /** Markdown or plain usage notes for the detail page. */
  readme?: string
  /** Why install is limited when compatibility is not `full`. */
  compatibilityNote?: string
  category?: string
  tags?: readonly string[]
  verified?: boolean
  stars?: number
  forks?: number
  updatedAt?: string
  /** Hub `a` added date (ISO or `YYYY-MM-DD`). */
  addedAt?: string
  /** Profile already has this community package (or Codex skills dir). */
  installed: boolean
  /** Desired activation state when installed. */
  enabled?: boolean
  /** Installed version when known. */
  installedVersion?: string
  /** Catalog version differs from the installed version. */
  updateAvailable?: boolean
}

/** Hub-matching list sorts. */
export type CatalogSort = 'stars' | 'forks' | 'updated' | 'added'

/** Community catalog language file. */
export type CatalogLocale = 'en' | 'zh'

/** Search and filter options for {@link PluginCatalog.search}. */
export interface CatalogSearchQuery {
  /** Case-insensitive substring over title, description, author, and tags. */
  query?: string
  /** Restrict to one feed; omit for all. */
  source?: CatalogSource
  /** Hub category id (`interface`, `tools`, …); omit for every category. */
  category?: string
  /** Codex capability filter. */
  kind?: CatalogKind
  sort?: CatalogSort
  /** Restrict to entries already in this profile. */
  installedOnly?: boolean
  /** Community feed language; defaults to Config `communityLocale`. */
  locale?: CatalogLocale
  /** 1-based page index. */
  page?: number
  /** Page size, clamped to 1–50. */
  pageSize?: number
}

/** One page of marketplace results. */
export interface CatalogSearchResult {
  entries: readonly CatalogEntry[]
  total: number
  page: number
  pageSize: number
  /** Rows matching source and text, before category or kind filters. */
  queryTotal: number
  /** Installed rows matching the current source and text query (ignores category). */
  installedCount: number
}

/** Outcome of a marketplace install or uninstall. */
export interface CatalogInstallResult {
  ok: boolean
  /** Localized-ready short code for the UI dictionary. */
  code:
    | 'installed'
    | 'uninstalled'
    | 'enabled'
    | 'disabled'
    | 'unsupported'
    | 'incompatible'
    | 'missing-manager'
    | 'not-found'
    | 'failed'
  message: string
  /** Present when the Host asked plugin-manager and a restart is needed. */
  restartRequired?: boolean
  entry?: CatalogEntry
}

/** Installation stage completion for one catalog entry; independent entries may run concurrently. */
export interface CatalogInstallProgress {
  id: string
  percent: number
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** A catalog installation completed another stage.
     * @mode emit
     * @param progress - catalog entry identity and completed stage percentage.
     */
    'plugin-catalog/install-progress'(progress: CatalogInstallProgress): void
  }
}
