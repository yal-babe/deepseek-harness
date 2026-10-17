// @vitest-environment jsdom
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { Context } from '@deepseek-ai/cordis'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PersonalCenterStore } from '../src/client/store.ts'
import { PetUsageSummary } from '../src/client/PetUsageSummary.tsx'
import type { PersonalCenterPageProps } from '../src/client/PersonalCenterPage.tsx'
import { en } from '../src/client/locales.ts'

const t: PersonalCenterPageProps['t'] = (key) => {
  const value: unknown = Reflect.get(en, key)
  return typeof value === 'string' ? value : key
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
