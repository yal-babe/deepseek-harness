/** Stable personal-sync categories; provider credentials are distinct from ordinary plugin data. */
import { z } from 'zod'
import type { StudioSyncCategory } from './types.ts'

/** Categories explicitly selectable for upload. */
export const syncCategorySchema = z.enum(['profile', 'settings', 'projects', 'conversations', 'plugins', 'deepseek', 'codex', 'antigravity', 'api-keys'])
/** Resolve a versioned object to its owning upload category.
 * @param value - object kind and registered namespace.
 * @returns category controlling upload consent.
 */
export function syncCategory(value: { kind: string; namespace: string | null }): StudioSyncCategory {
  const credential = value.namespace?.replace(/^studio\.credentials\./, '')
  if (value.namespace?.startsWith('studio.credentials.') &&
    (credential === 'deepseek' || credential === 'codex' || credential === 'antigravity' || credential === 'api-keys')) return credential
  switch (value.kind) {
    case 'profile': return 'profile'
    case 'preference': return 'settings'
    case 'project': return 'projects'
    case 'conversation': return 'conversations'
    default: return 'plugins'
  }
}
