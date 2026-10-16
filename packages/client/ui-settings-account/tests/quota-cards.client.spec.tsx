// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { CodexQuotaView } from '@deepseek-ai/dsh-api-provider-quota/types'
import { QuotaCards } from '../src/client/QuotaCards.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const ready: CodexQuotaView = {
  provider: 'codex',
  status: 'ready',
  planType: 'plus',
  subscriptionActiveUntilMs: Date.parse('2026-11-01T00:00:00.000Z'),
  creditBalance: '12.5',
  creditsUnlimited: false,
  windows: [{
    id: 'primary',
    kind: 'fiveHour',
    group: 'standard',
    featureName: null,
    remainingPercent: 60,
    resetAtMs: Date.parse('2026-10-16T08:00:00.000Z'),
  }],
  resetCredits: [{ id: 'c1', expiresAtMs: Date.parse('2026-10-16T08:00:00.000Z') }],
  resetCreditsAvailableCount: 1,
  models: [{ id: 'gpt-5.5', name: null }],
}

it('shows Codex remaining percent, expiry, models, and asks before redeeming', async () => {
  const onConsume = vi.fn(async () => {})
  render(<QuotaCards
    quota={{ status: 'ready', codex: ready, antigravity: { provider: 'antigravity', status: 'unsigned', plan: null, tierId: null, groups: [] }, consumeBusy: false, notice: null }}
    t={key => en[key]}
    onRetry={() => {}}
    onConsume={onConsume}
    onNoticeDone={() => {}}
  />)
  expect(screen.getByText('Plus')).toBeTruthy()
  expect(screen.getByText('2026-10-16 16:00')).toBeTruthy()
  expect(screen.getByText('60%')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.models }))
  expect(screen.getByText('gpt-5.5')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.close }))
  fireEvent.click(screen.getByRole('button', { name: en.resetQuota }))
  expect(screen.getByText(en.resetConfirmDescription)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.resetConfirm }))
  expect(onConsume).toHaveBeenCalledOnce()
})

it('maps Antigravity tiers and retries a failed Codex card', () => {
  const onRetry = vi.fn()
  render(<QuotaCards
    quota={{
      status: 'ready',
      codex: { ...ready, status: 'failed' },
      antigravity: {
        provider: 'antigravity',
        status: 'ready',
        plan: 'ultra',
        tierId: 'g1-ultra-tier',
        groups: [{
          id: 'gemini',
          label: 'Gemini',
          buckets: [
            { id: '5h', kind: 'fiveHour', group: 'standard', featureName: null, remainingPercent: 40, resetAtMs: null },
            { id: 'weekly', kind: 'weekly', group: 'standard', featureName: null, remainingPercent: null, resetAtMs: null },
          ],
        }],
      },
      consumeBusy: false,
      notice: { kind: 'ok', textKey: 'resetOk' },
    }}
    t={key => en[key]}
    onRetry={onRetry}
    onConsume={async () => {}}
    onNoticeDone={() => {}}
  />)
  expect(screen.getByText(en.planUltra)).toBeTruthy()
  expect(screen.getByText(en.quotaLoadFailed)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.quotaRetry }))
  expect(onRetry).toHaveBeenCalledOnce()
})

it('labels unknown Codex plans as the raw id and disables reset without credits', () => {
  render(<QuotaCards
    quota={{
      status: 'ready',
      codex: {
        ...ready,
        planType: 'enterprise',
        creditsUnlimited: true,
        creditBalance: null,
        resetCreditsAvailableCount: 0,
        resetCredits: [{ id: 'x', expiresAtMs: null }],
        windows: [{ id: 'w', kind: 'unknown', group: 'standard', featureName: null, remainingPercent: 10, resetAtMs: null }],
      },
      antigravity: { provider: 'antigravity', status: 'unsigned', plan: null, tierId: null, groups: [] },
      consumeBusy: false,
      notice: null,
    }}
    t={key => en[key]}
    onRetry={() => {}}
    onConsume={async () => {}}
    onNoticeDone={() => {}}
  />)
  expect(screen.getByText('enterprise')).toBeTruthy()
  expect(screen.getByText(en.creditsUnlimited)).toBeTruthy()
  expect((screen.getByRole('button', { name: en.resetQuota }) as HTMLButtonElement).disabled).toBe(true)
})

