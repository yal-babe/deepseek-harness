/** Display the existing personal-center usage and wallet data in the pet panel. */
import { useEffect, useRef } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { UsageTokenTotals } from '@deepseek-ai/dsh-usage-stats/types'
import type { PersonalCenterPageProps } from './PersonalCenterPage.tsx'
import css from './PetUsageSummary.module.css'

/**
 * Reuse the local usage fold and provider account queries without a second counter.
 * @param props - pet visibility and focus, plus the existing personal-center data owner.
 * @returns a compact usage and balance summary.
 */
export function PetUsageSummary({ visible, sessionId, taskState, t, controller, useSnapshot }:
  Pick<PropsRuntime<'pet.panel.metrics'>, 'visible' | 'sessionId' | 'taskState'> & PersonalCenterPageProps) {
  const state = useSnapshot(value => value)
  const previous = useRef({ visible: false, taskState })
  useEffect(() => {
    const opened = visible && !previous.current.visible
    const completed = (taskState === 'SUCCESS' || taskState === 'ERROR') && previous.current.taskState !== taskState
    previous.current = { visible, taskState }
    if (visible && (opened || completed)) void controller.load()
  }, [visible, controller, taskState])
  const number = (tokens: UsageTokenTotals): string =>
    (tokens.uncachedInputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens + tokens.outputTokens).toLocaleString(t('numberLocale'))
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
    {state.usage !== null && <small>{state.cached ? t('petCached') : t('petUpdated')} · {new Date(state.usage.generatedAt).toLocaleTimeString(t('numberLocale'))}</small>}
    <Button size="sm" variant="ghost" onClick={() => { void controller.load() }}>{t('petRefresh')}</Button>
  </section>
}
