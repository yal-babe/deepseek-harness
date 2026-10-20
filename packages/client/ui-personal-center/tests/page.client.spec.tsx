// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { PersonalCenterPage } from '../src/client/PersonalCenterPage.tsx'
import { en } from '../src/client/locales.ts'
import type { PersonalCenterState, PersonalCenterStore } from '../src/client/store.ts'
import type { UsageSnapshot } from '@deepseek-ai/dsh-usage-stats/types'

afterEach(cleanup)

const usage: UsageSnapshot = {
  timezoneOffsetSeconds: 0,
  generatedAt: 1,
  totals: { uncachedInputTokens: 10, cacheReadTokens: 2, cacheWriteTokens: 1, outputTokens: 4 },
  sessionCount: 1,
  toolCalls: 3,
  days: [{ day: '2026-10-15', tokens: { uncachedInputTokens: 10, cacheReadTokens: 2, cacheWriteTokens: 1, outputTokens: 4 }, sessionCount: 1, toolCalls: 3 }],
  models: [{ provider: 'deepseek', model: 'deepseek-v4-flash', tokens: { uncachedInputTokens: 10, cacheReadTokens: 2, cacheWriteTokens: 1, outputTokens: 4 } }],
  tools: [{ name: 'bash', count: 3 }],
  sessions: [
    { sessionId: 'empty', title: 'Empty', tokens: { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }, updatedAt: 1 },
    { sessionId: 's1', title: 'Demo', tokens: { uncachedInputTokens: 10, cacheReadTokens: 2, cacheWriteTokens: 1, outputTokens: 4 }, updatedAt: Date.parse('2026-10-15T01:00:00.000Z') },
  ],
}

it('renders KPIs, heatmap modes, and opens a recent session', () => {
  const openSession = vi.fn()
  const controller = {
    load: vi.fn(async () => {}),
    observeUsage: vi.fn(() => () => {}),
    setHeatmap: vi.fn(),
    store: createSnapshotStore<PersonalCenterState>({
      status: 'ready',
      usage,
      quota: { codex: null, antigravity: null },
      deepseek: { status: 'unsigned', name: null, balance: null },
      heatmap: 'daily',
      cached: false,
    }),
  } as unknown as PersonalCenterStore
  const view = () => <PersonalCenterPage
    t={key => (en as Record<string, string>)[key] ?? key}
    controller={controller}
    useSnapshot={selector => selector(controller.store.getSnapshot())}
    openSession={openSession}
  />
  const { rerender } = render(view())
  expect(screen.getByText(en.title)).toBeTruthy()
  expect(screen.getByText('bash')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.weekly }))
  expect(controller.setHeatmap).toHaveBeenCalledWith('weekly')
  fireEvent.click(screen.getByRole('button', { name: 'Demo' }))
  expect(openSession).toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Empty' })).toBeNull()
  controller.store.set({
    ...controller.store.getSnapshot(),
    usage: { ...usage, totals: { ...usage.totals, totalTokens: 500, cacheReadUnknown: true, cacheWriteUnknown: true } },
  })
  rerender(view())
  expect(screen.getByText(en.allTime, { selector: 'span' }).parentElement?.textContent).toContain('500')
  expect(screen.getByText(en.cacheRead).parentElement?.textContent).toContain('2')
  expect(screen.getByText(en.cacheWrite).parentElement?.textContent).toContain('1')
  const unknown = { ...emptyDay(0), incomplete: true }
  controller.store.set({
    ...controller.store.getSnapshot(),
    usage: { ...usage, totals: unknown, sessions: [{ ...usage.sessions[1]!, tokens: unknown }] },
  })
  rerender(view())
  expect(screen.getByText(en.partialUsage)).toBeTruthy()
  expect(screen.getByText(en.allTime, { selector: 'span' }).parentElement?.textContent).toContain('0')
  expect(screen.getByText(en.today).parentElement?.textContent).toContain('0')
  expect(screen.getByRole('button', { name: 'Demo' }).textContent).toContain('0')
})

