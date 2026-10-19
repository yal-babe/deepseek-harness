/** Cached Host usage snapshots invalidated by durable Session settlements. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-token-meter/src/projection.ts'
import type { UsageSnapshot } from '@deepseek-ai/dsh-usage-stats/types'
import type { AccountWallet, AccountClientMetadata } from '@deepseek-ai/dsh-deepseek-account/types'
import type { AntigravityQuotaView, CodexQuotaView } from '@deepseek-ai/dsh-api-provider-quota/types'

/** Viewing grain for the heatmap. */
export type HeatmapMode = 'daily' | 'weekly' | 'cumulative'

/** DeepSeek wallet summary drawn from the account Remote. */
export interface DeepSeekSummary {
  status: 'unsigned' | 'ready' | 'failed'
  name: string | null
  balance: string | null
  /** All recharge currencies returned by the balance query. */
  wallets?: readonly AccountWallet[]
  /** Gift wallets, including expiry when Platform supplies it. */
  bonusWallets?: readonly AccountWallet[]
}

/** Codex and Antigravity cards shown on Personal Center. */
export interface PersonalQuotaSnapshot {
  codex: CodexQuotaView | null
  antigravity: AntigravityQuotaView | null
}

/** Personal Center page snapshot. */
export interface PersonalCenterState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  usage: UsageSnapshot | null
  quota: PersonalQuotaSnapshot
  deepseek: DeepSeekSummary
  heatmap: HeatmapMode
  cached: boolean
}

function cacheKey(): string {
  return `dsh.usage-stats.v2:${typeof location === 'undefined' ? 'local' : location.host}`
}

/**
 * Load, cache, and merge local usage for the Personal Center.
 */
export class PersonalCenterStore {
  /** Snapshot store holding the latest personal center state. */
  readonly store: SnapshotStore<PersonalCenterState>
  private generation = 0
  private disposed = false
  private readonly usageObservers = new Set<symbol>()
  private usageDirty = false
  private usageRefresh: Promise<void> | undefined

  /**
   * @param ctx - Client context with usageStats Remote and optional live Sessions.
   */
  constructor(private readonly ctx: ClientContext) {
    this.store = createSnapshotStore({
      status: 'idle',
      usage: readCache(),
      quota: { codex: null, antigravity: null },
      deepseek: { status: 'unsigned', name: null, balance: null },
      heatmap: 'daily',
      cached: readCache() !== null,
    })
  }

  /** Drop in-flight loads. */
  dispose(): void {
    this.disposed = true
    this.usageObservers.clear()
    this.generation += 1
  }

  /**
   * Open the panel: paint cache, then refresh Host usage and quota.
   */
  async load(): Promise<void> {
    if (this.disposed) return
    const generation = ++this.generation
    const current = this.store.getSnapshot()
    this.store.set({ ...current, status: current.usage === null ? 'loading' : current.status })
    const [, deepseek, quota] = await Promise.all([
      this.refreshUsage(), this.loadDeepSeek(), this.loadQuota(),
    ])
    if (this.disposed || generation !== this.generation) return
    this.store.set({ ...this.store.getSnapshot(), deepseek, quota })
  }

  private async loadQuota(): Promise<PersonalQuotaSnapshot> {
    const [codex, antigravity] = await Promise.all([
      this.ctx.remote.providerQuota.get('codex').then((result) => {
        if (!result.ok || result.value.provider !== 'codex') return failedCodex()
        return result.value
      }).catch((): CodexQuotaView => failedCodex()),
      this.ctx.remote.providerQuota.get('antigravity').then((result) => {
        if (!result.ok || result.value.provider !== 'antigravity') return failedAntigravity()
        return result.value
      }).catch((): AntigravityQuotaView => failedAntigravity()),
    ])
    return { codex, antigravity }
  }

  private async loadDeepSeek(): Promise<DeepSeekSummary> {
    try {
      const client = accountClient(this.ctx.locale.getSnapshot().active, process.env.DSH_CLIENT_VERSION)
      const [profile, balance] = await Promise.all([
        this.ctx.remote.account.getProfile(client),
        this.ctx.remote.account.getBalance(client),
      ])
      if (!profile.ok || profile.value === null || profile.value.status !== 'ready') {
        return { status: 'unsigned', name: null, balance: null }
      }
      const wallets = balance.ok && balance.value?.status === 'ready' ? balance.value.value : []
      const primary = wallets[0]
      return {
        status: 'ready',
        name: profile.value.value.name,
        ...balance.ok && balance.value?.status === 'ready'
          ? { wallets, bonusWallets: balance.value.bonusWallets } : {},
        balance: primary === undefined ? null : formatBalance(primary.balance, primary.currency === 'CNY' ? '¥' : '$'),
      }
    } catch (_accountUnavailable) {
      return { status: 'failed', name: null, balance: null }
    }
  }

