import { describe, expect, it, vi } from 'vitest'
import { ok } from '@deepseek-ai/dsh-remote-mock'
import type { CodexQuotaView, ConsumeCodexResetResult, ProviderQuotaView } from '@deepseek-ai/dsh-api-provider-quota/types'
import { QuotaStore, type QuotaRemote } from '../src/client/quota-store.ts'

const ready: CodexQuotaView = {
  provider: 'codex',
  status: 'ready',
  planType: 'plus',
  subscriptionActiveUntilMs: null,
  creditBalance: null,
  creditsUnlimited: false,
  windows: [],
  resetCredits: [{ id: 'c1', expiresAtMs: Date.parse('2026-10-16T08:00:00.000Z') }],
  resetCreditsAvailableCount: 1,
  models: [],
}

describe('QuotaStore consume', () => {
  it('keeps the existing Codex card when redeem fails', async () => {
    const consume = vi.fn(async (): Promise<{ ok: true; value: ConsumeCodexResetResult }> => ok({
      ok: false,
      quota: ready,
    }))
    const remote = {
      providerQuota: {
        get: vi.fn(async (provider: 'codex' | 'antigravity') => ok(
          provider === 'codex' ? ready : { provider: 'antigravity', status: 'unsigned', plan: null, tierId: null, groups: [] } as ProviderQuotaView,
        )),
        consumeCodexReset: consume,
      },
    }
    const store = new QuotaStore(remote as unknown as QuotaRemote)
    await store.refresh()
    expect(store.store.getSnapshot().codex?.resetCreditsAvailableCount).toBe(1)
    await store.consumeReset()
    expect(store.store.getSnapshot().codex?.planType).toBe('plus')
    expect(store.store.getSnapshot().notice?.textKey).toBe('resetFailed')
    expect(store.store.getSnapshot().codex?.resetCreditsAvailableCount).toBe(1)
  })

  it('keeps the existing Codex card when the Remote itself fails', async () => {
    const remote = {
      providerQuota: {
        get: vi.fn(async (provider: 'codex' | 'antigravity') => ok(
          provider === 'codex' ? ready : { provider: 'antigravity', status: 'unsigned', plan: null, tierId: null, groups: [] } as ProviderQuotaView,
        )),
        consumeCodexReset: vi.fn(async () => ({ ok: false as const, error: { code: 'disconnected', message: 'down' } })),
      },
    }
    const store = new QuotaStore(remote as unknown as QuotaRemote)
    await store.refresh()
    await store.consumeReset()
    expect(store.store.getSnapshot().codex?.planType).toBe('plus')
    expect(store.store.getSnapshot().notice?.textKey).toBe('resetFailed')
  })

  it('marks the snapshot failed only when both providers fail', async () => {
    const remote = {
      providerQuota: {
        get: vi.fn(async (provider: 'codex' | 'antigravity') => {
          if (provider === 'codex') throw new Error('offline')
          return ok({ provider: 'antigravity', status: 'unsigned', plan: null, tierId: null, groups: [] } as ProviderQuotaView)
        }),
        consumeCodexReset: vi.fn(),
      },
    }
    const store = new QuotaStore(remote as unknown as QuotaRemote)
    await store.refresh()
    expect(store.store.getSnapshot().status).toBe('ready')
    expect(store.store.getSnapshot().codex?.status).toBe('failed')
    expect(store.store.getSnapshot().antigravity?.status).toBe('unsigned')
  })

  it('publishes a success notice after redeem and ignores a concurrent second click', async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    const consume = vi.fn(async () => {
      await pending
      return ok({ ok: true, quota: { ...ready, resetCreditsAvailableCount: 0, resetCredits: [] } })
    })
    const remote = {
      providerQuota: {
        get: vi.fn(async (provider: 'codex' | 'antigravity') => ok(
          provider === 'codex' ? ready : { provider: 'antigravity', status: 'unsigned', plan: null, tierId: null, groups: [] } as ProviderQuotaView,
        )),
        consumeCodexReset: consume,
      },
    }
    const store = new QuotaStore(remote as unknown as QuotaRemote)
    await store.refresh()
    const first = store.consumeReset()
    await store.consumeReset()
    release()
    await first
    expect(consume).toHaveBeenCalledOnce()
    expect(store.store.getSnapshot().notice?.textKey).toBe('resetOk')
    store.dismissNotice()
    expect(store.store.getSnapshot().notice).toBeNull()
    store.dismissNotice()
    store.dispose()
  })

  it('treats a malformed provider payload as a failed card and keeps a card when consume throws', async () => {
    const remote = {
      providerQuota: {
        get: vi.fn(async (provider: 'codex' | 'antigravity') => {
          if (provider === 'codex') return { ok: false as const, error: { code: 'x', message: 'no' } }
          return { ok: false as const, error: { code: 'x', message: 'no' } }
        }),
        consumeCodexReset: vi.fn(async () => { throw new Error('offline') }),
      },
    }
    const store = new QuotaStore(remote as unknown as QuotaRemote)
    const loading = store.refresh()
    expect(store.store.getSnapshot().status).toBe('loading')
    await loading
    expect(store.store.getSnapshot().codex?.status).toBe('failed')
    expect(store.store.getSnapshot().antigravity?.status).toBe('failed')
    expect(store.store.getSnapshot().status).toBe('failed')
    await store.consumeReset()
    expect(store.store.getSnapshot().notice?.textKey).toBe('resetFailed')
    remote.providerQuota.get = vi.fn(async () => { throw new Error('offline') })
    await store.refresh()
    expect(store.store.getSnapshot().status).toBe('failed')
  })

  it('keeps the previous Codex card when redeem reports unsigned', async () => {
    const remote = {
      providerQuota: {
        get: vi.fn(async (provider: 'codex' | 'antigravity') => ok(
          provider === 'codex' ? ready : { provider: 'antigravity', status: 'unsigned', plan: null, tierId: null, groups: [] } as ProviderQuotaView,
        )),
        consumeCodexReset: vi.fn(async () => ok({
          ok: true,
          quota: {
            provider: 'codex' as const, status: 'unsigned' as const, planType: null, subscriptionActiveUntilMs: null,
            creditBalance: null, creditsUnlimited: false, windows: [], resetCredits: [], resetCreditsAvailableCount: null, models: [],
          },
        })),
      },
    }
    const store = new QuotaStore(remote as unknown as QuotaRemote)
    await store.refresh()
    await store.consumeReset()
    expect(store.store.getSnapshot().codex?.planType).toBe('plus')
    const stale = store.refresh()
    store.dispose()
    await stale
  })
})
