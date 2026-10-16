/**
 * Browser-safe Codex and Antigravity quota views. Tokens never ride this Remote.
 * @module @deepseek-ai/dsh-api-provider-quota/types
 */

import type {} from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** `get` received a provider id other than `codex` or `antigravity`. */
    'provider-quota/unknown-provider': { readonly provider: string }
  }
}

/** Quota provider id accepted by `providerQuota.get`. */
export type QuotaProviderId = 'codex' | 'antigravity'

/** One remaining-percent window on a quota card. */
export interface QuotaWindowView {
  /** Stable window id. */
  id: string
  /** Window kind for locale keys. */
  kind: 'fiveHour' | 'weekly' | 'monthly' | 'unknown' | '5h'
  /** WHAM group used to pick the window label. */
  group: 'standard' | 'codeReview' | 'additional'
  /** Additional metered feature name, or null. */
  featureName: string | null
  /** Remaining percent 0..100, or null. */
  remainingPercent: number | null
  /** Absolute reset instant. */
  resetAtMs: number | null
}

/** One model listed for the current Codex subscription. */
export interface CodexModelView {
  /** Wire slug. */
  id: string
  /** Display name when present. */
  name: string | null
}

/** One available Codex reset credit. */
export interface ResetCreditView {
  /** Opaque credit id. */
  id: string
  /** Absolute expiry, or null. */
  expiresAtMs: number | null
}

/** Safe Codex quota card. */
export interface CodexQuotaView {
  provider: 'codex'
  status: 'unsigned' | 'ready' | 'failed'
  planType: string | null
  subscriptionActiveUntilMs: number | null
  creditBalance: string | null
  creditsUnlimited: boolean
  windows: QuotaWindowView[]
  resetCredits: ResetCreditView[]
  resetCreditsAvailableCount: number | null
  models: CodexModelView[]
  /** Model listing failed separately from quota. */
  modelsError?: string
  /** Models come from the installed adapter catalog; subscription availability is unverified. */
  modelsFromCatalog?: boolean
  error?: string
}

/** One Antigravity quota group. */
export interface AntigravityQuotaGroupView {
  id: string
  label: string | null
  buckets: QuotaWindowView[]
}

/** Safe Antigravity quota card. */
export interface AntigravityQuotaView {
  provider: 'antigravity'
  status: 'unsigned' | 'ready' | 'failed'
  plan: 'free' | 'pro' | 'ultra' | 'ultra-lite' | 'unknown' | null
  tierId: string | null
  groups: AntigravityQuotaGroupView[]
  /** Live provider catalog, when queried. */
  models?: CodexModelView[]
  /** Model listing failed separately from quota. */
  modelsError?: string
  error?: string
}

/** Discriminated quota view. */
export type ProviderQuotaView = CodexQuotaView | AntigravityQuotaView

/** Result of redeeming one Codex reset credit. */
export interface ConsumeCodexResetResult {
  /** Whether WHAM reported `reset` or `already_redeemed`. */
  ok: boolean
  /** Latest usage snapshot; a failed redeem still returns the current card. */
  quota: CodexQuotaView
}
