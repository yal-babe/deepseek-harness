/**
 * Wire-safe OAuth attempt projection for UI consumers. Notices and prompts never
 * carry secrets; only the human-visible copy, destination URL, and prompt fields
 * travel here.
 * @module @deepseek-ai/dsh-llm-oauth-bridge/types
 */

/** Lifecycle of one UI-driven authorization attempt. */
export type OAuthAttemptStatus =
  | 'idle'
  | 'waiting-browser'
  | 'prompting'
  | 'authorized'
  | 'failed'
  | 'cancelled'

/** One choice offered by a `select` prompt, as the UI renders it. */
export interface OAuthPromptOptionView {
  /** Value returned when this option is chosen. */
  readonly id: string
  /** User-facing label. */
  readonly label: string
  /** Optional extra context rendered by capable surfaces. */
  readonly description?: string
}

/**
 * A question the running flow cannot answer for itself. `secret` differs from
 * `text` only in presentation; `select` answers with the chosen option's `id`.
 * The flow's own prompt `AbortSignal` is not serialized.
 */
export type OAuthPromptView = {
  /** What the human must type or pick. */
  readonly message: string
} & ({
  readonly kind: 'text' | 'secret'
  readonly placeholder?: string
} | {
  readonly kind: 'select'
  readonly options: readonly OAuthPromptOptionView[]
})

/** Safe snapshot of one credential's authorization attempt. */
export interface OAuthAttemptView {
  /** Current attempt lifecycle. */
  readonly status: OAuthAttemptStatus
  /** Page the human must open; present after a notice that carried a URL. */
  readonly authorizeUrl?: string
  /** Latest notice or prompt copy. */
  readonly message?: string
  /** Failure copy when `status` is `failed`. */
  readonly error?: string
  /** Device-code or similar short value from the latest notice. */
  readonly code?: string
  /** Pending question when `status` is `prompting`. */
  readonly prompt?: OAuthPromptView
  /** Whether an authorization attempt is running for this key. */
  readonly inFlight: boolean
  /** Whether the credential record is stored. */
  readonly credentialConfigured: boolean
}
