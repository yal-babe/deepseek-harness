import { describe, expect, it, vi } from 'vitest'
import {
  accessTokenFromCodexGrant,
  extractCodexChatgptAccountId,
  idTokenFromCodexGrant,
  isCodexConsumeSuccess,
  parseCodexResetCredits,
  parseCodexSubscriptionActiveUntilMs,
  parseCodexSubscriptionModels,
  parseCodexUsage,
} from '../src/quota.ts'

describe('parseCodexUsage', () => {
  it('reads WHAM primary_window / secondary_window as remaining percent', () => {
    const parsed = parseCodexUsage({
      plan_type: 'plus',
      credits: { balance: '12.5', unlimited: false },
      rate_limit: {
        primary_window: { used_percent: 40, limit_window_seconds: 18000, reset_at: '2026-10-16T04:00:00.000Z' },
        secondary_window: { used_percent: 10, limit_window_seconds: 604800, reset_after_seconds: 60 },
      },
      code_review_rate_limit: {
        primary_window: { used_percent: 0, limit_window_seconds: 18000 },
        secondary_window: { used_percent: 0, limit_window_seconds: 29 * 86400 },
      },
      rate_limit_reset_credits: { available_count: 2 },
    }, Date.parse('2026-10-15T00:00:00.000Z'))
    expect(parsed.planType).toBe('plus')
    expect(parsed.creditBalance).toBe('12.5')
    expect(parsed.windows.map(window => [window.kind, window.group, window.remainingPercent])).toEqual([
      ['fiveHour', 'standard', 60],
      ['weekly', 'standard', 90],
      ['fiveHour', 'codeReview', 100],
      ['monthly', 'codeReview', 100],
    ])
    expect(parsed.windows[1]?.resetAtMs).toBe(Date.parse('2026-10-15T00:01:00.000Z'))
    expect(parsed.resetCreditsAvailableCount).toBe(2)
  })

  it('treats unlimited credits as a flag without a balance string', () => {
    const parsed = parseCodexUsage({ credits: { unlimited: true, balance: '1' } })
    expect(parsed.creditsUnlimited).toBe(true)
    expect(parsed.creditBalance).toBeNull()
  })

  it('accepts camelCase and omits missing fields', () => {
    const parsed = parseCodexUsage({ planType: 'prolite', rateLimit: { usedPercent: 100 } })
    expect(parsed.planType).toBe('prolite')
    expect(parsed.creditBalance).toBeNull()
    expect(parsed.windows[0]?.remainingPercent).toBe(0)
    expect(parsed.windows[0]?.kind).toBe('unknown')
  })
})

describe('parseCodexResetCredits', () => {
  it('keeps only available codex_rate_limits credits', () => {
    expect(parseCodexResetCredits({
      credits: [
        { id: 'a', reset_type: 'codex_rate_limits', status: 'available', expires_at: '2026-10-16T16:00:00+08:00' },
        { id: 'b', reset_type: 'other', status: 'available' },
        { id: 'c', resetType: 'codex_rate_limits', status: 'used' },
      ],
    }).map(credit => credit.id)).toEqual(['a'])
  })
})