it('labels remaining plan names and closes the confirm modal without redeeming', () => {
  const onConsume = vi.fn(async () => {})
  render(<QuotaCards
    quota={{
      status: 'ready',
      codex: {
        ...ready,
        planType: 'self_serve_business_prolite',
        windows: [
          { id: 'm', kind: 'monthly', group: 'codeReview', featureName: null, remainingPercent: 0, resetAtMs: null },
          { id: 'h', kind: '5h', group: 'additional', featureName: 'fast', remainingPercent: 1, resetAtMs: null },
        ],
      },
      antigravity: {
        provider: 'antigravity',
        status: 'ready',
        plan: 'ultra-lite',
        tierId: 'g1-ultra-lite-tier',
        groups: [{ id: 'third', label: null, buckets: [] }],
      },
      consumeBusy: false,
      notice: { kind: 'error', textKey: 'resetFailed' },
    }}
    t={key => en[key]}
    onRetry={() => {}}
    onConsume={onConsume}
    onNoticeDone={() => {}}
  >
    <p>wallet</p>
  </QuotaCards>)
  expect(screen.getByText(en.planProlite)).toBeTruthy()
  expect(screen.getByText(en.planUltraLite)).toBeTruthy()
  expect(screen.getByText(`${en.windowCodeReview} · ${en.windowMonthly}`)).toBeTruthy()
  expect(screen.getByText(`fast · ${en.windowFiveHour}`)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.resetQuota }))
  fireEvent.click(screen.getByRole('button', { name: en.cancel }))
  fireEvent.click(screen.getByRole('button', { name: en.resetQuota }))
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(onConsume).not.toHaveBeenCalled()
})

it('labels a missing Codex plan as unknown', () => {
  render(<QuotaCards
    quota={{
      status: 'ready',
      codex: { ...ready, planType: 'free', windows: [{ id: 'x', kind: 'weekly', group: 'additional', featureName: '', remainingPercent: null, resetAtMs: null }] },
      antigravity: { provider: 'antigravity', status: 'ready', plan: 'pro', tierId: null, groups: [] },
      consumeBusy: false,
      notice: null,
    }}
    t={key => en[key]}
    onRetry={() => {}}
    onConsume={async () => {}}
    onNoticeDone={() => {}}
  />)
  expect(screen.getByText(en.planFree)).toBeTruthy()
  expect(screen.getByText(en.planPro)).toBeTruthy()
  expect(screen.getByText(en.balanceUnavailable)).toBeTruthy()
})

it('labels free and team plans', () => {
  render(<QuotaCards
    quota={{
      status: 'ready',
      codex: { ...ready, planType: 'team', windows: [] },
      antigravity: { provider: 'antigravity', status: 'ready', plan: 'free', tierId: 'free-tier', groups: [] },
      consumeBusy: false,
      notice: null,
    }}
    t={key => en[key]}
    onRetry={() => {}}
    onConsume={async () => {}}
    onNoticeDone={() => {}}
  />)
  expect(screen.getByText(en.planTeam)).toBeTruthy()
  expect(screen.getByText(en.planFree)).toBeTruthy()
})

it('retries null and failed cards and an unknown plan', () => {
  const onRetry = vi.fn()
  render(<QuotaCards
    quota={{
      status: 'ready',
      codex: null,
      antigravity: null,
      consumeBusy: false,
      notice: null,
    }}
    t={key => en[key]}
    onRetry={onRetry}
    onConsume={async () => {}}
    onNoticeDone={() => {}}
  />)
  fireEvent.click(screen.getAllByRole('button', { name: en.quotaRetry })[0]!)
  expect(onRetry).toHaveBeenCalled()
})

it('labels a Codex card with no plan type', () => {
  render(<QuotaCards
    quota={{
      status: 'ready',
      codex: { ...ready, planType: null, creditsUnlimited: false, creditBalance: null },
      antigravity: { provider: 'antigravity', status: 'unsigned', plan: null, tierId: null, groups: [] },
      consumeBusy: false,
      notice: null,
    }}
    t={key => en[key]}
    onRetry={() => {}}
    onConsume={async () => {}}
    onNoticeDone={() => {}}
  />)
  expect(screen.getByText(en.planUnknown)).toBeTruthy()
})

