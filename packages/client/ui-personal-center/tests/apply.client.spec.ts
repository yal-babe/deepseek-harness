// @vitest-environment jsdom
/** What the browser half registers. */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import type { ILayout, PanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { createElement } from 'react'
import { cleanup, render } from '@testing-library/react'
import { apply, inject, PANEL_ID } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { PersonalCenterIcon } from '../src/client/PersonalCenterIcon.tsx'
import { PersonalCenterStore } from '../src/client/store.ts'
import type { PersonalCenterInjected } from '../src/client/PersonalCenterPage.tsx'
import type { UsageSnapshot } from '@deepseek-ai/dsh-usage-stats/types'

afterEach(() => { localStorage.clear(); vi.unstubAllEnvs(); cleanup() })

const emptyUsage = (): UsageSnapshot => ({
  timezoneOffsetSeconds: 0,
  generatedAt: 1,
  totals: { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
  sessionCount: 0,
  toolCalls: 0,
  days: [],
  models: [],
  tools: [],
  sessions: [],
})

async function bench(options?: {
  sessionIds?: ReturnType<typeof SessionId>[]
  binding?: () => unknown
}) {
  vi.stubEnv('DSH_CLIENT_VERSION', '0.0.0-test')
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const usageStats: { snapshot: ReturnType<typeof vi.fn> } = {
    snapshot: vi.fn(async () => ({ ok: true as const, value: emptyUsage() })),
  }
  const account: { getProfile: ReturnType<typeof vi.fn>; getBalance: ReturnType<typeof vi.fn> } = {
    getProfile: vi.fn(async () => ({ ok: true as const, value: null })),
    getBalance: vi.fn(async () => ({ ok: true as const, value: null })),
  }
  const providerQuota: { get: ReturnType<typeof vi.fn>; consumeCodexReset: ReturnType<typeof vi.fn> } = {
    get: vi.fn(async (provider: 'codex' | 'antigravity') => ({
      ok: true as const,
      value: provider === 'codex'
        ? {
          provider: 'codex' as const, status: 'unsigned' as const, planType: null, subscriptionActiveUntilMs: null,
          creditBalance: null, creditsUnlimited: false, windows: [], resetCredits: [], resetCreditsAvailableCount: null, models: [],
        }
        : { provider: 'antigravity' as const, status: 'unsigned' as const, plan: null, tierId: null, groups: [] },
    })),
    consumeCodexReset: vi.fn(),
  }
  new TestRemote(ctx, {
    usageStats,
    providerQuota,
    account,
  } as never)
  const panelInfo = createSnapshotStore<PanelInfo>({ activePanelId: null })
  ctx.provide('layout', {
    panelInfo,
    selectPanel: vi.fn<ILayout['selectPanel']>(),
    beginNavigation: () => new AbortController().signal,
    toggleSidebar: vi.fn(),
    openRightbar: vi.fn(),
    closeRightbar: vi.fn(),
  })
  const list = createSnapshotStore<{ ids: ReturnType<typeof SessionId>[] }>({ ids: options?.sessionIds ?? [] })
  ctx.provide('sessions', { list, binding: options?.binding ?? (() => undefined) })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, usageStats, account, list, providerQuota }
}

function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      main: { kind: 'keyed', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

describe('ui-personal-center apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('registers Personal Center under Plugins', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const icon = slots.entries('sidebar.panellist')[0]!
    expect(icon.options).toMatchObject({ id: PANEL_ID, order: 5 })
    expect(resolveSlotLabel(icon.options.label)).toBe('个人中心')
    expect(slots.entries('main')[0]?.options.key).toBe(PANEL_ID)
    render(createElement(PersonalCenterIcon, { size: 16, active: false } as never))
    const injected = slots.entries('main')[0]!.inject!() as unknown as PersonalCenterInjected
    injected.openSession(SessionId('missing'))
  })

  it('skips live session ids that have no binding', async () => {
    const { ctx, slots } = await bench({
      sessionIds: [SessionId('ghost')],
      binding: () => undefined,
    })
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
  })

  it('ignores live sessions whose tokenUsage snapshot is undefined', async () => {
    const live = SessionId('live')
    const { ctx, slots } = await bench({
      sessionIds: [live],
      binding: () => ({
        session: {
          projections: {
            faceOf: () => ({
              subscribe: (listener: () => void) => { listener(); return () => {} },
              getSnapshot: () => undefined,
            }),
          },
        },
      }),
    })
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
  })

  it('ignores live sessions that have no tokenUsage snapshot', async () => {
    const live = SessionId('live')
    const { ctx, slots } = await bench({
      sessionIds: [live],
      binding: () => ({
        session: {
          projections: {
            faceOf: () => ({
              subscribe: (listener: () => void) => { listener(); return () => {} },
              getSnapshot: () => null,
            }),
          },
        },
      }),
    })
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
  })

  it('refreshes Host usage after settlements, opens a session, and reconnects', async () => {
    const tokens = createSnapshotStore({
      uncachedInputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 2,
    })
    const live = SessionId('live')
    const { ctx, slots, usageStats, list } = await bench({
      sessionIds: [live],
      binding: () => ({ session: { projections: { faceOf: () => tokens } } }),
    })
    const openSession = vi.fn()
    ctx.provide('uiWorkspace', { openSession })
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    expect(usageStats.snapshot).not.toHaveBeenCalled()
    ctx.emit('connection/reset')
    expect(usageStats.snapshot).not.toHaveBeenCalled()
    const injected = slots.entries('main')[0]!.inject!() as unknown as PersonalCenterInjected
    await injected.controller.load()
    expect(usageStats.snapshot).toHaveBeenCalledOnce()
    const stopObserving = injected.controller.observeUsage()
    const refreshed = emptyUsage()
    refreshed.totals.uncachedInputTokens = 3
    usageStats.snapshot.mockResolvedValue({ ok: true, value: refreshed })
    tokens.set({ uncachedInputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 2 })
    await vi.waitFor(() => { expect(injected.controller.store.getSnapshot().usage?.totals.uncachedInputTokens).toBe(3) })
    injected.openSession(live)
    expect(ctx.get('layout')?.selectPanel).toHaveBeenCalledWith(null)
    expect(openSession).toHaveBeenCalledWith(live)
    ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(usageStats.snapshot.mock.calls.length).toBeGreaterThan(1) })
    list.set({ ids: [] })
    stopObserving()
  })
})