it('renders weekly and cumulative heatmaps and retries a cached failure', () => {
  const controller = {
    load: vi.fn(async () => {}),
    observeUsage: vi.fn(() => () => {}),
    setHeatmap: vi.fn(),
    store: createSnapshotStore<PersonalCenterState>({
      status: 'error',
      usage: {
        ...usage,
        days: [
          { day: '2026-10-01', tokens: emptyDay(0), sessionCount: 0, toolCalls: 0 },
          { day: '2026-10-08', tokens: emptyDay(10), sessionCount: 1, toolCalls: 0 },
          { day: '2026-10-15', tokens: emptyDay(30), sessionCount: 1, toolCalls: 0 },
          { day: '2026-10-22', tokens: emptyDay(60), sessionCount: 1, toolCalls: 0 },
          { day: '2026-10-29', tokens: emptyDay(100), sessionCount: 1, toolCalls: 0 },
        ],
      },
      quota: {
        codex: {
          provider: 'codex', status: 'failed', planType: null, subscriptionActiveUntilMs: null,
          creditBalance: null, creditsUnlimited: false, windows: [], resetCredits: [], resetCreditsAvailableCount: null, models: [],
        },
        antigravity: { provider: 'antigravity', status: 'unsigned', plan: null, tierId: null, groups: [] },
      },
      deepseek: { status: 'ready', name: 'Ada', balance: '¥1.00' },
      heatmap: 'weekly',
      cached: true,
    }),
  } as unknown as PersonalCenterStore
  const { rerender } = render(<PersonalCenterPage
    t={key => (en as Record<string, string>)[key] ?? key}
    controller={controller}
    useSnapshot={selector => selector(controller.store.getSnapshot())}
    openSession={() => {}}
  />)
  expect(screen.getByText(en.loadFailed)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.retry }))
  expect(controller.load).toHaveBeenCalled()
  controller.store.set({ ...controller.store.getSnapshot(), heatmap: 'cumulative', status: 'ready', cached: false })
  rerender(<PersonalCenterPage
    t={key => (en as Record<string, string>)[key] ?? key}
    controller={controller}
    useSnapshot={selector => selector(controller.store.getSnapshot())}
    openSession={() => {}}
  />)
  expect(screen.getByText(en.quotaFailed)).toBeTruthy()
})

it('shows a skeleton while the first snapshot is loading', () => {
  const controller = {
    load: vi.fn(async () => {}),
    observeUsage: vi.fn(() => () => {}),
    setHeatmap: vi.fn(),
    store: createSnapshotStore<PersonalCenterState>({
      status: 'loading',
      usage: null,
      quota: { codex: null, antigravity: null },
      deepseek: { status: 'unsigned', name: null, balance: null },
      heatmap: 'daily',
      cached: false,
    }),
  } as unknown as PersonalCenterStore
  render(<PersonalCenterPage
    t={key => (en as Record<string, string>)[key] ?? key}
    controller={controller}
    useSnapshot={selector => selector(controller.store.getSnapshot())}
    openSession={() => {}}
  />)
  expect(document.querySelector('[aria-busy="true"]')).toBeTruthy()
})

it('formats large token totals and empty heatmaps', () => {
  const large = {
    ...usage,
    totals: { uncachedInputTokens: 2_000_000, cacheReadTokens: 1_500, cacheWriteTokens: 0, outputTokens: 0 },
    days: [],
    models: [{ provider: 'deepseek', model: '', tokens: usage.totals }],
    tools: [],
    sessions: [],
  }
  const controller = {
    load: vi.fn(async () => {}),
    observeUsage: vi.fn(() => () => {}),
    setHeatmap: vi.fn(),
    store: createSnapshotStore<PersonalCenterState>({
      status: 'ready',
      usage: large,
      quota: {
        codex: {
          provider: 'codex', status: 'ready', planType: 'plus', subscriptionActiveUntilMs: null,
          creditBalance: null, creditsUnlimited: false, windows: [], resetCredits: [], resetCreditsAvailableCount: null, models: [],
        },
        antigravity: { provider: 'antigravity', status: 'unsigned', plan: null, tierId: null, groups: [] },
      },
      deepseek: { status: 'failed', name: null, balance: null },
      heatmap: 'daily',
      cached: false,
    }),
  } as unknown as PersonalCenterStore
  render(<PersonalCenterPage
    t={key => (en as Record<string, string>)[key] ?? key}
    controller={controller}
    useSnapshot={selector => selector(controller.store.getSnapshot())}
    openSession={() => {}}
  />)
  expect(screen.getAllByText('2.0M').length).toBeGreaterThan(0)
  expect(screen.getByText('1.5K')).toBeTruthy()
  expect(screen.getAllByText(en.empty).length).toBeGreaterThan(0)
  expect(screen.getByText(en.noModel)).toBeTruthy()
  expect(screen.getByText(en.quotaFailed)).toBeTruthy()
})

it('renders ready KPIs when usage is still null', () => {
  const controller = {
    load: vi.fn(async () => {}),
    observeUsage: vi.fn(() => () => {}),
    setHeatmap: vi.fn(),
    store: createSnapshotStore<PersonalCenterState>({
      status: 'ready',
      usage: null,
      quota: { codex: null, antigravity: null },
      deepseek: { status: 'ready', name: null, balance: null },
      heatmap: 'daily',
      cached: false,
    }),
  } as unknown as PersonalCenterStore
  render(<PersonalCenterPage
    t={key => (en as Record<string, string>)[key] ?? key}
    controller={controller}
    useSnapshot={selector => selector(controller.store.getSnapshot())}
    openSession={() => {}}
  />)
  expect(screen.getAllByText('0').length).toBeGreaterThan(0)
})