  /**
   * Keep automatic usage refresh active while one summary is visible.
   * @returns an idempotent release operation for the mounted summary.
   */
  observeUsage(): () => void {
    const observer = Symbol()
    if (!this.disposed) this.usageObservers.add(observer)
    return () => { this.usageObservers.delete(observer) }
  }

  /**
   * Refresh usage after a durable settlement without querying provider balances.
   * Concurrent notifications share one operation; an in-flight change requests a fresh snapshot.
   * @param visibleOnly - skip automatic notifications when no summary is visible; explicit loads always refresh.
   * @returns completion of the coalesced Host refresh.
   */
  refreshUsage(visibleOnly = false): Promise<void> {
    if (visibleOnly && this.usageObservers.size === 0) return Promise.resolve()
    const current = this.store.getSnapshot()
    if (this.disposed || (current.usage === null && current.status === 'idle')) return Promise.resolve()
    this.usageDirty = true
    if (this.usageRefresh !== undefined) return this.usageRefresh
    this.usageRefresh = Promise.resolve().then(async () => {
      while (this.usageDirty && !this.disposed) {
        this.usageDirty = false
        try {
          const result = await this.ctx.remote.usageStats.snapshot(-new Date().getTimezoneOffset() * 60)
          if (this.disposed) return
          if (this.usageDirty) continue
          if (!result.ok) {
            const snapshot = this.store.getSnapshot()
            this.store.set({ ...snapshot, status: snapshot.usage === null ? 'error' : 'ready', cached: snapshot.usage !== null })
            return
          }
          writeCache(result.value)
          this.store.set({ ...this.store.getSnapshot(), status: 'ready', usage: result.value, cached: false })
        } catch (_usageUnavailable) {
          if (this.usageDirty && !this.disposed) continue
          if (!this.disposed) {
            const snapshot = this.store.getSnapshot()
            this.store.set({ ...snapshot, status: snapshot.usage === null ? 'error' : 'ready', cached: snapshot.usage !== null })
          }
          return
        }
      }
    }).finally(() => { this.usageRefresh = undefined })
    return this.usageRefresh
  }

  /**
   * Set the active heatmap display grain.
   * @param mode - Heatmap grain.
   */
  setHeatmap(mode: HeatmapMode): void {
    this.store.set({ ...this.store.getSnapshot(), heatmap: mode })
  }
}

function readCache(): UsageSnapshot | null {
  try {
    const raw = localStorage.getItem(cacheKey())
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isUsageSnapshot(parsed)) return null
    return parsed
  } catch (_invalidCache) {
    return null
  }
}

function isUsageSnapshot(value: unknown): value is UsageSnapshot {
  if (typeof value !== 'object' || value === null) return false
  if (!('totals' in value) || !('sessions' in value) || !('days' in value) || !('timezoneOffsetSeconds' in value)) {
    return false
  }
  return typeof value.timezoneOffsetSeconds === 'number'
}

function writeCache(usage: UsageSnapshot): void {
  try {
    localStorage.setItem(cacheKey(), JSON.stringify(usage))
  } catch (_quotaOrPrivate) {
    // Quota or private mode must not fail the panel.
  }
}

function accountClient(locale: string, version: string | undefined): AccountClientMetadata {
  if (version === undefined || version === '') throw new Error('account: this client build carries no DSH_CLIENT_VERSION')
  return { version, locale, timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60 }
}

function formatBalance(amount: string, symbol: '¥' | '$'): string {
  const numeric = Number(amount)
  if (!Number.isFinite(numeric) || numeric === 0) return `${symbol}0.00`
  return `${symbol}${numeric.toFixed(2)}`
}

function failedCodex(): CodexQuotaView {
  return {
    provider: 'codex',
    status: 'failed',
    planType: null,
    subscriptionActiveUntilMs: null,
    creditBalance: null,
    creditsUnlimited: false,
    windows: [],
    resetCredits: [],
    resetCreditsAvailableCount: null,
    models: [],
  }
}

function failedAntigravity(): AntigravityQuotaView {
  return { provider: 'antigravity', status: 'failed', plan: null, tierId: null, groups: [] }
}
