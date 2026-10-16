/** Compact counts and Hub-style relative dates for marketplace cards. */

import { relativeTime, type RelativeTimeUnit } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarketplaceLocaleKey } from './locales.ts'

/**
 * Format a star/fork count the way Hub cards do (`7k`, `4.1k`).
 * @param value - integer count.
 * @returns Formatted compact count string.
 */
export function formatCount(value: number | undefined): string {
  if (value === undefined || value <= 0) return '0'
  if (value < 1000) return String(value)
  const thousands = value / 1000
  if (Number.isInteger(thousands)) return `${String(thousands)}k`
  return `${thousands.toFixed(1)}k`
}

/**
 * Localize an ISO / date-string as Hub's "updated N days ago".
 * @param stamp - `updatedAt` from the catalog.
 * @param now - epoch ms.
 * @param t - marketplace dictionary.
 * @returns Localized relative date string.
 */
export function formatUpdated(
  stamp: string | undefined,
  now: number,
  t: (key: MarketplaceLocaleKey, params?: Record<string, unknown>) => string,
): string {
  if (stamp === undefined || stamp.length === 0) return ''
  const at = Date.parse(stamp)
  if (!Number.isFinite(at)) return stamp
  const { unit, n } = relativeTime(at, now)
  const inner = unit === 'now' ? t('timeNow') : t(timeKey(unit), { n })
  return unit === 'now' ? inner : t('timeAgo', { t: inner })
}

function timeKey(unit: RelativeTimeUnit): MarketplaceLocaleKey {
  switch (unit) {
    case 'now': return 'timeNow'
    case 'minutes': return 'timeMinutes'
    case 'hours': return 'timeHours'
    case 'days': return 'timeDays'
    case 'months': return 'timeMonths'
    case 'years': return 'timeYears'
  }
}
