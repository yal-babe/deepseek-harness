import { describe, expect, it } from 'vitest'
import {
  buildAntigravityQuotaGroups,
  mapAntigravityPlan,
  parseAntigravitySubscription,
} from '../src/quota.ts'

describe('buildAntigravityQuotaGroups', () => {
  it('sorts buckets 5h then weekly and keeps remainingFraction leftover', () => {
    const groups = buildAntigravityQuotaGroups({
      quotaGroups: [{
        id: 'gemini',
        displayName: 'Gemini',
        buckets: [
          { id: 'weekly', remainingFraction: 0.4, resetTime: '2026-10-20T00:00:00.000Z' },
          { id: '5h', remainingFraction: 0.7, resetTime: 1_700_000_000_000 },
        ],
      }],
    })
    expect(groups[0]?.buckets.map(bucket => bucket.id)).toEqual(['5h', 'weekly'])
    expect(groups[0]?.buckets[0]?.remainingFraction).toBe(0.7)
  })

  it('accepts camel-missing groups as empty', () => {
    expect(buildAntigravityQuotaGroups({})).toEqual([])
  })

  it('unwraps a nested quota object and skips non-objects', () => {
    const groups = buildAntigravityQuotaGroups({
      quota: {
        name: 'gemini',
        buckets: [
          { window: '7d', remaining: 80, reset_at: '2026-10-20T00:00:00.000Z' },
          'skip',
        ],
      },
    })
    expect(groups[0]?.id).toBe('gemini')
    expect(groups[0]?.buckets[0]?.id).toBe('weekly')
    expect(groups[0]?.buckets[0]?.remainingFraction).toBe(0.8)
  })

  it('skips non-object groups and accepts quotaBuckets', () => {
    expect(parseAntigravitySubscription(null)).toEqual({ plan: null, tierId: null })
    expect(buildAntigravityQuotaGroups(null)).toEqual([])
    const groups = buildAntigravityQuotaGroups({
      groups: [
        'skip',
        { quotaBuckets: [{ id: 'five_hour', remaining_fraction: 0.1, reset_time: 1_700_000_000 }] },
        { limits: [{ id: 'week', remaining: Number.NaN, reset_at: 'not-a-date' }] },
      ],
    })
    expect(groups[0]?.id).toBe('group-1')
    expect(groups[0]?.buckets[0]?.id).toBe('5h')
    expect(groups[1]?.buckets[0]?.id).toBe('weekly')
  })
})

describe('parseAntigravitySubscription', () => {
  it('prefers paidTier over currentTier and maps known ids', () => {
    expect(parseAntigravitySubscription({
      paidTier: { id: 'g1-ultra-tier' },
      currentTier: { id: 'free-tier' },
    })).toEqual({ plan: 'ultra', tierId: 'g1-ultra-tier' })
    expect(mapAntigravityPlan('g1-pro-tier')).toBe('pro')
    expect(mapAntigravityPlan('g1-ultra-lite-tier')).toBe('ultra-lite')
    expect(mapAntigravityPlan('free-tier')).toBe('free')
    expect(mapAntigravityPlan('mystery')).toBe('unknown')
    expect(mapAntigravityPlan('')).toBeNull()
    expect(mapAntigravityPlan('pro')).toBe('pro')
    expect(mapAntigravityPlan('ultralite')).toBe('ultra-lite')
    expect(parseAntigravitySubscription({ currentTier: { id: 'g1-ultra-lite-tier' } }).plan).toBe('ultra-lite')
  })
})