it('retries a failed Antigravity card', () => {
  const onRetry = vi.fn()
  render(<QuotaCards
    quota={{
      status: 'ready',
      codex: { ...ready, planType: 'pro' },
      antigravity: { provider: 'antigravity', status: 'failed', plan: null, tierId: null, groups: [] },
      consumeBusy: false,
      notice: null,
    }}
    t={key => en[key]}
    onRetry={onRetry}
    onConsume={async () => {}}
    onNoticeDone={() => {}}
  />)
  expect(screen.getByText(en.planPro)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.quotaRetry }))
  expect(onRetry).toHaveBeenCalledOnce()
})

it('shows unsigned Codex and Antigravity cards', () => {
  render(<QuotaCards
    quota={{
      status: 'ready',
      codex: {
        provider: 'codex', status: 'unsigned', planType: null, subscriptionActiveUntilMs: null,
        creditBalance: null, creditsUnlimited: false, windows: [], resetCredits: [], resetCreditsAvailableCount: null, models: [],
      },
      antigravity: { provider: 'antigravity', status: 'unsigned', plan: null, tierId: null, groups: [] },
      consumeBusy: false,
      notice: null,
    }}
    t={key => en[key]}
    onRetry={() => {}}
    onConsume={async () => {}}
    onNoticeDone={() => {}}
  />)
  expect(screen.getAllByText(en.goModelsSignIn)).toHaveLength(2)
})

it('shows loading copy and the unknown Antigravity fallback', () => {
  render(<QuotaCards
    quota={{ status: 'loading', codex: null, antigravity: null, consumeBusy: false, notice: null }}
    t={key => en[key]}
    onRetry={() => {}}
    onConsume={async () => {}}
    onNoticeDone={() => {}}
  />)
  expect(screen.getAllByText(en.loading).length).toBeGreaterThan(0)
})

it('shows a custom Antigravity tier id when the plan is unmapped', () => {
  render(<QuotaCards
    quota={{
      status: 'ready',
      codex: { ...ready, planType: 'pro' },
      antigravity: { provider: 'antigravity', status: 'ready', plan: null, tierId: 'custom-tier', groups: [] },
      consumeBusy: false,
      notice: null,
    }}
    t={key => en[key]}
    onRetry={() => {}}
    onConsume={async () => {}}
    onNoticeDone={() => {}}
  />)
  expect(screen.getByText('custom-tier')).toBeTruthy()
})

it('shows empty Codex models copy', () => {
  render(<QuotaCards
    quota={{
      status: 'ready',
      codex: { ...ready, models: [] },
      antigravity: { provider: 'antigravity', status: 'unsigned', plan: null, tierId: null, groups: [] },
      consumeBusy: false,
      notice: null,
    }}
    t={key => en[key]}
    onRetry={() => {}}
    onConsume={async () => {}}
    onNoticeDone={() => {}}
  />)
  fireEvent.click(screen.getByRole('button', { name: en.models }))
  expect(screen.getByText(en.modelsEmpty)).toBeTruthy()
})

it('shows unknown when Antigravity has no plan and no tier', () => {
  render(<QuotaCards
    quota={{
      status: 'ready',
      codex: { ...ready, planType: 'pro' },
      antigravity: { provider: 'antigravity', status: 'ready', plan: null, tierId: null, groups: [] },
      consumeBusy: false,
      notice: null,
    }}
    t={key => en[key]}
    onRetry={() => {}}
    onConsume={async () => {}}
    onNoticeDone={() => {}}
  />)
  expect(screen.getByText(en.planUnknown)).toBeTruthy()
})

it('opens Antigravity models and distinguishes a failed catalog from an empty catalog', () => {
  render(<QuotaCards
    quota={{ status: 'ready', codex: { ...ready, modelsError: 'models-unavailable' },
      antigravity: { provider: 'antigravity', status: 'ready', plan: 'pro', tierId: null,
        groups: [], models: [{ id: 'gemini-pro', name: 'Gemini Pro' }] },
      consumeBusy: false, notice: null }}
    t={key => en[key]} onRetry={() => {}} onConsume={async () => {}} onNoticeDone={() => {}}
  />)
  const buttons = screen.getAllByRole('button', { name: en.models })
  fireEvent.click(buttons[1]!)
  expect(screen.getByText('Gemini Pro')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.close }))
  fireEvent.click(buttons[0]!)
  expect(screen.getByText(en.modelsUnavailable)).toBeTruthy()
  expect(screen.queryByText(en.modelsEmpty)).toBeNull()
})
