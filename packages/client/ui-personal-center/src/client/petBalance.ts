/** Balance readings the personal center reports to the pet's balance animation. */
import type { PetBalanceReading } from '@deepseek-ai/dsh-client-ui-pet/client'
import type { PersonalCenterPageProps } from './PersonalCenterPage.tsx'
import type { PersonalCenterState } from './store.ts'

/**
 * DeepSeek CNY balance at or above which the pet treats the balance as untouched.
 * This is the reference PC2005-cloud/dsh-pet uses for both of its DeepSeek
 * routes (`DEEPSEEK_FULL_BALANCE`, ¥20); there is no USD reference, so USD
 * wallets are not animated.
 */
export const DEEPSEEK_FULL_BALANCE_CNY = 20

/**
 * Readings the pet can animate from the loaded personal-center state: each
 * DeepSeek CNY wallet against {@link DEEPSEEK_FULL_BALANCE_CNY} (an overdraft
 * counts as all used), and the most used standard Codex quota window.
 * Unknown or unsigned values produce no reading.
 * @param state - loaded personal-center state.
 * @param t - personal-center dictionary lookup.
 * @returns zero or more readings.
 */
export function petBalanceReadings(state: PersonalCenterState, t: PersonalCenterPageProps['t']): PetBalanceReading[] {
  const readings: PetBalanceReading[] = []
  for (const wallet of state.deepseek.status === 'ready' ? state.deepseek.wallets ?? [] : []) {
    const balance = Number(wallet.balance)
    if (wallet.currency !== 'CNY' || wallet.balance.trim() === '' || !Number.isFinite(balance)) continue
    const remaining = Math.max(0, balance) / DEEPSEEK_FULL_BALANCE_CNY * 100
    readings.push({ usedPercent: Math.max(0, Math.min(100, 100 - remaining)), label: `${t('deepseekBalance')} ${wallet.currency} ${wallet.balance}` })
  }
  const codex = state.quota.codex
  const remaining = codex?.status === 'ready'
    ? codex.windows.filter(window => window.group === 'standard' && window.remainingPercent !== null).map(window => window.remainingPercent as number)
    : []
  if (remaining.length > 0) {
    const used = Math.max(0, Math.min(100, 100 - Math.min(...remaining)))
    readings.push({ usedPercent: used, label: t('petCodexUsed', { percent: String(Math.round(used)) }) })
  }
  return readings
}
