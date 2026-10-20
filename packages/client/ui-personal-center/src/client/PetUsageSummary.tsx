/** Display the existing personal-center usage and wallet data in the pet panel. */
import { useEffect, useRef } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { UsageTokenTotals } from '@deepseek-ai/dsh-usage-stats/types'
import { ProviderWindows, WalletCard, type PersonalCenterPageProps } from './PersonalCenterPage.tsx'
import { petBalanceReadings } from './petBalance.ts'
import css from './PetUsageSummary.module.css'

/**
 * Reuse the local usage fold and provider account queries without a second counter.
 * A pet balance request refreshes them and reports the readings the pet animates.
 * @param props - pet visibility, focus, and balance request, plus the existing personal-center data owner.
 * @returns a compact usage and balance summary.
 */
export function PetUsageSummary({ visible, sessionId, taskState, balanceRequest, reportBalance, t, controller, useSnapshot }:
  Pick<PropsRuntime<'pet.panel.metrics'>, 'visible' | 'sessionId' | 'taskState' | 'balanceRequest' | 'reportBalance'> & PersonalCenterPageProps) {
  const state = useSnapshot(value => value)
  useEffect(() => visible ? controller.observeUsage() : undefined, [visible, controller])
  const previous = useRef({ visible: false, taskState })
  useEffect(() => {
    const opened = visible && !previous.current.visible
    const completed = (taskState === 'SUCCESS' || taskState === 'ERROR') && previous.current.taskState !== taskState
    previous.current = { visible, taskState }
    if (visible && (opened || completed)) void controller.load()
  }, [visible, controller, taskState])
  // A balance request from the pet refreshes the same owner data, then reports what it can animate.
  const answered = useRef(balanceRequest)
  useEffect(() => {
    if (balanceRequest === undefined || balanceRequest === answered.current) return
    answered.current = balanceRequest
    const report = (): void => { reportBalance?.(petBalanceReadings(controller.store.getSnapshot(), t)) }
    void controller.load().then(report, report)
  }, [balanceRequest, controller])
  const number = (tokens: UsageTokenTotals): string => {
    const total = tokens.totalTokens ?? tokens.uncachedInputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens + tokens.outputTokens
    return total.toLocaleString(t('numberLocale'))
  }
  const current = state.usage?.sessions.find(row => row.sessionId === sessionId)
  return <section className={css.summary} aria-label={t('petTokens')} aria-busy={state.status === 'loading'}>
    <div><span>{t('petTokens')}</span><strong>{state.usage === null ? t('balanceUnavailable') : number(state.usage.totals)}</strong></div>
    <div><span>{t('petSessionTokens')}</span><span>{state.usage === null ? t('balanceUnavailable') : current === undefined ? (0).toLocaleString(t('numberLocale')) : number(current.tokens)}</span></div>
    <div className={css.accounts} aria-label={t('quota')}>
      {state.deepseek.status !== 'unsigned' && <WalletCard summary={state.deepseek} t={t} />}
      {state.quota.codex !== null && state.quota.codex.status !== 'unsigned' && <>
        <ProviderWindows title={t('codexTitle')} status={state.quota.codex.status} windows={state.quota.codex.windows} t={t} />
        {state.quota.codex.status === 'ready' && state.quota.codex.creditBalance !== null && <div>
          <span>{t('petCodexCredits')}</span><span>{state.quota.codex.creditBalance}</span>
        </div>}
      </>}
      {state.quota.antigravity !== null && state.quota.antigravity.status !== 'unsigned' && <ProviderWindows
        title={t('antigravityTitle')} status={state.quota.antigravity.status} windows={[]} groups={state.quota.antigravity.groups} t={t} />}
      {state.status === 'loading' && <small>{t('loading')}</small>}
      {state.deepseek.status === 'unsigned' && state.quota.codex?.status === 'unsigned'
        && state.quota.antigravity?.status === 'unsigned' && <small>{t('unsigned')}</small>}
    </div>
    <small>{t('petScope')}</small>
    {state.usage?.totals.incomplete && <small>{t('partialUsage')}</small>}
    {state.usage !== null && <small>{state.cached ? t('petCached') : t('petUpdated')} · {new Date(state.usage.generatedAt).toLocaleTimeString(t('numberLocale'))}</small>}
    <Button size="sm" variant="ghost" onClick={() => { void controller.load() }}>{t('petRefresh')}</Button>
  </section>
}
