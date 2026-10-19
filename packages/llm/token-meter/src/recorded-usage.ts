/** Provider-neutral accounting of durable request attempts, including failed and retried calls. */
import { lastAssistantStreamChunk } from '@deepseek-ai/dsh-llm/assistant-stream'
import type { TokenUsage } from '@deepseek-ai/dsh-llm/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { normalizeUsage, type NormalizedAttempt, type TurnTokenUsageRoute } from './turn-usage.ts'

/** One durable request settlement; seq identifies its event within the source Session. */
export interface RecordedUsageAttempt {
  readonly seq: number
  /** Last replacement settlement used to select the most complete observation. */
  readonly settledSeq: number
  readonly time: number
  readonly turn: number
  readonly step: number
  readonly route?: TurnTokenUsageRoute
  /** Absent for missing or contradictory provider usage, never an inferred zero. */
  readonly usage?: NormalizedAttempt
}

/**
 * Read the authoritative usage of one durable Assistant settlement.
 * @param event - committed Session event.
 * @returns the final message usage or last embedded stream sample, when present.
 */
export function settlementUsage(event: SessionEvent): TokenUsage | undefined {
  if (event.type === 'assistant/message' && event.data.usage !== undefined) return event.data.usage
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined
  return lastAssistantStreamChunk(event.data.stream, 'usage')?.usage
}

/**
 * Collect durable request attempts without counting replacement settlements twice.
 * Retry-started separates calls within one step; missing usage remains explicit.
 * @param events - ordered committed logical Session events.
 * @returns one record per settled attempt in log order, including incomplete final turns.
 */
export function collectRecordedUsage(events: readonly SessionEvent[]): readonly RecordedUsageAttempt[] {
  const attempts: RecordedUsageAttempt[] = []
  let route: TurnTokenUsageRoute | undefined
  let replacement: { turn: number; step: number; index: number } | undefined
  for (const event of events) {
    if (event.type === 'request/context') {
      route = { provider: event.data.provider, model: event.data.model }
    } else if (event.type === 'llm/retry-started' || event.type === 'turn/start' || event.type === 'step/start') {
      replacement = undefined
    } else if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
      const { turn, step } = event.data
      const previous = replacement?.turn === turn && replacement.step === step ? replacement.index : undefined
      const sample = settlementUsage(event)
      if (sample === undefined && previous !== undefined) continue
      const source = event.type === 'assistant/message' ? event.data.message.source : undefined
      const attribution = source !== undefined && source.provider.length > 0 && source.model.length > 0
        ? { provider: source.provider, model: source.model } : route
      const usage = sample === undefined ? undefined : normalizeUsage(sample, attribution)
      const record: RecordedUsageAttempt = {
        seq: (previous === undefined ? undefined : attempts[previous]?.seq) ?? event.seq,
        settledSeq: event.seq, time: event.time, turn, step,
        ...(attribution === undefined ? {} : { route: attribution }),
        ...(usage === undefined ? {} : { usage }),
      }
      if (previous === undefined) attempts.push(record)
      else attempts[previous] = record
      replacement = { turn, step, index: previous ?? attempts.length - 1 }
    }
  }
  return attempts
}
