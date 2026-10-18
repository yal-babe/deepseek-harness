// @vitest-environment jsdom
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { Context } from '@deepseek-ai/cordis'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PersonalCenterStore } from '../src/client/store.ts'
import { PetUsageSummary } from '../src/client/PetUsageSummary.tsx'
import { petBalanceReadings } from '../src/client/petBalance.ts'
import type { PersonalCenterPageProps } from '../src/client/PersonalCenterPage.tsx'
import { en } from '../src/client/locales.ts'

const t: PersonalCenterPageProps['t'] = (key, params) => {
  const value: unknown = Reflect.get(en, key)
  const text = typeof value === 'string' ? value : key
  return Object.entries(params ?? {}).reduce((result, [name, param]) => result.replace(`{${name}}`, String(param)), text)
}

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })

it('reuses the usage owner, leaves unknown values unavailable, and refreshes only on opening or a result', () => {
  const controller = new PersonalCenterStore(new Context())
  const load = vi.spyOn(controller, 'load').mockResolvedValue()
  const props = { visible: false, taskState: 'IDLE' as const, sessionId: SessionId('s1'), controller,
    t, useSnapshot: <T,>(selector: (state: ReturnType<typeof controller.store.getSnapshot>) => T) =>
      selector(controller.store.getSnapshot()),
    openSession: vi.fn() }
  const view = render(<PetUsageSummary {...props} />)
  expect(load).not.toHaveBeenCalled()
  expect(screen.getAllByText(en.balanceUnavailable)).toHaveLength(3)
  expect(screen.queryByText('0')).toBeNull()
  view.rerender(<PetUsageSummary {...props} visible />)
  expect(load).toHaveBeenCalledTimes(1)
  view.rerender(<PetUsageSummary {...props} visible taskState="THINKING" />)
  view.rerender(<PetUsageSummary {...props} visible taskState="WORKING" />)
  expect(load).toHaveBeenCalledTimes(1)
  view.rerender(<PetUsageSummary {...props} visible taskState="SUCCESS" />)
  expect(load).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('button', { name: en.petRefresh }))
  expect(load).toHaveBeenCalledTimes(3)
  view.unmount(); controller.dispose()
})

it('shows the same disjoint token total and wallet currencies as the existing summary', () => {
  const controller = new PersonalCenterStore(new Context())
  vi.spyOn(controller, 'load').mockResolvedValue()
  const tokens = { uncachedInputTokens: 100, cacheReadTokens: 20, cacheWriteTokens: 10, outputTokens: 5 }
  controller.store.set({ ...controller.store.getSnapshot(), status: 'ready', usage: {
    timezoneOffsetSeconds: 0, generatedAt: 1, totals: tokens, sessionCount: 1, toolCalls: 0, days: [], models: [], tools: [],
    sessions: [{ sessionId: 's1', title: 'Session', tokens, updatedAt: 1 }],
  }, deepseek: { status: 'ready', name: 'Test', balance: null, wallets: [{ currency: 'CNY', balance: '12.34' }, { currency: 'USD', balance: '5' }] } })
  const view = render(<PetUsageSummary visible taskState="IDLE" sessionId={SessionId('s1')} controller={controller} t={t}
    useSnapshot={selector => selector(controller.store.getSnapshot())} openSession={vi.fn()} />)
  expect(screen.getAllByText('135')).toHaveLength(2)
  expect(screen.getByText('CNY 12.34 / USD 5')).toBeTruthy()
  expect(screen.getByText(en.petScope)).toBeTruthy()
  view.unmount(); controller.dispose()
})

const codexWindow = (group: 'standard' | 'codeReview', remainingPercent: number | null) => ({
  id: `${group}-${String(remainingPercent)}`, kind: 'weekly' as const, group, featureName: null, remainingPercent, resetAtMs: null,
})

it('turns CNY wallets and standard Codex windows into balance readings for the pet', () => {
  const controller = new PersonalCenterStore(new Context())
  const base = controller.store.getSnapshot()
  expect(petBalanceReadings(base, t)).toEqual([])
  const state = {
    ...base,
    deepseek: { status: 'ready' as const, name: 'Test', balance: null, wallets: [
      { currency: 'CNY' as const, balance: '15' }, { currency: 'CNY' as const, balance: '-3' }, { currency: 'CNY' as const, balance: 'x' },
      { currency: 'CNY' as const, balance: '40' }, { currency: 'USD' as const, balance: '5' },
    ] },
    quota: { ...base.quota, codex: { provider: 'codex' as const, status: 'ready' as const, planType: null, subscriptionActiveUntilMs: null,
      creditBalance: null, creditsUnlimited: false, resetCredits: [], resetCreditsAvailableCount: null, models: [],
      windows: [codexWindow('standard', 70), codexWindow('standard', 40), codexWindow('standard', null), codexWindow('codeReview', 0)] } },
  }
  expect(petBalanceReadings(state, t)).toEqual([
    { usedPercent: 25, label: `${en.deepseekBalance} CNY 15` },
    { usedPercent: 100, label: `${en.deepseekBalance} CNY -3` },
    { usedPercent: 0, label: `${en.deepseekBalance} CNY 40` },
    { usedPercent: 60, label: 'Codex quota 60% used' },
  ])
  controller.dispose()
})

it('answers each new pet balance request after refreshing, even when the refresh fails', async () => {
  const controller = new PersonalCenterStore(new Context())
  const load = vi.spyOn(controller, 'load').mockResolvedValue()
  const reportBalance = vi.fn()
  const props = { visible: false, taskState: 'IDLE' as const, sessionId: SessionId('s1'), controller, t, reportBalance,
    useSnapshot: <T,>(selector: (state: ReturnType<typeof controller.store.getSnapshot>) => T) => selector(controller.store.getSnapshot()),
    openSession: vi.fn() }
  const view = render(<PetUsageSummary {...props} balanceRequest={0} />)
  expect(load).not.toHaveBeenCalled()
  controller.store.set({ ...controller.store.getSnapshot(),
    deepseek: { status: 'ready', name: 'Test', balance: null, wallets: [{ currency: 'CNY', balance: '5' }] } })
  await act(async () => { view.rerender(<PetUsageSummary {...props} balanceRequest={1} />) })
  expect(load).toHaveBeenCalledTimes(1)
  expect(reportBalance).toHaveBeenLastCalledWith([{ usedPercent: 75, label: `${en.deepseekBalance} CNY 5` }])
  await act(async () => { view.rerender(<PetUsageSummary {...props} balanceRequest={1} />) })
  expect(load).toHaveBeenCalledTimes(1)
  load.mockRejectedValueOnce(new Error('offline'))
  await act(async () => { view.rerender(<PetUsageSummary {...props} balanceRequest={2} />) })
  expect(reportBalance).toHaveBeenCalledTimes(2)
  view.unmount(); controller.dispose()
})
