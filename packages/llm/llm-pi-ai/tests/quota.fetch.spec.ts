import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  consumeCodexRateLimitResetCredit,
  extractCodexChatgptAccountId,
  extractCodexSubscriptionActiveUntilMs,
  fetchCodexQuota,
  parseCodexResetCredits,
  parseCodexSubscriptionActiveUntilMs,
  parseCodexUsage,
  unsignedCodexQuota,
} from '../src/quota.ts'

afterEach(() => { vi.unstubAllGlobals() })

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('fetchCodexQuota', () => {
  it('reads usage, subscriptions, and available reset credits', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const href = String(input)
      if (href.includes('/wham/usage')) {
        return jsonResponse({
          plan_type: 'plus',
          credits: { balance: '3', unlimited: false },
          rate_limit: { used_percent: 25, limit_window_seconds: 18000, reset_at: '2026-10-16T04:00:00.000Z' },
          additional_rate_limits: { extra: { used_percent: 50, limit_window_seconds: 604800 } },
        })
      }
      if (href.includes('/subscriptions')) {
        return jsonResponse({ items: [{ active_until: '2026-11-01T00:00:00.000Z' }] })
      }
      if (href.includes('rate-limit-reset-credits')) {
        return jsonResponse({
          credits: [{ id: 'a', reset_type: 'codex_rate_limits', status: 'available', expires_at: '2026-10-16T16:00:00+08:00' }],
        })
      }
      if (href.includes('/codex/models')) {
        return jsonResponse({ models: [{ slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list' }] })
      }
      return jsonResponse({}, 404)
    })
    const snapshot = await fetchCodexQuota({
      accessToken: 'tok',
      chatgptAccountId: 'acct',
      fetchImpl: fetchImpl as typeof fetch,
      nowMs: Date.parse('2026-10-15T00:00:00.000Z'),
    })
    expect(snapshot.status).toBe('ready')
    expect(snapshot.planType).toBe('plus')
    expect(snapshot.resetCredits).toHaveLength(1)
    expect(snapshot.subscriptionActiveUntilMs).toBe(Date.parse('2026-11-01T00:00:00.000Z'))
    expect(snapshot.windows.some(window => window.id.startsWith('additional:'))).toBe(true)
    expect(snapshot.models).toEqual([{ id: 'gpt-5.5', name: 'GPT-5.5' }])
  })

  it('keeps the usage card when credits and subscriptions fail', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const href = String(input)
      if (href.includes('/wham/usage')) return jsonResponse({ planType: 'pro' })
      if (href.includes('/codex/models')) return new Response('not-json', { status: 200 })
      if (href.includes('/subscriptions')) return jsonResponse({}, 403)
      return jsonResponse({}, 500)
    })
    const snapshot = await fetchCodexQuota({
      accessToken: 'tok',
      chatgptAccountId: 'acct',
      fetchImpl: fetchImpl as typeof fetch,
    })
    expect(snapshot.status).toBe('ready')
    expect(snapshot.planType).toBe('pro')
    expect(snapshot.resetCredits).toEqual([])
    expect(snapshot.models).toEqual([])
    const thrown = await fetchCodexQuota({
      accessToken: 'tok',
      chatgptAccountId: 'acct',
      fetchImpl: (async (input: RequestInfo | URL) => {
        const href = String(input)
        if (href.includes('/wham/usage')) return jsonResponse({ planType: 'pro' })
        if (href.includes('/subscriptions')) throw new Error('down')
        return jsonResponse({}, 500)
      }) as typeof fetch,
    })
    expect(thrown.status).toBe('ready')
  })

  it('returns failed when usage HTTP or JSON is invalid', async () => {
    expect((await fetchCodexQuota({
      accessToken: 'tok',
      fetchImpl: (async () => jsonResponse({}, 401)) as typeof fetch,
    })).status).toBe('failed')
    expect((await fetchCodexQuota({
      accessToken: 'tok',
      fetchImpl: (async () => new Response('not-json', { status: 200 })) as typeof fetch,
    })).error).toBe('usage JSON is invalid')
    expect((await fetchCodexQuota({
      accessToken: 'tok',
      fetchImpl: (async () => { throw new Error('offline') }) as typeof fetch,
    })).error).toBe('offline')
    expect((await fetchCodexQuota({
      accessToken: 'tok',
      fetchImpl: (async () => { throw 42 }) as typeof fetch,
    })).error).toBe('42')
  })
})