it('shows the empty error when no cache exists', () => {
  const controller = {
    load: vi.fn(async () => {}),
    observeUsage: vi.fn(() => () => {}),
    setHeatmap: vi.fn(),
    store: createSnapshotStore<PersonalCenterState>({
      status: 'error',
      usage: null,
      quota: { codex: null, antigravity: null },
      deepseek: { status: 'unsigned', name: null, balance: null },
      heatmap: 'daily',
      cached: false,
    }),
  } as unknown as PersonalCenterStore
  render(<PersonalCenterPage
    t={key => (en as Record<string, string>)[key] ?? key}
    controller={controller}
    useSnapshot={selector => selector(controller.store.getSnapshot())}
    openSession={() => {}}
  />)
  expect(screen.getByText(en.loadFailed)).toBeTruthy()
})

it('paints heatmap intensity from zero through the highest bucket', () => {
  const controller = {
    load: vi.fn(async () => {}),
    observeUsage: vi.fn(() => () => {}),
    setHeatmap: vi.fn(),
    store: createSnapshotStore<PersonalCenterState>({
      status: 'ready',
      usage: {
        ...usage,
        days: [
          { day: '2026-10-01', tokens: emptyDay(0), sessionCount: 0, toolCalls: 0 },
          { day: '2026-10-02', tokens: emptyDay(10), sessionCount: 1, toolCalls: 0 },
          { day: '2026-10-03', tokens: emptyDay(30), sessionCount: 1, toolCalls: 0 },
          { day: '2026-10-04', tokens: emptyDay(60), sessionCount: 1, toolCalls: 0 },
          { day: '2026-10-05', tokens: emptyDay(100), sessionCount: 1, toolCalls: 0 },
        ],
      },
      quota: {
        codex: {
          provider: 'codex', status: 'ready', planType: 'plus', subscriptionActiveUntilMs: null,
          creditBalance: null, creditsUnlimited: false, windows: [
            { id: 'primary', kind: 'fiveHour', group: 'standard', featureName: null, remainingPercent: 40, resetAtMs: Date.parse('2026-10-17T00:00:00Z') },
            { id: 'review', kind: 'weekly', group: 'codeReview', featureName: null, remainingPercent: 90, resetAtMs: null },
            { id: 'extra', kind: 'unknown', group: 'additional', featureName: 'fast', remainingPercent: null, resetAtMs: null },
            { id: 'month', kind: 'monthly', group: 'standard', featureName: null, remainingPercent: 10, resetAtMs: null },
            { id: 'bare', kind: '5h', group: 'additional', featureName: null, remainingPercent: 5, resetAtMs: null },
          ], resetCredits: [], resetCreditsAvailableCount: null, models: [],
        },
        antigravity: {
          provider: 'antigravity', status: 'ready', plan: 'pro', tierId: 'g1-pro-tier',
          groups: [{
            id: 'gemini', label: 'Gemini', buckets: [
              { id: '5h', kind: 'fiveHour', group: 'standard', featureName: null, remainingPercent: 25, resetAtMs: Date.parse('2026-10-18T00:00:00Z') },
            ],
          }],
        },
      },
      deepseek: { status: 'ready', name: 'Ada', balance: null,
        wallets: [{ currency: 'CNY', balance: '38.22' }],
        bonusWallets: [{ currency: 'CNY', balance: '5.00', expiresAt: '2026-11-01T00:00:00Z' }],
      },
      heatmap: 'daily',
      cached: false,
    }),
  } as unknown as PersonalCenterStore
  const { container } = render(<PersonalCenterPage
    t={key => (en as Record<string, string>)[key] ?? key}
    controller={controller}
    useSnapshot={selector => selector(controller.store.getSnapshot())}
    openSession={() => {}}
  />)
  expect(container.querySelectorAll('[data-level][aria-label]').length).toBe(53 * 7)
  expect(screen.getByText('Gemini')).toBeTruthy()
  expect(screen.getByText('¥38.22')).toBeTruthy()
  expect(screen.getByText('¥5.00')).toBeTruthy()
  expect(screen.getByText(`${en.bonusExpires} 2026-11-01 08:00`)).toBeTruthy()
  expect(screen.getByText(`${en.resetsAt} 2026-10-17 08:00`)).toBeTruthy()
  expect(screen.getByText(`${en.resetsAt} 2026-10-18 08:00`)).toBeTruthy()
  expect(screen.getByText(`40% ${en.remaining}`)).toBeTruthy()
  expect(screen.getByText(en.windowMonthly)).toBeTruthy()
  expect(screen.getByText(`${en.windowCodeReview} · ${en.windowWeekly}`)).toBeTruthy()
  expect(screen.getByText(`fast · ${en.windowUnknown}`)).toBeTruthy()
})

function emptyDay(total: number) {
  return { uncachedInputTokens: total, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }
}
