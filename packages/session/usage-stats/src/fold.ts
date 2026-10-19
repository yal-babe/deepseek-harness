/**
 * Fold unarchived Session logs into calendar-day usage buckets.
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { collectRecordedUsage, type RecordedUsageAttempt } from '@deepseek-ai/dsh-token-meter'
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
  /** Complete logical Session consumption, including inherited requests, for per-Session display. */
  sessionTokens: UsageTokenTotals
  updatedAt: number
  toolCalls: Map<string, number>
  models: Map<string, UsageModelRow>
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
  const total = totalOf(into) + totalOf(add)
  if (add.incomplete) into.incomplete = true
  if (add.cacheReadUnknown) into.cacheReadUnknown = true
  if (add.cacheWriteUnknown) into.cacheWriteUnknown = true
  into.uncachedInputTokens += add.uncachedInputTokens
  into.cacheReadTokens += add.cacheReadTokens
  into.cacheWriteTokens += add.cacheWriteTokens
  into.outputTokens += add.outputTokens
  delete into.totalTokens
  if (total !== totalOf(into)) into.totalTokens = total
}

/**
 * Fold one Session log's usage, tool names, and model ids.
 * @param sessionId - session id string.
 * @param title - latest title, or the id when none exists.
 * @param events - complete raw log.
 * @param timezoneOffsetSeconds - seconds east of UTC.
 * @param attempts - deduplicated request settlements assigned to this session; defaults to its full log.
 * @param inheritedEventCount - copied prefix omitted from tool and activity counts.
 * @returns Folded session statistics.
 */
export function foldSessionUsage(
  sessionId: string,
  title: string,
  events: readonly SessionEvent[],
  timezoneOffsetSeconds: number,
  attempts?: readonly RecordedUsageAttempt[],
  inheritedEventCount = 0,
): FoldedSession {
  const recorded = collectRecordedUsage(events)
  const sessionTokens = emptyTokens()
  for (const attempt of recorded) addTokens(sessionTokens, attemptTokens(attempt))
  const tokens = emptyTokens()
  const toolCalls = new Map<string, number>()
  const models = new Map<string, UsageModelRow>()
  const days = new Map<string, { tokens: UsageTokenTotals; toolCalls: number }>()
  let updatedAt = 0
  for (const event of events) {
    if (event.seq < inheritedEventCount) continue
    if (event.time > updatedAt) updatedAt = event.time
    const day = dayKey(event.time, timezoneOffsetSeconds)
    const bucket = days.get(day) ?? { tokens: emptyTokens(), toolCalls: 0 }
    if (!days.has(day)) days.set(day, bucket)
    if (event.type === 'tool/call') {
      toolCalls.set(event.data.name, (toolCalls.get(event.data.name) ?? 0) + 1)
      bucket.toolCalls += 1
      continue
    }
  }
  for (const attempt of attempts ?? recorded) {
    const day = dayKey(attempt.time, timezoneOffsetSeconds)
    const bucket = days.get(day) ?? { tokens: emptyTokens(), toolCalls: 0 }
    days.set(day, bucket)
    const usage = attemptTokens(attempt)
    addTokens(tokens, usage)
    addTokens(bucket.tokens, usage)
    const provider = attempt.route?.provider ?? 'unknown'
    const model = attempt.route?.model ?? 'unknown'
    const key = JSON.stringify([provider, model])
    const row = models.get(key) ?? { provider, model, tokens: emptyTokens() }
    models.set(key, row)
    addTokens(row.tokens, usage)
  }
  return { sessionId, title, tokens, sessionTokens, updatedAt, toolCalls, models, days }
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
  const modelMap = new Map<string, UsageModelRow>()
  const toolMap = new Map<string, number>()
  const sessionRows: UsageSessionRow[] = []
  for (const session of sessions) {
    addTokens(totals, session.tokens)
    sessionRows.push({
      sessionId: session.sessionId,
      title: session.title,
      tokens: session.sessionTokens,
      updatedAt: session.updatedAt,
    })
    for (const [name, count] of session.toolCalls) {
      toolCalls += count
      toolMap.set(name, (toolMap.get(name) ?? 0) + count)
    }
    for (const [key, row] of session.models) {
      const previous = modelMap.get(key) ?? { provider: row.provider, model: row.model, tokens: emptyTokens() }
      modelMap.set(key, previous)
      addTokens(previous.tokens, row.tokens)
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
  const recents = sessionRows.filter(row => totalOf(row.tokens) > 0 || row.tokens.incomplete)
  const days = [...dayMap.values()].sort((left, right) => left.day.localeCompare(right.day))
  const models: UsageModelRow[] = [...modelMap.values()]
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

function attemptTokens(attempt: RecordedUsageAttempt): UsageTokenTotals {
  return attempt.usage === undefined
    ? { ...emptyTokens(), incomplete: true, cacheReadUnknown: true, cacheWriteUnknown: true }
    : {
      ...tokensOf(attempt.usage), totalTokens: attempt.usage.totalTokens,
      ...(attempt.usage.incomplete ? { incomplete: true } : {}),
      ...(attempt.usage.cacheReadTokens === undefined ? { cacheReadUnknown: true } : {}),
      ...(attempt.usage.cacheWriteTokens === undefined ? { cacheWriteUnknown: true } : {}),
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
  return tokens.totalTokens ?? tokens.uncachedInputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens + tokens.outputTokens
}
