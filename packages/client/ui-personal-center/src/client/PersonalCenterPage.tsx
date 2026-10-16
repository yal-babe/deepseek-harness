/** Personal Center main panel. */

import { useEffect, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AntigravityQuotaView, CodexQuotaView, QuotaWindowView } from '@deepseek-ai/dsh-api-provider-quota/types'
import type { UsageSnapshot, UsageTokenTotals } from '@deepseek-ai/dsh-usage-stats/types'
import { formatGmt8 } from './formatGmt8.ts'
import type { PersonalCenterKey } from './locales.ts'
import type { HeatmapMode, PersonalCenterStore } from './store.ts'
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

const WEEKDAYS: PersonalCenterKey[] = [
  'weekdayMon', 'weekdayTue', 'weekdayWed', 'weekdayThu', 'weekdayFri', 'weekdaySat', 'weekdaySun',
]
const HEAT_WEEKS = 26

/**
 * Render local usage and quota windows.
 * @param props - locale seat and injected store.
 */
export function PersonalCenterPage({
  t, controller, useSnapshot, openSession,
}: PersonalCenterPageProps): ReactNode {
  const state = useSnapshot(value => value)
  useEffect(() => { void controller.load() }, [controller])
  const usage = state.usage
  const today = usage === null ? emptyTokens() : todayTokens(usage)
  const recents = (usage?.sessions ?? []).filter(row => sum(row.tokens) > 0).slice(0, 20)
  return <div className={css.page}>
    <header className={css.head}>
      <div>
        <h1 className={css.title}>{t('title')}</h1>
        <p className={css.intro}>{t('intro')}</p>
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
            <Kpi label={t('deepseekBalance')} value={state.deepseek.status === 'ready' ? (state.deepseek.balance ?? t('unsigned')) : state.deepseek.status === 'failed' ? t('quotaFailed') : t('unsigned')} />
            <Kpi label={t('spend')} value={t('spendUnavailable')} />
            <Kpi label={t('today')} value={formatTokens(sum(today))} hint={t('tokens')} />
            <Kpi label={t('allTime')} value={formatTokens(sum(usage?.totals ?? emptyTokens()))} hint={t('tokens')} />
            <Kpi label={t('sessions')} value={String(usage?.sessionCount ?? 0)} />
            <Kpi label={t('toolCalls')} value={String(usage?.toolCalls ?? 0)} />
          </section>
          <section className={css.quotaColumn} aria-label={t('quota')}>
            <ProviderWindows title={t('codexTitle')} status={state.quota.codex?.status}
              windows={codexWindows(state.quota.codex)} t={t} />
            <ProviderWindows title={t('antigravityTitle')} status={state.quota.antigravity?.status}
              windows={antigravityWindows(state.quota.antigravity)} t={t} />
          </section>
          <section className={css.card}>
            <h2 className={css.sectionTitle}>{t('heatmap')}</h2>
            <div className={css.modes}>
              {(['daily', 'weekly', 'cumulative'] as const).map(mode => (
                <Button key={mode} variant={state.heatmap === mode ? 'primary' : 'outline'}
                  onClick={() => { controller.setHeatmap(mode) }}>{t(mode)}</Button>
              ))}
            </div>
            {usage === null || usage.days.length === 0 ? <p className={css.muted}>{t('empty')}</p>
              : <Heatmap usage={usage} mode={state.heatmap} t={t} />}
          </section>
          <section className={css.kpis} aria-label={t('tokens')}>
            <Kpi label={t('uncached')} value={formatTokens((usage?.totals ?? emptyTokens()).uncachedInputTokens)} />
            <Kpi label={t('cacheRead')} value={formatTokens((usage?.totals ?? emptyTokens()).cacheReadTokens)} />
            <Kpi label={t('cacheWrite')} value={formatTokens((usage?.totals ?? emptyTokens()).cacheWriteTokens)} />
            <Kpi label={t('output')} value={formatTokens((usage?.totals ?? emptyTokens()).outputTokens)} />
          </section>
          <div className={css.split}>
            <section className={css.card}>
              <h2 className={css.sectionTitle}>{t('models')}</h2>
              <ul className={css.list}>
                {(usage?.models ?? []).map(row => (
                  <li key={row.model} className={css.row}>
                    <span>{row.model.length > 0 ? row.model : t('noModel')}</span>
                    <span>{formatTokens(sum(row.tokens))}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className={css.card}>
              <h2 className={css.sectionTitle}>{t('tools')}</h2>
              <ul className={css.list}>
                {(usage?.tools ?? []).map(row => (
                  <li key={row.name} className={css.row}><span>{row.name}</span><span>{String(row.count)}</span></li>
                ))}
              </ul>
            </section>
          </div>
          <section className={css.card}>
            <h2 className={css.sectionTitle}>{t('recents')}</h2>
            {recents.length === 0 ? <p className={css.muted}>{t('empty')}</p>
              : <ul className={css.list}>
                {recents.map(row => (
                  <li key={row.sessionId} className={css.row}>
                    <button type="button" onClick={() => { openSession(SessionId(row.sessionId)) }}>{row.title}</button>
                    <span className={css.muted}>{formatTokens(sum(row.tokens))} · {formatGmt8(row.updatedAt)}</span>
                  </li>
                ))}
              </ul>}
          </section>
        </>}
  </div>
}

function ProviderWindows({ title, status, windows, t }: {
  title: string
  status: 'unsigned' | 'ready' | 'failed' | undefined
  windows: QuotaWindowView[]
  t: (key: PersonalCenterKey) => string
}): ReactNode {
  return <div className={css.card}>
    <strong>{title}</strong>
    {status !== 'ready' ? <span className={css.muted}>
      {status === 'failed' ? t('quotaFailed') : t('unsigned')}
    </span>
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
  if (mode === 'cumulative') {
    return <div className={css.heatCells}>
      <span className={css.cell} data-level="4" title={String(sum(usage.totals))} />
    </div>
  }
  if (mode === 'weekly') {
    const cells = weeklyCells(usage)
    const max = Math.max(1, ...cells.map(cell => cell.tokens))
    return <div className={css.heatCells}>
      {cells.map((cell) => {
        const ratio = cell.tokens / max
        const level = cell.tokens === 0 ? 0 : ratio < 0.25 ? 1 : ratio < 0.5 ? 2 : ratio < 0.75 ? 3 : 4
        return <span key={cell.key} className={css.cell} data-level={String(level)} title={`${cell.key}: ${String(cell.tokens)}`} />
      })}
    </div>
  }
  const grid = calendarGrid(usage)
  const max = Math.max(1, ...grid.cells.map(cell => cell.tokens))
  return <div className={css.heatCalendar}>
    <div className={css.heatWeekdays}>
      {WEEKDAYS.map(day => <span key={day}>{t(day)}</span>)}
    </div>
    <div className={css.heatGrid}>
      {grid.cells.map((cell) => {
        const ratio = cell.tokens / max
        const level = cell.tokens === 0 ? 0 : ratio < 0.25 ? 1 : ratio < 0.5 ? 2 : ratio < 0.75 ? 3 : 4
        return <span key={cell.key} className={css.cell} data-level={String(level)} title={`${cell.key}: ${String(cell.tokens)}`} />
      })}
    </div>
    <div className={css.heatLegend}>
      <span>{t('less')}</span>
      {[0, 1, 2, 3, 4].map(level => <span key={level} className={css.cell} data-level={String(level)} />)}
      <span>{t('more')}</span>
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
    const week = day.day.slice(0, 8) + weekBucket(day.day)
    weeks.set(week, (weeks.get(week) ?? 0) + sum(day.tokens))
  }
  return [...weeks.entries()].map(([key, tokens]) => ({ key, tokens }))
}

function weekBucket(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`)
  const index = Math.floor((date.getUTCDate() - 1) / 7)
  return String(index)
}

function todayTokens(usage: UsageSnapshot): UsageTokenTotals {
  const today = localDay(Date.now(), usage.timezoneOffsetSeconds)
  return usage.days.find(row => row.day === today)?.tokens ?? emptyTokens()
}

function emptyTokens(): UsageTokenTotals {
  return { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }
}

function sum(tokens: UsageTokenTotals): number {
  return tokens.uncachedInputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens + tokens.outputTokens
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

function antigravityWindows(view: AntigravityQuotaView | null | undefined): QuotaWindowView[] {
  if (view?.status !== 'ready') return []
  return view.groups.flatMap(group => group.buckets)
}