describe('consume and grant helpers', () => {
  it('treats reset and already_redeemed as success', () => {
    expect(isCodexConsumeSuccess({ code: 'reset' })).toBe(true)
    expect(isCodexConsumeSuccess({ code: 'already_redeemed' })).toBe(true)
    expect(isCodexConsumeSuccess({ code: 'denied' })).toBe(false)
  })

  it('reads chatgpt_account_id from the OpenAI auth claim', () => {
    const payload = Buffer.from(JSON.stringify({
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct_1' },
    })).toString('base64url')
    expect(extractCodexChatgptAccountId(`x.${payload}.y`)).toBe('acct_1')
    expect(accessTokenFromCodexGrant({ type: 'oauth', access: 'tok' })).toBe('tok')
    expect(accessTokenFromCodexGrant({ type: 'api_key' })).toBeUndefined()
  })

  it('parses subscription active_until', () => {
    expect(parseCodexSubscriptionActiveUntilMs({ activeUntil: '2026-11-01T00:00:00.000Z' }))
      .toBe(Date.parse('2026-11-01T00:00:00.000Z'))
    expect(parseCodexSubscriptionActiveUntilMs(null)).toBeUndefined()
    expect(accessTokenFromCodexGrant({ type: 'oauth', access: '' })).toBeUndefined()
    expect(extractCodexChatgptAccountId('a.%%%notjson%%%.b')).toBeUndefined()
    expect(extractCodexChatgptAccountId(`x.${Buffer.from('{}').toString('base64url')}.y`)).toBeUndefined()
    expect(parseCodexResetCredits(['skip', { reset_type: 'codex_rate_limits', status: 'available' }])[0]?.id)
      .toBe('credit-0')
    expect(parseCodexSubscriptionActiveUntilMs({ items: [{}, { active_until: 'nope' }] })).toBeUndefined()
    expect(parseCodexUsage({
      rate_limit: { secondary: { used_percent: 200 } },
    }).windows[0]?.remainingPercent).toBe(0)
    expect(parseCodexUsage({
      rate_limit: { used_percent: -10, reset_at: '1700000000' },
    }).windows[0]?.remainingPercent).toBe(100)
    expect(parseCodexSubscriptionActiveUntilMs({ subscriptions: [{ activeUntil: 1_800_000_000 }] }))
      .toBe(1_800_000_000_000)
    expect(parseCodexSubscriptionActiveUntilMs({ data: [{ active_until: 1_800_000_000 }] }))
      .toBe(1_800_000_000_000)
    expect(parseCodexSubscriptionActiveUntilMs({ items: null, subscriptions: [{ activeUntil: 1_800_000_000 }] }))
      .toBe(1_800_000_000_000)
    expect(parseCodexSubscriptionActiveUntilMs({ items: [null, { active_until: 1_800_000_000 }] }))
      .toBe(1_800_000_000_000)
    expect(parseCodexUsage(null).windows).toEqual([])
    expect(parseCodexUsage({ rate_limit: { primary: { used_percent: 5 } } }).windows).toHaveLength(1)
    expect(parseCodexUsage({ rate_limit: {} }).windows).toEqual([])
    expect(parseCodexSubscriptionModels({
      models: [
        { slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list' },
        { slug: 'hidden', visibility: 'hide' },
      ],
    })).toEqual([{ id: 'gpt-5.5', name: 'GPT-5.5' }])
    expect(idTokenFromCodexGrant({ type: 'oauth', access: 'a', id_token: 'id' })).toBe('id')
    expect(idTokenFromCodexGrant({ type: 'oauth', access: 'a', idToken: 'id2' })).toBe('id2')
    expect(idTokenFromCodexGrant({ type: 'oauth', access: 'a', idToken: '' })).toBeUndefined()
    expect(idTokenFromCodexGrant({ type: 'api_key' })).toBeUndefined()
    expect(parseCodexSubscriptionModels([{ slug: 'x', visibility: 'hidden' }])).toEqual([])
    expect(parseCodexSubscriptionModels([{ visibility: 'list' }])).toEqual([])
    expect(parseCodexSubscriptionActiveUntilMs([{ activeUntil: 1_800_000_000 }])).toBe(1_800_000_000_000)
    expect(parseCodexSubscriptionActiveUntilMs('')).toBeUndefined()
    expect(parseCodexSubscriptionActiveUntilMs('   ')).toBeUndefined()
    expect(parseCodexSubscriptionActiveUntilMs('{"active_until":"2026-11-01T00:00:00.000Z"}'))
      .toBe(Date.parse('2026-11-01T00:00:00.000Z'))
    expect(parseCodexUsage({
      additional_rate_limits: [{
        limit_name: 'extra',
        rate_limit: {
          primary_window: { used_percent: 20, limit_window_seconds: 18000 },
        },
      }],
    }).windows[0]?.featureName).toBe('extra')
    expect(parseCodexUsage({
      additional_rate_limits: { '': { used_percent: 1, limit_window_seconds: 18000 } },
    }).windows[0]?.id.startsWith('additional:feature')).toBe(true)
    expect(parseCodexUsage({ additional_rate_limits: [null, 'x'] }).windows).toEqual([])
    expect(parseCodexUsage({ additional_rate_limits: { extra: 1 } }).windows).toEqual([])
    expect(parseCodexSubscriptionActiveUntilMs([null, { activeUntil: 1_800_000_000 }]))
      .toBe(1_800_000_000_000)
    expect(parseCodexSubscriptionModels(['skip', { slug: 'ok' }])).toEqual([{ id: 'ok', name: null }])
    expect(parseCodexSubscriptionModels({ items: [{ id: 'from-items' }] })).toEqual([{ id: 'from-items', name: null }])
    expect(parseCodexSubscriptionModels({ data: [{ slug: 'from-data' }] })).toEqual([{ id: 'from-data', name: null }])
    expect(parseCodexUsage({
      additional_rate_limits: [{
        limitName: 'ln',
        used_percent: 2,
        limit_window_seconds: 18000,
      }],
    }).windows[0]?.featureName).toBe('ln')
    expect(parseCodexUsage({
      additional_rate_limits: [{
        metered_feature: 'mf',
        rateLimit: { used_percent: 3, limit_window_seconds: 18000 },
      }],
    }).windows[0]?.featureName).toBe('mf')
    expect(parseCodexUsage({
      additional_rate_limits: [{
        meteredFeature: 'mF',
        rate_limit: { used_percent: 4, limit_window_seconds: 18000 },
      }],
    }).windows[0]?.featureName).toBe('mF')
    expect(parseCodexUsage({
      additional_rate_limits: [{ rate_limit: { used_percent: 1, limit_window_seconds: 18000 } }],
    }).windows[0]?.featureName).toBe('additional-1')
    expect(parseCodexUsage({
      rate_limit: { limit_reached: true, primary_window: { limit_window_seconds: 18000 } },
    }).windows[0]?.remainingPercent).toBe(0)
    expect(parseCodexUsage({ rate_limit: { reset_at: '1700000000000' } }).windows[0]?.resetAtMs).toBe(1_700_000_000_000)
  })
})

describe('fetch substitutes', () => {
  it('does not treat a missing credits list as failure', () => {
    vi.useFakeTimers()
    const parsed = parseCodexUsage({})
    expect(parsed.windows).toEqual([])
    expect(parsed.resetCreditsAvailableCount).toBeNull()
    vi.useRealTimers()
  })
})

it('reads subscription expiry from the nested ChatGPT authentication claim', () => {
  expect(parseCodexSubscriptionActiveUntilMs({
    'https://api.openai.com/auth': {
      chatgpt_subscription_active_until: '2026-11-01T00:00:00.000Z',
    },
  })).toBe(Date.parse('2026-11-01T00:00:00.000Z'))
})
