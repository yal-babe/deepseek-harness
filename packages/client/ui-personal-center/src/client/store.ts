/** Cached Host usage snapshot plus live tokenUsage from the open Session. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-token-meter/src/projection.ts'
import type { UsageSnapshot, UsageTokenTotals } from '@deepseek-ai/dsh-usage-stats/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AccountClientMetadata } from '@deepseek-ai/dsh-deepseek-account/types'
import type { AntigravityQuotaView, CodexQuotaView } from '@deepseek-ai/dsh-api-provider-quota/types'

const emptyTokens = (): UsageTokenTotals => ({
  uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0,
})

/** Viewing grain for the heatmap. */
export type HeatmapMode = 'daily' | 'weekly' | 'cumulative'

/** DeepSeek wallet summary drawn from the account Remote. */
export interface DeepSeekSummary {
  status: 'unsigned' | 'ready' | 'failed'
  name: string | null
  balance: string | null
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
  return `dsh.usage-stats.v1:${typeof location === 'undefined' ? 'local' : location.host}`
}

/**
 * Load, cache, and merge local usage for the Personal Center.
 */
export class PersonalCenterStore {
  readonly store: SnapshotStore<PersonalCenterState>
  private generation = 0

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
    this.generation += 1
  }

  /**
   * Open the panel: paint cache, then refresh Host usage and quota.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    const current = this.store.getSnapshot()
    this.store.set({
      ...current,
      status: current.usage === null ? 'loading' : current.status,
    })
    const offset = -new Date().getTimezoneOffset() * 60
    try {
      const [result, deepseek, quota] = await Promise.all([
        this.ctx.remote.usageStats.snapshot(offset),
        this.loadDeepSeek(),
        this.loadQuota(),
      ])
      if (generation !== this.generation) return
      if (!result.ok) {
        this.store.set({
          ...this.store.getSnapshot(),
          deepseek,
          quota,
          status: current.usage === null ? 'error' : 'ready',
          cached: current.usage !== null,
        })
        return
      }
      writeCache(result.value)
      this.store.set({
        ...this.store.getSnapshot(),
        status: 'ready',
        usage: result.value,
        deepseek,
        quota,
        cached: false,
      })
    } catch (_usageUnavailable) {
      if (generation !== this.generation) return
      this.store.set({
        ...this.store.getSnapshot(),
        status: current.usage === null ? 'error' : 'ready',
        cached: current.usage !== null,
      })
    }
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
        balance: primary === undefined ? null : formatBalance(primary.balance, primary.currency === 'CNY' ? '¥' : '$'),
      }
    } catch (_accountUnavailable) {
      return { status: 'failed', name: null, balance: null }
    }
  }

  /**
   * Replace the current session's token row from the live projection.
   * @param sessionId - open session.
   * @param tokens - latest tokenUsage totals.
   */
  mergeSession(sessionId: SessionId, tokens: UsageTokenTotals): void {
    const current = this.store.getSnapshot()
    if (current.usage === null) return
    const usage = structuredClone(current.usage)
    const existing = usage.sessions.find(row => row.sessionId === String(sessionId))
    const previous = existing?.tokens ?? emptyTokens()
    if (existing === undefined) {
      usage.sessions.unshift({
        sessionId: String(sessionId),
        title: String(sessionId),
        tokens,
        updatedAt: Date.now(),
      })
      usage.sessionCount += 1
    } else {
      existing.tokens = tokens
      existing.updatedAt = Date.now()
    }
    addDelta(usage.totals, previous, tokens)
    const today = localDay(Date.now(), usage.timezoneOffsetSeconds)
    const day = usage.days.find(row => row.day === today)
    if (day !== undefined) addDelta(day.tokens, previous, tokens)
    else {
      usage.days.push({ day: today, tokens: { ...tokens }, sessionCount: 1, toolCalls: 0 })
    }
    writeCache(usage)
    this.store.set({ ...current, usage, status: 'ready' })
  }

  /**
   * @param mode - heatmap grain.
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

function addDelta(into: UsageTokenTotals, previous: UsageTokenTotals, next: UsageTokenTotals): void {
  into.uncachedInputTokens += next.uncachedInputTokens - previous.uncachedInputTokens
  into.cacheReadTokens += next.cacheReadTokens - previous.cacheReadTokens
  into.cacheWriteTokens += next.cacheWriteTokens - previous.cacheWriteTokens
  into.outputTokens += next.outputTokens - previous.outputTokens
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

function localDay(ms: number, offsetSeconds: number): string {
  const local = new Date(ms + offsetSeconds * 1000)
  const year = local.getUTCFullYear()
  const month = String(local.getUTCMonth() + 1).padStart(2, '0')
  const day = String(local.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
