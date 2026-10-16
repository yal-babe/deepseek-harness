/** Browser-safe Studio state. Model-provider identities are independent of this account. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-typert-protocol'

/** Stable identity assigned by one Studio server. */
export type StudioUserId = Branded<'StudioUserId'>
/** Cloud object identity scoped to one Studio user and server origin. */
export type StudioObjectId = Branded<'StudioObjectId'>
/** A signed-in Studio user, without device credentials. */
export interface StudioIdentity {
  id: StudioUserId
  username: string
  email: string | null
  displayName: string
  mustChangePassword: boolean
}
/** Connection and sync readiness returned to the renderer. */
export interface StudioState {
  origin: string
  identity: StudioIdentity | null
  phase: 'signed-out' | 'preview-required' | 'ready' | 'paused' | 'conflict' | 'reauth-required' | 'unsupported'
  usedBytes: number | null
  quotaBytes: number | null
  pending: number
}
/** One device that can be explicitly revoked. */
export interface StudioDevice {
  id: string
  deviceName: string
  current: boolean
  lastSeen: string
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Studio operation failed; a stable server or local code selects localized recovery. */
    'studio-cloud/failed': { code: string }
  }
}

/** Local and cloud values retained for explicit first-sync and conflict choices. */
export interface StudioPreviewRow {
  id: string
  kind: string
  namespace: string | null
  local: string | null
  cloud: string | null
  version: number
  conflict: boolean
  supported: boolean
}

/** A downloaded immutable history and its local restoration requirements. */
export interface StudioHistoryItem {
  id: string
  version: number
  title: string
  sourceSessionId: string
  throughSeq: number
  missing: { name: string; code: string }[]
}
/** Canonical projected messages for read-only cloud history. */
export interface StudioHistoryView extends StudioHistoryItem {
  messages: { id: string; role: string; content: string }[]
}

/** Deduplicated token activity calculated across synced sessions and branches. */
export interface StudioTokenActivity {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  reasoningTokens: number
  turnsCount: number
  sessionsCount: number
}

/** Restored plugin record for user review before local installation. */
export interface StudioRestoredPlugin {
  moduleName: string
  enabled: boolean
  version?: string
  installed: boolean
}

/** Project binding state for UI presentation. */
export interface StudioProjectBinding {
  id: string
  title: string
  localId: string | null
}

/** Result of continuing a downloaded history into a local branch session. */
export interface StudioContinuationResult {
  sessionId: string
}

/** Minimal projection of host plugin inventory. */
export interface PluginInventoryLike {
  list(): Promise<{
    entries: {
      moduleName: string
      enabled: boolean
      meta?: { version?: string }
    }[]
  }>
}