describe('PersonalCenterStore', () => {
  it('replaces usage from the Host and coalesces simultaneous refresh notifications', async () => {
    const { ctx, usageStats, providerQuota } = await bench()
    const store = new PersonalCenterStore(ctx)
    await store.load()
    const next = emptyUsage()
    next.totals = { uncachedInputTokens: 4, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 10 }
    next.days = [{ day: '2026-10-18', tokens: next.totals, sessionCount: 1, toolCalls: 0 }]
    usageStats.snapshot.mockResolvedValue({ ok: true, value: next })
    await Promise.all([store.refreshUsage(), store.refreshUsage()])
    expect(usageStats.snapshot).toHaveBeenCalledTimes(2)
    expect(providerQuota.get).toHaveBeenCalledTimes(2)
    expect(store.store.getSnapshot().usage).toEqual(next)
    store.dispose()
    await store.refreshUsage()
    expect(usageStats.snapshot).toHaveBeenCalledTimes(2)
  })

  it('does not scan Host history for hidden summaries and releases visible observers independently', async () => {
    const { ctx, usageStats } = await bench()
    const store = new PersonalCenterStore(ctx)
    await store.load()
    await Promise.all(Array.from({ length: 100 }, () => store.refreshUsage(true)))
    expect(usageStats.snapshot).toHaveBeenCalledOnce()
    const first = store.observeUsage()
    const second = store.observeUsage()
    await store.refreshUsage(true)
    expect(usageStats.snapshot).toHaveBeenCalledTimes(2)
    first()
    first()
    await store.refreshUsage(true)
    expect(usageStats.snapshot).toHaveBeenCalledTimes(3)
    second()
    await store.refreshUsage(true)
    expect(usageStats.snapshot).toHaveBeenCalledTimes(3)
    await store.load()
    expect(usageStats.snapshot).toHaveBeenCalledTimes(4)
    store.dispose()
  })

  it('keeps account refresh results when a usage notification arrives during panel loading', async () => {
    const { ctx, usageStats, account, providerQuota } = await bench()
    const profile = Promise.withResolvers<undefined>()
    account.getProfile.mockImplementationOnce(async () => {
      await profile.promise
      return { ok: true, value: { status: 'ready', value: { id: 'u1', name: 'Ada', contact: null } } }
    })
    const store = new PersonalCenterStore(ctx)
    const loading = store.load()
    await vi.waitFor(() => { expect(usageStats.snapshot).toHaveBeenCalledOnce() })
    const refreshing = store.refreshUsage()
    profile.resolve(undefined)
    await Promise.all([loading, refreshing])
    expect(store.store.getSnapshot().deepseek.name).toBe('Ada')
    expect(store.store.getSnapshot().status).toBe('ready')
    expect(providerQuota.get).toHaveBeenCalledTimes(2)
    store.dispose()
  })

  it('discards an obsolete in-flight usage snapshot', async () => {
    const { ctx, usageStats } = await bench()
    const store = new PersonalCenterStore(ctx)
    await store.load()
    const first = Promise.withResolvers<{ ok: true; value: UsageSnapshot }>()
    usageStats.snapshot.mockReturnValueOnce(first.promise)
    const pending = store.refreshUsage()
    await vi.waitFor(() => { expect(usageStats.snapshot).toHaveBeenCalledTimes(2) })
    const next = emptyUsage()
    next.totals.outputTokens = 9
    usageStats.snapshot.mockResolvedValueOnce({ ok: true, value: next })
    const repeated = store.refreshUsage()
    first.resolve({ ok: true, value: emptyUsage() })
    await Promise.all([pending, repeated])
    expect(store.store.getSnapshot().usage).toEqual(next)
    expect(usageStats.snapshot).toHaveBeenCalledTimes(3)
    store.dispose()
  })

  it('retains failed refreshes and ignores responses after disposal', async () => {
    const { ctx, usageStats } = await bench()
    const store = new PersonalCenterStore(ctx)
    await store.load()
    usageStats.snapshot.mockRejectedValueOnce(new Error('offline'))
    await store.refreshUsage()
    expect(store.store.getSnapshot().cached).toBe(true)
    usageStats.snapshot.mockResolvedValueOnce({ ok: false, error: { code: 'OFFLINE', message: 'offline' } })
    await store.refreshUsage()
    expect(store.store.getSnapshot().cached).toBe(true)
    const response = Promise.withResolvers<{ ok: true; value: UsageSnapshot }>()
    usageStats.snapshot.mockReturnValueOnce(response.promise)
    const pending = store.refreshUsage()
    await vi.waitFor(() => { expect(usageStats.snapshot).toHaveBeenCalledTimes(4) })
    store.dispose()
    const next = emptyUsage()
    next.totals.outputTokens = 50
    response.resolve({ ok: true, value: next })
    await pending
    expect(store.store.getSnapshot().usage?.totals.outputTokens).toBe(0)
  })

  it('paints cache then keeps it when Host usage fails', async () => {
    const usage = emptyUsage()
    usage.totals.outputTokens = 9
    localStorage.setItem(`dsh.usage-stats.v2:${location.host}`, JSON.stringify(usage))
    const { ctx, usageStats } = await bench()
    usageStats.snapshot.mockRejectedValueOnce(new Error('down'))
    const store = new PersonalCenterStore(ctx)
    expect(store.store.getSnapshot().cached).toBe(true)
    await store.load()
    expect(store.store.getSnapshot().status).toBe('ready')
    expect(store.store.getSnapshot().usage?.totals.outputTokens).toBe(9)
    store.setHeatmap('weekly')
    expect(store.store.getSnapshot().heatmap).toBe('weekly')
    store.dispose()
  })

  it('records a DeepSeek wallet when the account Remote is ready', async () => {
    const { ctx, account } = await bench()
    account.getProfile.mockResolvedValue({
      ok: true,
      value: { status: 'ready', value: { id: 'u1', name: 'Ada', contact: null } },
    })
    account.getBalance.mockResolvedValue({
      ok: true,
      value: { status: 'ready', value: [{ currency: 'CNY', balance: '12.00' }], bonusWallets: [] },
    })
    const store = new PersonalCenterStore(ctx)
    await store.load()
    expect(store.store.getSnapshot().deepseek).toMatchObject({ status: 'ready', name: 'Ada' })
    expect(store.store.getSnapshot().deepseek.balance).toContain('12')
    store.dispose()
  })

  it('covers cache, unsigned account, and discarded in-flight loads', async () => {
    localStorage.setItem(`dsh.usage-stats.v2:${location.host}`, '{')
    const { ctx, usageStats, account } = await bench()
    expect(new PersonalCenterStore(ctx).store.getSnapshot().usage).toBeNull()
    localStorage.setItem(`dsh.usage-stats.v2:${location.host}`, JSON.stringify({ totals: {} }))
    expect(new PersonalCenterStore(ctx).store.getSnapshot().usage).toBeNull()
    localStorage.setItem(`dsh.usage-stats.v2:${location.host}`, JSON.stringify({
      totals: {}, sessions: [], days: [], timezoneOffsetSeconds: 'x',
    }))
    expect(new PersonalCenterStore(ctx).store.getSnapshot().usage).toBeNull()
    localStorage.setItem(`dsh.usage-stats.v2:${location.host}`, JSON.stringify(emptyUsage()))
    usageStats.snapshot.mockResolvedValueOnce({ ok: false, error: { code: 'x', message: 'no' } })
    const failed = new PersonalCenterStore(ctx)
    await failed.load()
    expect(failed.store.getSnapshot().status).toBe('ready')
    expect(failed.store.getSnapshot().cached).toBe(true)
    localStorage.removeItem(`dsh.usage-stats.v2:${location.host}`)
    usageStats.snapshot.mockResolvedValueOnce({ ok: false, error: { code: 'x', message: 'no' } })
    const emptyFail = new PersonalCenterStore(ctx)
    await emptyFail.load()
    expect(emptyFail.store.getSnapshot().status).toBe('error')
    usageStats.snapshot.mockRejectedValueOnce(new Error('down'))
    const thrown = new PersonalCenterStore(ctx)
    await thrown.load()
    expect(thrown.store.getSnapshot().status).toBe('error')
    await failed.refreshUsage()
    account.getProfile.mockRejectedValueOnce(new Error('down'))
    const down = new PersonalCenterStore(ctx)
    await down.load()
    expect(down.store.getSnapshot().deepseek.status).toBe('failed')
    account.getBalance.mockResolvedValue({
      ok: true,
      value: { status: 'ready', value: [{ currency: 'USD', balance: '1.00' }], bonusWallets: [] },
    })
    account.getProfile.mockResolvedValue({
      ok: true,
      value: { status: 'ready', value: { id: 'u1', name: 'Ada', contact: null } },
    })
    const usd = new PersonalCenterStore(ctx)
    await usd.load()
    expect(usd.store.getSnapshot().deepseek.balance).toContain('$')
    account.getBalance.mockResolvedValue({ ok: false, error: { code: 'x', message: 'no' } })
    const unsignedBalance = new PersonalCenterStore(ctx)
    account.getProfile.mockResolvedValue({
      ok: true,
      value: { status: 'ready', value: { id: 'u1', name: 'Ada', contact: null } },
    })
    await unsignedBalance.load()
    expect(unsignedBalance.store.getSnapshot().deepseek.balance).toBeNull()
    account.getBalance.mockResolvedValue({ ok: true, value: { status: 'ready', value: [], bonusWallets: [] } })
    const emptyWallets = new PersonalCenterStore(ctx)
    await emptyWallets.load()
    expect(emptyWallets.store.getSnapshot().deepseek.balance).toBeNull()
    usageStats.snapshot.mockImplementationOnce(async () => {
      throw new Error('down')
    })
    usageStats.snapshot.mockImplementationOnce(async () => ({ ok: true as const, value: emptyUsage() }))
    const discardedOk = new PersonalCenterStore(ctx)
    const pendingOk = discardedOk.load()
    discardedOk.dispose()
    await pendingOk
    const discarded = new PersonalCenterStore(ctx)
    const pending = discarded.load()
    discarded.dispose()
    await pending
    expect(discarded.store.getSnapshot().status).not.toBe('ready')
    localStorage.clear()
    await new PersonalCenterStore(ctx).refreshUsage()
    localStorage.setItem(`dsh.usage-stats.v2:${location.host}`, 'null')
    expect(new PersonalCenterStore(ctx).store.getSnapshot().usage).toBeNull()
    const originalLocation = globalThis.location
    vi.stubGlobal('location', undefined)
    expect(new PersonalCenterStore(ctx).store.getSnapshot()).toBeDefined()
    vi.stubGlobal('location', originalLocation)
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    await usd.load()
    setItem.mockRestore()
  })

  it('marks quota cards failed when the Remote rejects or mismatches', async () => {
    const { ctx, providerQuota, account } = await bench()
    providerQuota.get.mockImplementation(async (provider: 'codex' | 'antigravity') => {
      if (provider === 'codex') return { ok: false as const, error: { code: 'x', message: 'no' } }
      return { ok: true as const, value: { provider: 'codex', status: 'unsigned' as const, planType: null, subscriptionActiveUntilMs: null, creditBalance: null, creditsUnlimited: false, windows: [], resetCredits: [], resetCreditsAvailableCount: null, models: [] } }
    })
    const mismatch = new PersonalCenterStore(ctx)
    await mismatch.load()
    expect(mismatch.store.getSnapshot().quota.codex?.status).toBe('failed')
    expect(mismatch.store.getSnapshot().quota.antigravity?.status).toBe('failed')
    providerQuota.get.mockRejectedValue(new Error('offline'))
    const thrown = new PersonalCenterStore(ctx)
    await thrown.load()
    expect(thrown.store.getSnapshot().quota.codex?.status).toBe('failed')
    account.getBalance.mockResolvedValue({
      ok: true,
      value: { status: 'ready', value: [{ currency: 'CNY', balance: '0' }], bonusWallets: [] },
    })
    account.getProfile.mockResolvedValue({
      ok: true,
      value: { status: 'ready', value: { id: 'u1', name: 'Ada', contact: null } },
    })
    providerQuota.get.mockImplementation(async (provider: 'codex' | 'antigravity') => ({
      ok: true as const,
      value: provider === 'codex'
        ? {
          provider: 'codex' as const, status: 'unsigned' as const, planType: null, subscriptionActiveUntilMs: null,
          creditBalance: null, creditsUnlimited: false, windows: [], resetCredits: [], resetCreditsAvailableCount: null, models: [],
        }
        : { provider: 'antigravity' as const, status: 'unsigned' as const, plan: null, tierId: null, groups: [] },
    }))
    const zero = new PersonalCenterStore(ctx)
    await zero.load()
    expect(zero.store.getSnapshot().deepseek.balance).toBe('¥0.00')
    account.getBalance.mockResolvedValue({
      ok: true,
      value: { status: 'ready', value: [{ currency: 'CNY', balance: 'nope' }], bonusWallets: [] },
    })
    const invalid = new PersonalCenterStore(ctx)
    await invalid.load()
    expect(invalid.store.getSnapshot().deepseek.balance).toBe('¥0.00')
    vi.stubEnv('DSH_CLIENT_VERSION', '')
    const missingVersion = new PersonalCenterStore(ctx)
    await missingVersion.load()
    expect(missingVersion.store.getSnapshot().deepseek.status).toBe('failed')
  })
})
