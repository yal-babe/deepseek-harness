/** Personal Center main panel. */

import { useEffect, type ReactNode } from 'react'
import { Button, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AntigravityQuotaView, CodexQuotaView, QuotaWindowView } from '@deepseek-ai/dsh-api-provider-quota/types'
import type { UsageSnapshot, UsageTokenTotals } from '@deepseek-ai/dsh-usage-stats/types'
import { formatGmt8 } from './formatGmt8.ts'
import type { PersonalCenterKey } from './locales.ts'
import type { AccountWallet } from '@deepseek-ai/dsh-deepseek-account/types'
import type { DeepSeekSummary, HeatmapMode, PersonalCenterStore } from './store.ts'
import css from './PersonalCenterPage.module.css'

/** Injected store and session opener. */
export interface PersonalCenterInjected {
  controller: PersonalCenterStore
  hooks: { snapshot: PersonalCenterStore['store'] }
  openSession: (sessionId: SessionId) => void
}

/** Props the renderer binds. */
export type PersonalCenterPageProps =
  PropsLocale<'personalCenter'> & InjectFace<PersonalCenterInjected>

const HEAT_WEEKS = 53

/**
 * Render local usage and quota windows.
 * @param props - locale seat and injected store.
 */
export function PersonalCenterPage({
  t, controller, useSnapshot, openSession,
}: PersonalCenterPageProps): ReactNode {
  const state = useSnapshot(value => value)
  useEffect(() => {
    const stop = controller.observeUsage()
    void controller.load()
    return stop
  }, [controller])
  const usage = state.usage
  const today = usage === null ? undefined : todayTokens(usage)
  const unknownUsage = usage === null || (sum(usage.totals) === 0 && usage.totals.incomplete === true)
  const recents = (usage?.sessions ?? []).filter(row => sum(row.tokens) > 0 || row.tokens.incomplete).slice(0, 20)
  return <div className={css.page}>
    <header className={css.head}>
      <div>
        <h1 className={css.title}>{t('title')}</h1>
        <p className={css.intro}>{t('intro')}</p>
        {usage?.totals.incomplete && <p className={css.muted}>{t('partialUsage')}</p>}
      </div>
      {(state.status === 'error' || state.cached) && <Button variant="outline" onClick={() => { void controller.load() }}>{t('retry')}</Button>}
    </header>
    {state.status === 'error' && usage === null ? <p className={css.muted}>{t('loadFailed')}</p>
      : state.status === 'loading' && usage === null ? <div className={css.kpis} aria-busy="true">
        <div className={css.card}><div className={css.skeleton} /><div className={css.skeleton} /></div>
        <div className={css.card}><div className={css.skeleton} /><div className={css.skeleton} /></div>
      </div>
        : <>
          {state.status === 'error' && <p className={css.muted}>{t('loadFailed')}</p>}
          <section className={css.kpis} aria-label={t('tokens')}>
            <Kpi label={t('today')} value={formatUsage(today, t('balanceUnavailable'))} hint={t('tokens')} />
            <Kpi label={t('allTime')} value={formatUsage(usage?.totals, t('balanceUnavailable'))} hint={t('tokens')} />
            <Kpi label={t('sessions')} value={String(usage?.sessionCount ?? 0)} />
            <Kpi label={t('toolCalls')} value={String(usage?.toolCalls ?? 0)} />
          </section>
          <section className={css.card}>
            <div className={css.activityHead}>
              <h2 className={css.sectionTitle}>{t('heatmap')}</h2>
              <div className={css.modes}>
                {(['daily', 'weekly', 'cumulative'] as const).map(mode => (
                  <Button key={mode} className={css.modeButton} variant="ghost" aria-pressed={state.heatmap === mode}
                    onClick={() => { controller.setHeatmap(mode) }}>{t(mode)}</Button>
                ))}
              </div>
            </div>
            {usage === null || usage.days.length === 0 ? <p className={css.muted}>{t('empty')}</p>
              : <Heatmap usage={usage} mode={state.heatmap} t={t} />}
          </section>
          <section className={css.quotaColumn} aria-label={t('quota')}>
            <WalletCard summary={state.deepseek} t={t} />
            <ProviderWindows title={t('codexTitle')} status={state.quota.codex?.status}
              windows={codexWindows(state.quota.codex)} t={t} />
            <ProviderWindows title={t('antigravityTitle')} status={state.quota.antigravity?.status}
              windows={[]} groups={state.quota.antigravity?.groups} t={t} />
          </section>
          <section className={css.kpis} aria-label={t('tokens')}>
            <Kpi label={t('uncached')} value={unknownUsage ? t('balanceUnavailable') : formatTokens((usage?.totals ?? emptyTokens()).uncachedInputTokens)} />
            <Kpi label={t('cacheRead')} value={unknownUsage || usage?.totals.cacheReadUnknown ? t('balanceUnavailable') : formatTokens((usage?.totals ?? emptyTokens()).cacheReadTokens)} />
            <Kpi label={t('cacheWrite')} value={unknownUsage || usage?.totals.cacheWriteUnknown ? t('balanceUnavailable') : formatTokens((usage?.totals ?? emptyTokens()).cacheWriteTokens)} />
            <Kpi label={t('output')} value={unknownUsage ? t('balanceUnavailable') : formatTokens((usage?.totals ?? emptyTokens()).outputTokens)} />
          </section>
          <div className={css.split}>
            <section className={css.card}>
              <h2 className={css.sectionTitle}>{t('models')}</h2>
              {(usage?.models.length ?? 0) === 0 && <p className={css.emptyList}>{t('emptyModels')}</p>}
              <ul className={css.list}>
                {(usage?.models ?? []).map(row => (
                  <li key={JSON.stringify([row.provider, row.model])} className={css.row}>
                    <span><span>{row.provider}</span> / <span>{row.model.length > 0 ? row.model : t('noModel')}</span></span>
                    <span className={css.value}>{formatUsage(row.tokens, t('balanceUnavailable'))}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className={css.card}>
              <h2 className={css.sectionTitle}>{t('tools')}</h2>
              {(usage?.tools.length ?? 0) === 0 && <p className={css.emptyList}>{t('emptyTools')}</p>}
              <ul className={css.list}>
                {(usage?.tools ?? []).map(row => (
                  <li key={row.name} className={css.row}><span>{row.name}</span><span className={css.value}>{String(row.count)}</span></li>
                ))}
              </ul>
            </section>
          </div>
          <section className={css.card}>
            <h2 className={css.sectionTitle}>{t('recents')}</h2>
            {recents.length === 0 ? <p className={css.muted}>{t('empty')}</p>
              : <ul className={css.list}>
                {recents.map(row => (
                  <li key={row.sessionId} className={css.sessionItem}>
                    <button className={css.sessionButton} type="button" aria-label={row.title} onClick={() => { openSession(SessionId(row.sessionId)) }}>
                      <span className={css.sessionTitle}>{row.title}</span>
                      <span className={css.sessionMeta}>
                        <span className={css.value}>{formatUsage(row.tokens, t('balanceUnavailable'))}</span>
                        <span className={css.muted}>{formatGmt8(row.updatedAt)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>}
          </section>
        </>}
  </div>
}

function WalletCard({ summary, t }: { summary: DeepSeekSummary; t: (key: PersonalCenterKey) => string }): ReactNode {
  const wallets = summary.wallets ?? []
  const bonusWallets = summary.bonusWallets ?? []
  return <section className={css.card}>
    <h2 className={css.sectionTitle}>{t('deepseekBalance')}</h2>
    {summary.status !== 'ready' ? <p className={css.muted}>{t(summary.status === 'failed' ? 'quotaFailed' : 'unsigned')}</p>
      : <>
        <div className={css.windowMeta}>
          <span className={css.muted}>{t('rechargeBalance')}</span>
          <span className={css.value}>{wallets.length === 0 ? summary.balance ?? t('balanceUnavailable') : wallets.map(walletAmount).join(' + ')}</span>
        </div>
        {bonusWallets.length === 0 ? <div className={css.windowMeta}>
          <span className={css.muted}>{t('bonusBalance')}</span><span className={css.value}>{t(summary.wallets === undefined ? 'balanceUnavailable' : 'noBonus')}</span>
        </div> : bonusWallets.map((wallet) => {
          const expires = wallet.expiresAt == null ? NaN : Date.parse(wallet.expiresAt)
          return <div className={css.window} key={wallet.currency}>
            <div className={css.windowMeta}>
              <span className={css.muted}>{t('bonusBalance')}</span><span className={css.value}>{walletAmount(wallet)}</span>
            </div>
            {Number.isFinite(expires) && <span className={css.muted}>{t('bonusExpires')} {formatGmt8(expires)}</span>}
          </div>
        })}
      </>}
  </section>
}

function walletAmount(wallet: AccountWallet): string {
  return `${wallet.currency === 'CNY' ? '¥' : '$'}${Number(wallet.balance).toFixed(2)}`
}

function ProviderWindows({ title, status, windows, groups, t }: {
  title: string
  status: 'unsigned' | 'ready' | 'failed' | undefined
  windows: QuotaWindowView[]
  groups?: AntigravityQuotaView['groups'] | undefined
  t: (key: PersonalCenterKey) => string
}): ReactNode {
  return <div className={css.card}>
    <strong>{title}</strong>
    {status !== 'ready' ? <span className={css.muted}>
      {status === 'failed' ? t('quotaFailed') : t('unsigned')}
    </span>
      : groups !== undefined && groups.length > 0 ? groups.map(group => <div className={css.quotaGroup} key={group.id}>
        <span className={css.groupLabel}>{group.label ?? group.id}</span>
        {group.buckets.map(window => <WindowRow key={window.id} window={window} t={t} />)}
      </div>)
        : windows.length === 0 ? <span className={css.muted}>{t('empty')}</span>
          : windows.map(window => <WindowRow key={window.id} window={window} t={t} />)}
  </div>
}

function WindowRow({ window, t }: { window: QuotaWindowView; t: (key: PersonalCenterKey) => string }): ReactNode {
  const remaining = window.remainingPercent
  return <div className={css.window}>
    <div className={css.windowMeta}>
      <span>{windowLabel(window, t)}</span>
      <span>{remaining === null ? '—' : `${String(Math.round(remaining))}% ${t('remaining')}`}</span>
    </div>
    <div className={css.windowTrack} aria-hidden="true">
      <div className={css.windowFill} style={{ width: remaining === null ? '0%' : `${String(Math.max(0, Math.min(100, remaining)))}%` }} />
    </div>
    {window.resetAtMs !== null && <span className={css.muted}>{t('resetsAt')} {formatGmt8(window.resetAtMs)}</span>}
  </div>
}

function windowLabel(window: QuotaWindowView, t: (key: PersonalCenterKey) => string): string {
  const kind = window.kind === 'fiveHour' || window.kind === '5h' ? t('windowFiveHour')
    : window.kind === 'weekly' ? t('windowWeekly')
      : window.kind === 'monthly' ? t('windowMonthly')
        : t('windowUnknown')
  if (window.group === 'codeReview') return `${t('windowCodeReview')} · ${kind}`
  if (window.group === 'additional' && window.featureName !== null && window.featureName.length > 0) {
    return `${window.featureName} · ${kind}`
  }
  return kind
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }): ReactNode {
  return <div className={css.card}>
    <span className={css.muted}>{label}</span>
    <span className={css.metric}>{value}</span>
    {hint !== undefined && <span className={css.muted}>{hint}</span>}
  </div>
}

function Heatmap({ usage, mode, t }: {
  usage: UsageSnapshot
  mode: HeatmapMode
  t: (key: PersonalCenterKey) => string
}): ReactNode {
  const grid = calendarGrid(usage)
  if (mode === 'weekly') {
    const weeks = new Map(weeklyCells(usage).map(cell => [cell.key, cell.tokens]))
    for (let index = 0; index < grid.cells.length; index += 7) {
      const first = grid.cells[index]
      if (first === undefined) continue
      for (const cell of grid.cells.slice(index, index + 7)) cell.tokens = weeks.get(first.key) ?? 0
    }
  }
  if (mode === 'cumulative') {
    let total = 0
    for (const cell of grid.cells) {
      total += cell.tokens
      cell.tokens = total
    }
  }
  const today = localDay(Date.now(), usage.timezoneOffsetSeconds)
  const max = Math.max(1, ...grid.cells.map(cell => cell.tokens))
  const months = grid.cells.filter((cell, index) =>
    index % 7 === 0 && (index === 0 || cell.key.slice(0, 7) !== grid.cells[index - 7]?.key.slice(0, 7)))
  return <div className={css.heatCalendar}>
    <div className={css.heatGrid}>
      {grid.cells.map((cell) => {
        const ratio = cell.tokens / max
        const level = cell.tokens === 0 ? 0 : ratio < 0.25 ? 1 : ratio < 0.5 ? 2 : ratio < 0.75 ? 3 : 4
        const date = dateOfDay(cell.key)
        const day = t('activityDate').replace('{month}', String(date.getUTCMonth() + 1))
          .replace('{day}', String(date.getUTCDate()))
        const count = new Intl.NumberFormat(t('numberLocale'), { notation: 'compact', maximumFractionDigits: 1 }).format(cell.tokens)
        const label = `${day}\n${count} ${t('tokens')}`
        return <Tooltip key={cell.key} label={label} side="top" portal disabled={cell.key > today}>
          <span className={css.cell} role="img" tabIndex={cell.key <= today && cell.tokens > 0 ? 0 : undefined}
            aria-label={label} data-future={cell.key > today || undefined} data-level={String(level)} />
        </Tooltip>
      })}
    </div>
    <div className={css.heatMonths} aria-hidden="true">
      {months.map(cell => <span key={cell.key}
        style={{ gridColumn: String(Math.floor(grid.cells.indexOf(cell) / 7) + 1) }}>
        {t('activityMonth').replace('{month}', String(dateOfDay(cell.key).getUTCMonth() + 1))}
      </span>)}
    </div>
  </div>
}

function calendarGrid(usage: UsageSnapshot): { cells: { key: string; tokens: number }[] } {
  const byDay = new Map(usage.days.map(day => [day.day, sum(day.tokens)]))
  const today = localDay(Date.now(), usage.timezoneOffsetSeconds)
  const todayDate = dateOfDay(today)
  const weekday = (todayDate.getUTCDay() + 6) % 7
  const end = new Date(todayDate)
  end.setUTCDate(end.getUTCDate() + (6 - weekday))
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - (HEAT_WEEKS * 7 - 1))
  const cells: { key: string; tokens: number }[] = []
  const cursor = new Date(start)
  while (cursor.getTime() <= end.getTime()) {
    const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}-${String(cursor.getUTCDate()).padStart(2, '0')}`
    cells.push({ key, tokens: byDay.get(key) ?? 0 })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return { cells }
}

function dateOfDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`)
}

function weeklyCells(usage: UsageSnapshot): { key: string; tokens: number }[] {
  const weeks = new Map<string, number>()
  for (const day of usage.days) {
    const date = dateOfDay(day.day)
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7)
    const week = date.toISOString().slice(0, 10)
    weeks.set(week, (weeks.get(week) ?? 0) + sum(day.tokens))
  }
  return [...weeks.entries()].map(([key, tokens]) => ({ key, tokens }))
}

function todayTokens(usage: UsageSnapshot): UsageTokenTotals {
  const today = localDay(Date.now(), usage.timezoneOffsetSeconds)
  const tokens = usage.days.find(row => row.day === today)?.tokens ?? emptyTokens()
  return usage.totals.incomplete ? { ...tokens, incomplete: true } : tokens
}

function emptyTokens(): UsageTokenTotals {
  return { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }
}

function sum(tokens: UsageTokenTotals): number {
  return tokens.totalTokens ?? tokens.uncachedInputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens + tokens.outputTokens
}

function formatUsage(tokens: UsageTokenTotals | undefined, unavailable: string): string {
  if (tokens === undefined || (sum(tokens) === 0 && tokens.incomplete)) return unavailable
  return formatTokens(sum(tokens))
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

function localDay(ms: number, offsetSeconds: number): string {
  const local = new Date(ms + offsetSeconds * 1000)
  const year = local.getUTCFullYear()
  const month = String(local.getUTCMonth() + 1).padStart(2, '0')
  const day = String(local.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function codexWindows(view: CodexQuotaView | null | undefined): QuotaWindowView[] {
  return view?.status === 'ready' ? view.windows : []
}
