/** Source-position attribution for recorded usage copied by Session forks. */
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { collectRecordedUsage, type RecordedUsageAttempt } from './recorded-usage.ts'

/** Contiguous source range ending at an exclusive logical event offset. Null denotes unavailable ancestry. */
export interface UsageSourceRange {
  readonly end: number
  readonly sessionId: string | null
}

/** A source Session and its exact fork prefix; ranges can preserve absent ancestors. */
export interface UsageSourceLog {
  readonly sessionId: string
  readonly parentSessionId: string | null
  readonly inheritedEventCount: number
  readonly events: readonly SessionEvent[]
  readonly sourceRanges?: readonly UsageSourceRange[]
}

/** Unique request attributed to its original Session and copied logical position. */
export interface AttributedUsageAttempt {
  readonly sourceSessionId: string
  readonly observedSessionId: string
  readonly attempt: RecordedUsageAttempt
}

/** Deduplicated known requests, with an explicit indication of unavailable source attribution. */
export interface AttributedUsage {
  readonly attempts: readonly AttributedUsageAttempt[]
  readonly incomplete: boolean
}

/**
 * Resolve source ranges using declared ancestry, never event contents or timestamps.
 * Unavailable multi-generation ancestry remains unknown rather than guessing an identity.
 * @param log - source whose entire available logical log is attributed.
 * @param logs - observations keyed by original Session id.
 * @returns contiguous source ranges covering the available events.
 */
export function resolveUsageSources(log: UsageSourceLog, logs: ReadonlyMap<string, UsageSourceLog>): readonly UsageSourceRange[] {
  const resolve = (current: UsageSourceLog, visiting: ReadonlySet<string>): readonly UsageSourceRange[] => {
    const end = (current.events.at(-1)?.seq ?? -1) + 1
    if (current.sourceRanges !== undefined) return current.sourceRanges
    if (visiting.has(current.sessionId)) return [{ end, sessionId: null }]
    const inherited = Math.min(current.inheritedEventCount, end)
    const ranges: UsageSourceRange[] = []
    if (inherited > 0) {
      const parent = current.parentSessionId === null ? undefined : logs.get(current.parentSessionId)
      if (parent !== undefined) {
        const next = new Set(visiting).add(current.sessionId)
        for (const range of resolve(parent, next)) {
          if ((ranges.at(-1)?.end ?? 0) >= inherited) break
          ranges.push({ end: Math.min(range.end, inherited), sessionId: range.sessionId })
        }
        if ((ranges.at(-1)?.end ?? 0) < inherited) ranges.push({ end: inherited, sessionId: null })
      } else {
        ranges.push({ end: inherited, sessionId: null })
      }
    }
    if (inherited < end) ranges.push({ end, sessionId: current.sessionId })
    return ranges
  }
  return resolve(log, new Set())
}

/**
 * Deduplicate copied attempts by original Session id and the first settlement seq.
 * A later replacement sample supersedes a shorter observation of the same request.
 * @param logs - complete or prefix observations, with optional persisted source ranges.
 * @returns known unique requests; unknown ancestry is excluded and labeled incomplete.
 */
export function attributeRecordedUsage(logs: readonly UsageSourceLog[]): AttributedUsage {
  const byId = new Map<string, UsageSourceLog>()
  for (const log of logs) {
    if ((byId.get(log.sessionId)?.events.length ?? -1) < log.events.length) byId.set(log.sessionId, log)
  }
  const unique = new Map<string, AttributedUsageAttempt>()
  const conflicts = new Set<string>()
  let incomplete = false
  for (const log of logs) {
    const ranges = resolveUsageSources(log, byId)
    for (const attempt of collectRecordedUsage(log.events)) {
      const source = ranges.find(range => attempt.seq < range.end)?.sessionId
      if (source === null || source === undefined) {
        incomplete = true
        continue
      }
      const key = JSON.stringify([source, attempt.seq])
      if (conflicts.has(key)) continue
      const previous = unique.get(key)
      if (previous !== undefined && previous.attempt.settledSeq === attempt.settledSeq
        && JSON.stringify(previous.attempt.usage) !== JSON.stringify(attempt.usage)) {
        unique.delete(key)
        conflicts.add(key)
        incomplete = true
        continue
      }
      const preferOwner = log.sessionId === source
        || (previous?.observedSessionId !== source && log.sessionId < (previous?.observedSessionId ?? log.sessionId))
      if (previous === undefined || previous.attempt.settledSeq < attempt.settledSeq
        || (previous.attempt.settledSeq === attempt.settledSeq && preferOwner)) {
        unique.set(key, { sourceSessionId: source, observedSessionId: log.sessionId, attempt })
      }
    }
  }
  return { attempts: [...unique.values()], incomplete }
}