describe('consumeCodexRateLimitResetCredit', () => {
  it('treats already_redeemed as success and reloads usage', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ code: 'already_redeemed' })
      return jsonResponse({ plan_type: 'team' })
    })
    const result = await consumeCodexRateLimitResetCredit({
      accessToken: 'tok',
      fetchImpl: fetchImpl as typeof fetch,
    })
    expect(result.ok).toBe(true)
    expect(result.quota.planType).toBe('team')
  })

  it('treats reset as success and reloads usage', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ code: 'reset' })
      return jsonResponse({ plan_type: 'plus' })
    })
    const result = await consumeCodexRateLimitResetCredit({
      accessToken: 'tok',
      fetchImpl: fetchImpl as typeof fetch,
    })
    expect(result.ok).toBe(true)
    expect(result.quota.planType).toBe('plus')
  })

  it('keeps a reloaded card when redeem is denied', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ code: 'denied', message: 'nope' }, 400)
      return jsonResponse({ plan_type: 'plus', rate_limit_reset_credits: { available_count: 1 } })
    })
    const result = await consumeCodexRateLimitResetCredit({
      accessToken: 'tok',
      fetchImpl: fetchImpl as typeof fetch,
    })
    expect(result.ok).toBe(false)
    expect(result.quota.planType).toBe('plus')
    expect(result.quota.resetCreditsAvailableCount).toBe(1)
  })

  it('treats a thrown consume as a failed snapshot', async () => {
    const result = await consumeCodexRateLimitResetCredit({
      accessToken: 'tok',
      fetchImpl: (async () => { throw new Error('offline') }) as typeof fetch,
    })
    expect(result.ok).toBe(false)
    expect(result.quota.error).toBe('offline')
    const thrown = await consumeCodexRateLimitResetCredit({
      accessToken: 'tok',
      fetchImpl: (async () => { throw 42 }) as typeof fetch,
    })
    expect(thrown.ok).toBe(false)
    expect(thrown.quota.error).toBe('42')
  })

  it('reloads usage when redeem and usage both fail', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response('not-json', { status: 503 })
      return jsonResponse({}, 500)
    })
    const result = await consumeCodexRateLimitResetCredit({
      accessToken: 'tok',
      fetchImpl: fetchImpl as typeof fetch,
    })
    expect(result.ok).toBe(false)
    expect(result.quota.error).toBe('usage HTTP 500')
  })

  it('parses empty consume bodies and numeric reset instants', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response('', { status: 200 })
      return jsonResponse({
        rate_limit: { used_percent: 10, reset_at: 1_700_000_000_000, limit_window_seconds: 1.5 },
        additional_rate_limits: { extra: { usedPercent: 5, resetAfterSeconds: 10 } },
      })
    })
    const result = await consumeCodexRateLimitResetCredit({
      accessToken: '',
      chatgptAccountId: '',
      fetchImpl: fetchImpl as typeof fetch,
      nowMs: 1_000,
    })
    expect(result.ok).toBe(false)
    expect(result.quota.windows[0]?.resetAtMs).toBe(1_700_000_000_000)
  })

  it('falls back to the JWT subscription when WHAM omits one', async () => {
    const payload = Buffer.from(JSON.stringify({ chatgpt_subscription_active_until: '1800000000' })).toString('base64url')
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const href = String(input)
      if (href.includes('/wham/usage')) return jsonResponse({ plan_type: 'free' })
      if (href.includes('rate-limit-reset-credits')) return new Response('not-json', { status: 200 })
      if (href.includes('/subscriptions')) return new Response('not-json', { status: 200 })
      return jsonResponse({}, 404)
    })
    const snapshot = await fetchCodexQuota({
      accessToken: `x.${payload}.y`,
      chatgptAccountId: 'acct',
      fetchImpl: fetchImpl as typeof fetch,
    })
    expect(snapshot.subscriptionActiveUntilMs).toBe(1_800_000_000_000)
  })

  it('maps a thrown non-Error usage failure', async () => {
    const snapshot = await fetchCodexQuota({
      accessToken: 'tok',
      fetchImpl: (async () => { throw 'offline' }) as typeof fetch,
    })
    expect(snapshot.error).toBe('offline')
  })

  it('uses global fetch when no implementation is supplied', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ code: 'reset' })
      return jsonResponse({ plan_type: 'plus' })
    }))
    const snapshot = await fetchCodexQuota({ accessToken: 'tok' })
    expect(snapshot.planType).toBe('plus')
    const consumed = await consumeCodexRateLimitResetCredit({ accessToken: 'tok' })
    expect(consumed.ok).toBe(true)
  })
})

describe('quota helpers', () => {
  it('reads top-level chatgpt_account_id and subscription until', () => {
    const payload = Buffer.from(JSON.stringify({
      chatgpt_account_id: 'acct_top',
      chatgpt_subscription_active_until: 1_800_000_000,
    })).toString('base64url')
    expect(extractCodexChatgptAccountId(`x.${payload}.y`)).toBe('acct_top')
    expect(extractCodexSubscriptionActiveUntilMs(`x.${payload}.y`)).toBe(1_800_000_000_000)
    expect(extractCodexChatgptAccountId('not-a-jwt')).toBeUndefined()
    expect(unsignedCodexQuota().status).toBe('unsigned')
  })

  it('parses reset-credit arrays and subscription lists', () => {
    expect(parseCodexResetCredits([
      { id: 'a', reset_type: 'codex_rate_limits', status: 'available' },
    ]).map(credit => credit.id)).toEqual(['a'])
    expect(parseCodexSubscriptionActiveUntilMs({
      data: [{ activeUntil: '2026-12-01T00:00:00.000Z' }],
    })).toBe(Date.parse('2026-12-01T00:00:00.000Z'))
    expect(parseCodexUsage({
      rate_limit: { usedPercent: 10, resetAfterSeconds: 30 },
    }, Date.parse('2026-10-15T00:00:00.000Z')).windows[0]?.resetAtMs).toBe(Date.parse('2026-10-15T00:00:30.000Z'))
  })
})
