/**
 * Marketplace page state: Hub-style catalog search, installed list, custom install.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {
  CatalogEntry,
  CatalogInstallResult,
  CatalogKind,
  CatalogSearchResult,
  CatalogSort,
  CatalogSource,
} from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Source filter shown in the chips; `all` omits the Host filter. */
export type SourceFilter = 'all' | CatalogSource

/** Top-level Hub section. */
export type MarketplaceTab = 'market' | 'installed' | 'custom'

/** Toast / in-place notice after an install action. */
export interface MarketplaceNotice {
  readonly kind: 'ok' | 'error' | 'restart'
  readonly textKey:
    | 'noticeEnabled'
    | 'noticeDisabled'
    | 'noticeInstalled'
    | 'noticeUninstalled'
    | 'noticeRestart'
    | 'noticeFailed'
    | 'noticeUnsupported'
    | 'noticeIncompatible'
    | 'noticeMissingManager'
    | 'noticeEmptySpec'
  readonly message?: string
  readonly seq: number
}

/** Snapshot the Settings section renders. */
export interface MarketplaceState {
  readonly layout: 'cards' | 'list'
  readonly tab: MarketplaceTab
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  /** Present when `status` is `error`; otherwise `null`. */
  readonly errorMessage: string | null
  readonly query: string
  readonly source: SourceFilter
  readonly category: string
  readonly kind: 'all' | CatalogKind
  readonly sort: CatalogSort
  readonly page: number
  readonly pageSize: number
  readonly result: CatalogSearchResult | null
  readonly detail: CatalogEntry | null
  readonly detailStatus: 'idle' | 'loading' | 'error'
  readonly busyId: string | null
  readonly busyOperation?: 'install' | 'uninstall' | 'enable' | 'disable'
  readonly notice: MarketplaceNotice | null
  readonly customSpec: string
}

const PAGE_SIZE = 24

/** Controller for the marketplace section. */
export class MarketplaceStore {
  readonly store: SnapshotStore<MarketplaceState>
  private noticeSeq = 0
  private searchGeneration = 0
  private debounce: ReturnType<typeof setTimeout> | undefined

  /**
   * @param ctx - browser context with `remote.pluginCatalog`.
   */
  constructor(private readonly ctx: ClientContext) {
    this.store = createSnapshotStore<MarketplaceState>({
      layout: 'cards',
      tab: 'market',
      status: 'idle',
      errorMessage: null,
      query: '',
      source: 'all',
      category: 'all',
      kind: 'all',
      sort: 'stars',
      page: 1,
      pageSize: PAGE_SIZE,
      result: null,
      detail: null,
      detailStatus: 'idle',
      busyId: null,
      notice: null,
      customSpec: '',
    })
  }

  /** Load the first page for the current filter. */
  load(): void {
    void this.search(true)
  }

  /** Refresh visible inventory after another plugin management surface changes it. */
  refresh(): void {
    const state = this.store.getSnapshot()
    if (state.status === 'idle' || state.tab === 'custom' || state.busyId !== null) return
    void this.search(false)
  }

  /**
   * Choose the catalog presentation without reloading its data.
   * @param layout - cards or compact list.
   */
  setLayout(layout: MarketplaceState['layout']): void {
    this.patch({ layout })
  }

  /**
   * Switch Marketplace / Installed / Custom install.
   * @param tab - Hub section.
   */
  setTab(tab: MarketplaceTab): void {
    this.patch({
      tab,
      page: 1,
      detail: null,
      detailStatus: 'idle',
      ...tab === 'installed' ? { category: 'all' } : {},
    })
    if (tab !== 'custom') void this.search(true)
  }

  /**
   * Update the search box; debounces Host calls.
   * @param query - free text.
   */
  setQuery(query: string): void {
    this.patch({ query, page: 1 })
    if (this.debounce !== undefined) clearTimeout(this.debounce)
    this.debounce = setTimeout(() => {
      this.debounce = undefined
      void this.search(true)
    }, 250)
  }

  /**
   * Restrict to one catalog source.
   * @param source - filter value.
   */
  setSource(source: SourceFilter): void {
    this.patch({
      source,
      page: 1,
      category: 'all',
      kind: 'all',
      detail: null,
      detailStatus: 'idle',
    })
    void this.search(true)
  }

  /**
   * Restrict to one Hub community category.
   * @param category - `all` or a Hub category id.
   */
  setCategory(category: string): void {
    this.patch({ category, page: 1, detail: null, detailStatus: 'idle' })
    void this.search(true)
  }

  /**
   * Restrict Codex rows to one capability.
   * @param kind - `all` or a Codex kind.
   */
  setKind(kind: 'all' | CatalogKind): void {
    this.patch({ kind, page: 1, detail: null, detailStatus: 'idle' })
    void this.search(true)
  }

