/**
 * Browser-safe local usage fold over unarchived Session logs.
 * @module @deepseek-ai/dsh-usage-stats/types
 */

import type {} from '@deepseek-ai/dsh-typert-protocol'

/** Disjoint token buckets matching the token-meter projection. */
export interface UsageTokenTotals {
  uncachedInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
}

/** One local-calendar day of usage. */
export interface UsageDayBucket {
  /** `YYYY-MM-DD` in the snapshot timezone. */
  day: string
  tokens: UsageTokenTotals
  sessionCount: number
  toolCalls: number
}

/** Token totals for one model id. */
export interface UsageModelRow {
  model: string
  tokens: UsageTokenTotals
}

/** Tool invocation counts by name. */
export interface UsageToolRow {
  name: string
  count: number
}

/** One unarchived session in the recents list. */
export interface UsageSessionRow {
  sessionId: string
  title: string
  tokens: UsageTokenTotals
  updatedAt: number
}

/** Host usage snapshot for the Personal Center. */
export interface UsageSnapshot {
  /** Client-supplied UTC offset in seconds (east of UTC). */
  timezoneOffsetSeconds: number
  /** Epoch milliseconds when this snapshot was folded. */
  generatedAt: number
  totals: UsageTokenTotals
  sessionCount: number
  toolCalls: number
  days: UsageDayBucket[]
  models: UsageModelRow[]
  tools: UsageToolRow[]
  sessions: UsageSessionRow[]
}
