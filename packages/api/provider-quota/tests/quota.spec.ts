import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { LlmError } from '@deepseek-ai/dsh-llm'
import * as antigravity from '@deepseek-ai/dsh-llm-antigravity'
import { recordKeyFor } from '@deepseek-ai/dsh-llm-pi-ai'
import * as piAi from '@deepseek-ai/dsh-llm-pi-ai'
import ProviderQuota from '../src/index.ts'

const roots: Context[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

function fixture(records: Record<string, unknown> = {}) {
  const ctx = new Context()
  roots.push(ctx)
  ctx.provide('credentials', {
    readRecord: vi.fn(async (key: string) => {
      const payload = records[String(key)]
      return payload === undefined ? undefined : { kind: 'grant' as const, payload }
    }),
  })
  return { ctx, quota: new ProviderQuota(ctx) }
}

it('returns unsigned Codex when no oauth grant is stored', async () => {
  const { quota } = fixture()
  const view = await quota.get('codex')
  expect(view).toMatchObject({ provider: 'codex', status: 'unsigned' })
})

it('returns unsigned Antigravity when no grant or API key is stored', async () => {
  const { quota } = fixture()
  const view = await quota.get('antigravity')
  expect(view.provider).toBe('antigravity')
  expect(view.status === 'unsigned' || view.status === 'failed').toBe(true)
})

it('rejects an unknown provider id', async () => {
  const { quota } = fixture()
  await expect(quota.get('other' as 'codex')).rejects.toMatchObject({ code: 'provider-quota/unknown-provider' })
})

it('does not consume a reset credit without a stored grant', async () => {
  const { quota } = fixture()
  const result = await quota.consumeCodexReset()
  expect(result.ok).toBe(false)
  expect(result.quota.status).toBe('unsigned')
})

it('consumes a reset without JWT-derived account fields', async () => {
  const { quota } = fixture({
    [String(recordKeyFor('openai-codex'))]: { type: 'oauth', access: 'tok' },
  })
  vi.spyOn(piAi, 'fetchCodexQuota').mockResolvedValue({
    status: 'ready',
    planType: 'plus',
    subscriptionActiveUntilMs: null,
    creditBalance: null,
    creditsUnlimited: false,
    windows: [],
    resetCredits: [],
    resetCreditsAvailableCount: 0,
    models: [],
  })
  vi.spyOn(piAi, 'consumeCodexRateLimitResetCredit').mockResolvedValue({
    ok: true,
    quota: {
      status: 'ready',
      planType: 'plus',
      subscriptionActiveUntilMs: null,
      creditBalance: null,
      creditsUnlimited: false,
      windows: [],
      resetCredits: [],
      resetCreditsAvailableCount: 0,
      models: [],
    },
  })
  expect((await quota.get('codex')).status).toBe('ready')
  expect((await quota.consumeCodexReset()).ok).toBe(true)
})

it('maps a stored Codex grant onto a safe view and consume result', async () => {
  const payload = Buffer.from(JSON.stringify({
    chatgpt_account_id: 'acct',
    chatgpt_subscription_active_until: 1_800_000_000,
  })).toString('base64url')
  const { quota } = fixture({
    [String(recordKeyFor('openai-codex'))]: { type: 'oauth', access: `x.${payload}.y` },
  })
  vi.spyOn(piAi, 'fetchCodexQuota').mockResolvedValue({
    status: 'ready',
    planType: 'plus',
    subscriptionActiveUntilMs: 1,
    creditBalance: '3',
    creditsUnlimited: false,
    windows: [{
      id: 'primary', kind: 'fiveHour', group: 'standard', featureName: null, remainingPercent: 60, usedPercent: 40, resetAtMs: 2, windowSeconds: 18_000,
    }],
    resetCredits: [{ id: 'c1', expiresAtMs: 3 }],
    resetCreditsAvailableCount: 1,
    models: [{ id: 'gpt-5.5', name: 'GPT-5.5' }],
    error: 'unused',
  })
  vi.spyOn(piAi, 'consumeCodexRateLimitResetCredit').mockResolvedValue({
    ok: true,
    quota: {
      status: 'ready',
      planType: 'plus',
      subscriptionActiveUntilMs: 1,
      creditBalance: '3',
      creditsUnlimited: false,
      windows: [],
      resetCredits: [],
      resetCreditsAvailableCount: 0,
      models: [],
    },
  })
  const view = await quota.get('codex')
  expect(view).toMatchObject({ provider: 'codex', status: 'ready', planType: 'plus', error: 'unused' })
  const consumed = await quota.consumeCodexReset()
  expect(consumed.ok).toBe(true)
  expect(consumed.quota.resetCreditsAvailableCount).toBe(0)
})

it('maps Antigravity remaining fractions and treats AUTH as unsigned', async () => {
  const { quota } = fixture()
  vi.spyOn(antigravity, 'fetchAvailableModels').mockResolvedValue([{ id: 'gemini-pro', name: 'Gemini Pro' }])
  vi.spyOn(antigravity, 'resolveAccessToken').mockResolvedValue('tok')
  vi.spyOn(antigravity, 'fetchAntigravityQuotaForToken').mockResolvedValue({
    status: 'ready',
    plan: 'pro',
    tierId: 'g1-pro-tier',
    groups: [{
      id: 'gemini',
      label: 'Gemini',
      buckets: [
        { id: '5h', remainingFraction: 0.5, resetAtMs: 1 },
        { id: 'weekly', remainingFraction: null, resetAtMs: null },
        { id: 'extra', remainingFraction: 0.123, resetAtMs: 2 },
      ],
    }],
    error: 'unused',
  })
  const view = await quota.get('antigravity')
  expect(view).toMatchObject({ provider: 'antigravity', status: 'ready', plan: 'pro', error: 'unused' })
  if (view.provider !== 'antigravity') throw new Error('expected antigravity')
  expect(view.groups[0]?.buckets.map(bucket => [bucket.kind, bucket.remainingPercent])).toEqual([
    ['fiveHour', 50],
    ['weekly', null],
    ['unknown', 12.3],
  ])
  vi.spyOn(antigravity, 'resolveAccessToken').mockRejectedValue(new LlmError('signed out', 'AUTH'))
  expect((await quota.get('antigravity')).status).toBe('unsigned')
  vi.spyOn(antigravity, 'resolveAccessToken').mockRejectedValue(new Error('offline'))
  expect((await quota.get('antigravity')).status).toBe('failed')
  vi.spyOn(antigravity, 'resolveAccessToken').mockRejectedValue(new LlmError('missing', 'MISSING_CREDENTIAL'))
  expect((await quota.get('antigravity')).status).toBe('unsigned')
  vi.spyOn(antigravity, 'resolveAccessToken').mockRejectedValue('down')
  expect((await quota.get('antigravity')).status).toBe('failed')
})

it('ignores a stored Codex record that is not an oauth grant', async () => {
  const { quota } = fixture({
    [String(recordKeyFor('openai-codex'))]: { type: 'api_key', access: 'tok' },
  })
  expect((await quota.get('codex')).status).toBe('unsigned')
})

it('forwards JWT account id and subscription onto the Codex fetch', async () => {
  const payload = Buffer.from(JSON.stringify({
    chatgpt_account_id: 'acct',
    chatgpt_subscription_active_until: 1_800_000_000,
  })).toString('base64url')
  const { quota } = fixture({
    [String(recordKeyFor('openai-codex'))]: { type: 'oauth', access: `x.${payload}.y` },
  })
  const fetch = vi.spyOn(piAi, 'fetchCodexQuota').mockResolvedValue({
    status: 'ready',
    planType: 'plus',
    subscriptionActiveUntilMs: null,
    creditBalance: null,
    creditsUnlimited: false,
    windows: [],
    resetCredits: [],
    resetCreditsAvailableCount: null,
    models: [],
  })
  expect((await quota.get('codex')).status).toBe('ready')
  expect(fetch.mock.calls[0]?.[0]).toMatchObject({ chatgptAccountId: 'acct', subscriptionActiveUntil: 1_800_000_000_000 })
})

it('forwards chatgpt account id from a stored id_token', async () => {
  const access = Buffer.from(JSON.stringify({})).toString('base64url')
  const idToken = Buffer.from(JSON.stringify({
    chatgpt_account_id: 'from-id',
    chatgpt_subscription_active_until: 1_800_000_000,
  })).toString('base64url')
  const { quota } = fixture({
    [String(recordKeyFor('openai-codex'))]: { type: 'oauth', access: `x.${access}.y`, id_token: `x.${idToken}.y` },
  })
  const fetch = vi.spyOn(piAi, 'fetchCodexQuota').mockResolvedValue({
    status: 'ready',
    planType: 'plus',
    subscriptionActiveUntilMs: null,
    creditBalance: null,
    creditsUnlimited: false,
    windows: [],
    resetCredits: [],
    resetCreditsAvailableCount: null,
    models: [],
  })
  expect((await quota.get('codex')).status).toBe('ready')
  expect(fetch.mock.calls[0]?.[0]).toMatchObject({ chatgptAccountId: 'from-id' })
})

it('skips a stored Codex record that is not a grant', async () => {
  const ctx = new Context()
  roots.push(ctx)
  ctx.provide('credentials', {
    readRecord: vi.fn(async () => ({ kind: 'api-key', payload: { type: 'oauth', access: 'tok' } })),
  })
  expect((await new ProviderQuota(ctx).get('codex')).status).toBe('unsigned')
})

it('recovers subscription expiry from a refreshed identity after the subscription lookup fails', async () => {
  const { quota } = fixture()
  const identity = 'header.' + Buffer.from(JSON.stringify({
    'https://api.openai.com/auth': { chatgpt_subscription_active_until: '2026-12-01T00:00:00Z' },
  })).toString('base64url') + '.signature'
  const grants = vi.spyOn(piAi, 'currentCodexGrant').mockImplementation(async (_ctx, includeIdentity) => ({
    kind: 'grant',
    payload: { type: 'oauth', access: 'access', ...includeIdentity ? { id_token: identity } : {} },
  }))
  vi.spyOn(piAi, 'fetchCodexQuota').mockResolvedValue({
    ...piAi.unsignedCodexQuota(), status: 'ready', models: [{ id: 'model', name: 'Model' }],
  })
  const view = await quota.get('codex')
  expect(view).toMatchObject({ subscriptionActiveUntilMs: Date.parse('2026-12-01T00:00:00Z'), models: [{ id: 'model', name: 'Model' }] })
  expect(grants.mock.calls[1]?.[1]).toBe(true)
})