  /**
   * Change Hub sort (stars / forks / updated / added).
   * @param sort - sort key.
   */
  setSort(sort: CatalogSort): void {
    this.patch({ sort, page: 1 })
    void this.search(true)
  }

  /**
   * Move to another result page.
   * @param page - 1-based page index.
   */
  setPage(page: number): void {
    this.patch({ page: Math.max(1, page) })
    void this.search(false)
  }

  /**
   * Update the custom-install spec field.
   * @param spec - npm name, github:owner/repo, or path.
   */
  setCustomSpec(spec: string): void {
    this.patch({ customSpec: spec })
  }

  /** Clear the detail dialog. */
  clearDetail(): void {
    this.patch({ detail: null, detailStatus: 'idle' })
  }

  /**
   * Open one entry's detail from the Host.
   * @param id - catalog entry id.
   */
  async openDetail(id: string): Promise<void> {
    this.patch({ detailStatus: 'loading' })
    const result = await this.ctx.remote.pluginCatalog.get(id)
    if (!result.ok) {
      this.patch({
        detailStatus: 'error',
        errorMessage: result.error.message,
        notice: {
          kind: 'error',
          textKey: 'noticeFailed',
          message: result.error.message,
          seq: ++this.noticeSeq,
        },
      })
      return
    }
    const current = this.store.getSnapshot().result?.entries.find(entry => entry.id === id)
    const detail = result.value.source === 'community' && current !== undefined
      ? { ...result.value, installed: current.installed, enabled: current.enabled === true }
      : result.value
    this.patch({ detail, detailStatus: 'idle' })
  }

  /**
   * Install or update the selected (or listed) entry.
   * @param id - catalog entry id.
   */
  async install(id: string): Promise<void> {
    await this.runAction(id, () => this.ctx.remote.pluginCatalog.installEntry(id), 'install')
  }

  /**
   * Uninstall the selected entry.
   * @param id - catalog entry id.
   */
  async uninstall(id: string): Promise<void> {
    await this.runAction(id, () => this.ctx.remote.pluginCatalog.uninstall(id), 'uninstall')
  }

