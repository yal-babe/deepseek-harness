/** Recorded token activity deduplicated by original Session and request position. */
import { attributeRecordedUsage, type UsageSourceLog } from '@deepseek-ai/dsh-token-meter'
import type { StudioTokenActivity } from './types.ts'

/**
 * Aggregate known request usage across synchronized histories and fork prefixes.
 * @param sessions - original source identities, exact inherited prefixes, and optional source ranges.
 * @returns known totals with missing provider usage or ancestry explicitly labeled incomplete.
 */
export function calculateTokenActivity(sessions: readonly UsageSourceLog[]): StudioTokenActivity {
  const attributed = attributeRecordedUsage(sessions)
  const turns = new Set<string>()
  let totalTokens = 0
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let reasoningTokens = 0
  let incomplete = attributed.incomplete
  let cacheReadUnknown = false
  let cacheWriteUnknown = false
  let reasoningUnknown = false
  for (const { sourceSessionId, attempt } of attributed.attempts) {
    const usage = attempt.usage
    if (usage === undefined) {
      incomplete = true
      cacheReadUnknown = cacheWriteUnknown = reasoningUnknown = true
      continue
    }
    turns.add(JSON.stringify([sourceSessionId, attempt.turn]))
    totalTokens += usage.totalTokens
    inputTokens += usage.inputTokens
    outputTokens += usage.outputTokens
    cacheReadTokens += usage.cacheReadTokens ?? 0
    cacheWriteTokens += usage.cacheWriteTokens ?? 0
    reasoningTokens += usage.reasoningTokens ?? 0
    incomplete ||= usage.incomplete === true
    cacheReadUnknown ||= usage.cacheReadTokens === undefined
    cacheWriteUnknown ||= usage.cacheWriteTokens === undefined
    reasoningUnknown ||= usage.reasoningTokens === undefined
  }
  return {
    totalTokens, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens,
    turnsCount: turns.size, sessionsCount: new Set(sessions.map(log => log.sessionId)).size,
    ...(incomplete ? { incomplete: true } : {}),
    ...(cacheReadUnknown ? { cacheReadUnknown: true } : {}),
    ...(cacheWriteUnknown ? { cacheWriteUnknown: true } : {}),
    ...(reasoningUnknown ? { reasoningUnknown: true } : {}),
  }
}
