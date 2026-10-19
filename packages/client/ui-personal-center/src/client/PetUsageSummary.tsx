/** Display the existing personal-center usage and wallet data in the pet panel. */
import { useEffect, useRef } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { UsageTokenTotals } from '@deepseek-ai/dsh-usage-stats/types'
import type { PersonalCenterPageProps } from './PersonalCenterPage.tsx'
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
    return total === 0 && tokens.incomplete ? t('balanceUnavailable') : total.toLocaleString(t('numberLocale'))
  }
  const current = state.usage?.sessions.find(row => row.sessionId === sessionId)
  const wallets = state.deepseek.wallets
  return <section className={css.summary} aria-label={t('petTokens')} aria-busy={state.status === 'loading'}>
    <div><span>{t('petTokens')}</span><strong>{state.usage === null ? t('balanceUnavailable') : number(state.usage.totals)}</strong></div>
    <div><span>{t('petSessionTokens')}</span><span>{current === undefined ? t('balanceUnavailable') : number(current.tokens)}</span></div>
    <div><span>{t('deepseekBalance')}</span><span>{wallets?.length
      ? wallets.map(wallet => `${wallet.currency} ${wallet.balance}`).join(' / ') : t('balanceUnavailable')}</span></div>
    {state.quota.codex?.status === 'ready' && state.quota.codex.creditBalance !== null && <div>
      <span>{t('petCodexCredits')}</span><span>{state.quota.codex.creditBalance}</span>
    </div>}
    {state.deepseek.bonusWallets?.map((wallet, index) => <div key={`${wallet.currency}:${index}`}>
      <span>{t('bonusBalance')}</span><span>{wallet.currency} {wallet.balance}</span>
    </div>)}
    <small>{t('petScope')}</small>
    {state.usage?.totals.incomplete && <small>{t('partialUsage')}</small>}
    {state.usage !== null && <small>{state.cached ? t('petCached') : t('petUpdated')} · {new Date(state.usage.generatedAt).toLocaleTimeString(t('numberLocale'))}</small>}
    <Button size="sm" variant="ghost" onClick={() => { void controller.load() }}>{t('petRefresh')}</Button>
  </section>
}