  /**
   * Change activation of an installed entry.
   * @param id - catalog entry id.
   * @param enabled - requested activation state.
   */
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const state = this.store.getSnapshot()
    const entry = state.detail?.id === id ? state.detail : state.result?.entries.find(item => item.id === id)
    await this.runAction(id, async () => {
      if (entry?.source !== 'community') return await this.ctx.remote.pluginCatalog.setEnabled(id, enabled)
      const remote = await this.ctx.remote.pluginManager.setBundleEnabled(entry.name, enabled)
      if (!remote.ok) return remote
      const change = remote.value
      const ok = change.application === 'applied' || change.application === 'restart-required'
      return { ok: true, value: {
        ok,
        code: ok ? enabled ? 'enabled' : 'disabled' : 'failed',
        message: change.error?.code ?? change.application,
        restartRequired: change.application === 'restart-required',
      } }
    }, enabled ? 'enable' : 'disable')
  }

  /** Install the custom spec through plugin-manager. */
  async installCustom(): Promise<void> {
    if (this.store.getSnapshot().busyId !== null) return
    const spec = this.store.getSnapshot().customSpec.trim()
    if (spec.length === 0) {
      this.patch({
        notice: { kind: 'error', textKey: 'noticeEmptySpec', seq: ++this.noticeSeq },
      })
      return
    }
    const manager = this.ctx.remote.pluginManager
    this.patch({ busyId: 'custom', busyOperation: 'install' })
    try {
      const remote = await manager.installBundle(spec, { enabled: true })
      if (!remote.ok) {
        this.patch({
          busyId: null,
          notice: {
            kind: 'error',
            textKey: 'noticeFailed',
            message: remote.error.message,
            seq: ++this.noticeSeq,
          },
        })
        return
      }
      const application = remote.value.application
      this.patch({
        busyId: null,
        customSpec: '',
        notice: application === 'restart-required'
          ? { kind: 'restart', textKey: 'noticeRestart', seq: ++this.noticeSeq }
          : application === 'failed' || application === 'cancelled'
            ? {
              kind: 'error',
              textKey: 'noticeFailed',
              message: remote.value.error?.code ?? application,
              seq: ++this.noticeSeq,
            }
            : { kind: 'ok', textKey: 'noticeInstalled', seq: ++this.noticeSeq },
      })
    } catch (error: unknown) {
      this.patch({
        busyId: null,
        notice: {
          kind: 'error',
          textKey: 'noticeFailed',
          message: error instanceof Error ? error.message : String(error),
          seq: ++this.noticeSeq,
        },
      })
    }
  }

  /** Dismiss the current toast. */
  dismissNotice(): void {
    this.patch({ notice: null })
  }

  private async runAction(
    id: string,
    call: () => Promise<{ ok: true; value: CatalogInstallResult } | { ok: false; error: { message: string } }>,
    mode: 'install' | 'uninstall' | 'enable' | 'disable',
  ): Promise<void> {
    if (this.store.getSnapshot().busyId !== null) return
    this.patch({ busyId: id, busyOperation: mode })
    try {
      const remote = await call()
      if (!remote.ok) {
        this.patch({
          busyId: null,
          notice: {
            kind: 'error',
            textKey: 'noticeFailed',
            message: remote.error.message,
            seq: ++this.noticeSeq,
          },
        })
        return
      }
      const outcome = remote.value
      const notice = noticeFor(outcome, mode, ++this.noticeSeq)
      const snapshot = this.store.getSnapshot()
      const detail = snapshot.detail
      const result = snapshot.result
      const updated = outcome.entry
      this.patch({
        ...result !== null && updated !== undefined ? {
          result: { ...result, entries: result.entries.map(entry => entry.id === id ? updated : entry) },
        } : {},
        busyId: null,
        notice,
        detail: detail !== null && detail.id === id ? (outcome.entry ?? detail) : this.store.getSnapshot().detail,
      })
      await this.search(false)
    } catch (error: unknown) {
      this.patch({
        busyId: null,
        notice: {
          kind: 'error',
          textKey: 'noticeFailed',
          message: error instanceof Error ? error.message : String(error),
          seq: ++this.noticeSeq,
        },
      })
    }
  }

  private async search(resetStatus: boolean): Promise<void> {
    const generation = ++this.searchGeneration
    if (resetStatus) this.patch({ status: 'loading', errorMessage: null })
    const snap = this.store.getSnapshot()
    const trimmed = snap.query.trim()
    const source = snap.source === 'all' ? undefined : snap.source
    const category = snap.category === 'all' || snap.source === 'codex' ? undefined : snap.category
    const kind = snap.source === 'codex' && snap.kind !== 'all' ? snap.kind : undefined
    const remote = await this.ctx.remote.pluginCatalog.search({
      ...trimmed.length === 0 ? {} : { query: trimmed },
      ...source === undefined ? {} : { source },
      ...category === undefined ? {} : { category },
      ...kind === undefined ? {} : { kind },
      sort: snap.sort,
      ...snap.tab === 'installed' ? { installedOnly: true } : {},
      locale: this.ctx.locale.getLocale().active === 'zh' ? 'zh' : 'en',
      page: snap.page,
      pageSize: snap.pageSize,
    })
    if (generation !== this.searchGeneration) return
    if (!remote.ok) {
      this.patch({
        status: 'error',
        errorMessage: remote.error.message,
        result: null,
      })
      return
    }
    const result = remote.value
    if (source === 'codex') {
      this.patch({ status: 'ready', result, errorMessage: null })
      return
    }
    const inventory = await this.ctx.remote.pluginManager.listBundles()
    if (generation !== this.searchGeneration) return
    if (!inventory.ok) {
      this.patch({ status: 'error', errorMessage: inventory.error.message })
      return
    }
    const bundles = inventory.value
    const update = (entry: CatalogEntry): CatalogEntry => {
      if (entry.source !== 'community') return entry
      const bundle = bundles.find(item => item.name.toLowerCase() === entry.name.toLowerCase())
      return {
        ...entry, installed: bundle?.installed === true, enabled: bundle?.enabled === true,
        ...bundle?.meta?.icon === undefined ? {} : { iconUrl: bundle.meta.icon },
      }
    }
    const detail = this.store.getSnapshot().detail
    this.patch({
      status: 'ready',
      result: { ...result, entries: result.entries.map(update) },
      detail: detail === null ? null : update(detail),
      errorMessage: null,
    })
  }

  private patch(partial: Partial<MarketplaceState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...partial })
  }
}

function noticeFor(
  outcome: CatalogInstallResult,
  mode: 'install' | 'uninstall' | 'enable' | 'disable',
  seq: number,
): MarketplaceNotice {
  if (outcome.restartRequired) {
    return { kind: 'restart', textKey: 'noticeRestart', seq }
  }
  if (outcome.ok) {
    return {
      kind: 'ok',
      textKey: mode === 'install' ? 'noticeInstalled' : mode === 'uninstall' ? 'noticeUninstalled' : mode === 'enable' ? 'noticeEnabled' : 'noticeDisabled',
      seq,
    }
  }
  switch (outcome.code) {
    case 'unsupported':
      return { kind: 'error', textKey: 'noticeUnsupported', seq }
    case 'incompatible':
      return { kind: 'error', textKey: 'noticeIncompatible', message: outcome.message, seq }
    case 'missing-manager':
      return { kind: 'error', textKey: 'noticeMissingManager', seq }
    default:
      return { kind: 'error', textKey: 'noticeFailed', message: outcome.message, seq }
  }
}
