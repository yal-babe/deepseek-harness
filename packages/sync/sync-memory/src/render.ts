/**
 * Model-visible project-memory prose. The README quotes this renderer verbatim.
 * @module @deepseek-ai/dsh-sync-memory/render
 */

import type { MemoryRecord } from '@deepseek-ai/dsh-sync-protocol'

/**
 * Render admitted project-memory records as one snapshot body.
 * @param records - already-redacted live records, in display order.
 * @returns model-visible text, or an empty string when nothing is admitted.
 */
export function renderMemoryContext(records: readonly MemoryRecord[]): string {
  if (records.length === 0) return ''
  const lines = records.map(record => `- (${record.kind}) ${record.text}`)
  return `Relevant project memory:\n${lines.join('\n')}`
}
