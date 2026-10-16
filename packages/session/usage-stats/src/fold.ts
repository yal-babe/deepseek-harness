/**
 * Fold unarchived Session logs into calendar-day usage buckets.
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  UsageDayBucket,
  UsageModelRow,
  UsageSessionRow,
  UsageSnapshot,
  UsageTokenTotals,
  UsageToolRow,
} from './types.ts'

const emptyTokens = (): UsageTokenTotals => ({
  uncachedInputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
})

/** One session's folded usage used by the snapshot assembler. */
export interface FoldedSession {
  sessionId: string
  title: string
  tokens: UsageTokenTotals
  updatedAt: number
  toolCalls: Map<string, number>
  models: Map<string, UsageTokenTotals>
  days: Map<string, { tokens: UsageTokenTotals; toolCalls: number }>
}

/**
 * Format `YYYY-MM-DD` for `ms` in a fixed UTC offset.
 * @param ms - epoch milliseconds.
 * @param timezoneOffsetSeconds - seconds east of UTC.
 * @returns Date string formatted as YYYY-MM-DD.
 */
export function dayKey(ms: number, timezoneOffsetSeconds: number): string {
  const local = new Date(ms + timezoneOffsetSeconds * 1000)
  const year = local.getUTCFullYear()
  const month = String(local.getUTCMonth() + 1).padStart(2, '0')
  const day = String(local.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Add disjoint token buckets.
 * @param into - accumulator mutated in place.
 * @param add - increment.
 */
export function addTokens(into: UsageTokenTotals, add: UsageTokenTotals): void {
  into.uncachedInputTokens += add.uncachedInputTokens
  into.cacheReadTokens += add.cacheReadTokens
  into.cacheWriteTokens += add.cacheWriteTokens
  into.outputTokens += add.outputTokens
}

/**
 * Fold one Session log's usage, tool names, and model ids.
 * @param sessionId - session id string.
 * @param title - latest title, or the id when none exists.
 * @param events - complete raw log.
 * @param timezoneOffsetSeconds - seconds east of UTC.
 * @returns Folded session statistics.
 */
export function foldSessionUsage(
  sessionId: string,
  title: string,
  events: readonly SessionEvent[],
  timezoneOffsetSeconds: number,
): FoldedSession {
  const tokens = emptyTokens()
  const toolCalls = new Map<string, number>()
  const models = new Map<string, UsageTokenTotals>()
  const days = new Map<string, { tokens: UsageTokenTotals; toolCalls: number }>()
  let model = 'unknown'
  let updatedAt = 0
  for (const event of events) {
    if (event.time > updatedAt) updatedAt = event.time
    const day = dayKey(event.time, timezoneOffsetSeconds)
    const bucket = days.get(day) ?? { tokens: emptyTokens(), toolCalls: 0 }
    if (!days.has(day)) days.set(day, bucket)
    if (event.type === 'request/context') {
      model = event.data.model
      continue
    }
    if (event.type === 'tool/call') {
      toolCalls.set(event.data.name, (toolCalls.get(event.data.name) ?? 0) + 1)
      bucket.toolCalls += 1
      continue
    }
    if (event.type !== 'assistant/message' || event.data.usage === undefined) continue
    const usage = tokensOf(event.data.usage)
    addTokens(tokens, usage)
    addTokens(bucket.tokens, usage)
    const modelTokens = models.get(model) ?? emptyTokens()
    if (!models.has(model)) models.set(model, modelTokens)
    addTokens(modelTokens, usage)
  }
  return { sessionId, title, tokens, updatedAt, toolCalls, models, days }
}

/**
 * Merge folded sessions into one snapshot. Archived sessions must already be omitted.
 * @param timezoneOffsetSeconds - seconds east of UTC.
 * @param generatedAt - snapshot time.
 * @param sessions - folded unarchived sessions.
 * @returns Aggregated usage snapshot.
 */
export function assembleSnapshot(
  timezoneOffsetSeconds: number,
  generatedAt: number,
  sessions: readonly FoldedSession[],
): UsageSnapshot {
  const totals = emptyTokens()
  let toolCalls = 0
  const dayMap = new Map<string, UsageDayBucket>()
  const modelMap = new Map<string, UsageTokenTotals>()
  const toolMap = new Map<string, number>()
  const sessionRows: UsageSessionRow[] = []
  for (const session of sessions) {
    addTokens(totals, session.tokens)
    sessionRows.push({
      sessionId: session.sessionId,
      title: session.title,
      tokens: session.tokens,
      updatedAt: session.updatedAt,
    })
    for (const [name, count] of session.toolCalls) {
      toolCalls += count
      toolMap.set(name, (toolMap.get(name) ?? 0) + count)
    }
    for (const [model, tokens] of session.models) {
      const row = modelMap.get(model) ?? emptyTokens()
      if (!modelMap.has(model)) modelMap.set(model, row)
      addTokens(row, tokens)
    }
    for (const [day, bucket] of session.days) {
      const row = dayMap.get(day) ?? {
        day,
        tokens: emptyTokens(),
        sessionCount: 0,
        toolCalls: 0,
      }
      if (!dayMap.has(day)) dayMap.set(day, row)
      addTokens(row.tokens, bucket.tokens)
      row.sessionCount += 1
      row.toolCalls += bucket.toolCalls
    }
  }
  sessionRows.sort((left, right) => right.updatedAt - left.updatedAt)
  const recents = sessionRows.filter(row => totalOf(row.tokens) > 0)
  const days = [...dayMap.values()].sort((left, right) => left.day.localeCompare(right.day))
  const models: UsageModelRow[] = [...modelMap.entries()]
    .map(([model, tokens]) => ({ model, tokens }))
    .sort((left, right) => totalOf(right.tokens) - totalOf(left.tokens))
  const tools: UsageToolRow[] = [...toolMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
  return {
    timezoneOffsetSeconds,
    generatedAt,
    totals,
    sessionCount: sessions.length,
    toolCalls,
    days,
    models,
    tools,
    sessions: recents,
  }
}

function tokensOf(usage: {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}): UsageTokenTotals {
  return {
    uncachedInputTokens: usage.inputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    outputTokens: usage.outputTokens,
  }
}

function totalOf(tokens: UsageTokenTotals): number {
  return tokens.uncachedInputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens + tokens.outputTokens
}
