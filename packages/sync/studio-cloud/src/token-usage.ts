/** Deduplicated token activity calculation across synchronized sessions and branches. */
import { createHash } from 'node:crypto'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { StudioTokenActivity } from './types.ts'

interface TurnTokens {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens: number
  reasoningTokens: number
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function extractTurnTokens(events: readonly SessionEvent[]): TurnTokens | undefined {
  let input = 0
  let output = 0
  let total = 0
  let cacheRead = 0
  let reasoning = 0
  let hasUsage = false

  for (const event of events) {
    if (event.type === 'assistant/message') {
      const usage = event.data.usage
      if (usage && isCount(usage.inputTokens) && isCount(usage.outputTokens)) {
        hasUsage = true
        input += usage.inputTokens
        output += usage.outputTokens
        total += isCount(usage.totalTokens) ? usage.totalTokens : usage.inputTokens + usage.outputTokens
        if (isCount(usage.cacheReadTokens)) cacheRead += usage.cacheReadTokens
        if (isCount(usage.reasoningTokens)) reasoning += usage.reasoningTokens
      }
    }
  }

  if (!hasUsage) return undefined
  return { inputTokens: input, outputTokens: output, totalTokens: total, cacheReadTokens: cacheRead, reasoningTokens: reasoning }
}

/**
 * Fold turn events across multiple sessions into deduplicated aggregate token metrics.
 * Inherited fork turns produce identical fingerprints and are counted exactly once.
 * @param sessionsEvents - complete contiguous event logs for each synchronized session.
 * @returns validated aggregate token counts and counts of evaluated turns/sessions.
 */
export function calculateTokenActivity(sessionsEvents: readonly (readonly SessionEvent[])[]): StudioTokenActivity {
  const seenTurns = new Set<string>()
  let totalTokens = 0
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let reasoningTokens = 0
  let turnsCount = 0
  let sessionsCount = 0

  for (const events of sessionsEvents) {
    sessionsCount++
    let currentTurn: SessionEvent[] = []
    let inTurn = false

    for (const event of events) {
      if (event.type === 'turn/start') {
        inTurn = true
        currentTurn = [event]
      } else if (inTurn) {
        currentTurn.push(event)
        if (event.type === 'turn/end') {
          inTurn = false
          const fingerprint = createHash('sha256')
            .update(JSON.stringify(currentTurn.map(e => [e.type, e.time, e.data])))
            .digest('hex')

          if (!seenTurns.has(fingerprint)) {
            seenTurns.add(fingerprint)
            const turnUsage = extractTurnTokens(currentTurn)
            if (turnUsage !== undefined) {
              turnsCount++
              totalTokens += turnUsage.totalTokens
              inputTokens += turnUsage.inputTokens
              outputTokens += turnUsage.outputTokens
              cacheReadTokens += turnUsage.cacheReadTokens
              reasoningTokens += turnUsage.reasoningTokens
            }
          }
        }
      }
    }
  }

  return {
    totalTokens,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    reasoningTokens,
    turnsCount,
    sessionsCount,
  }
}
