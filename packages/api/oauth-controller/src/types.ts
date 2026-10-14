/**
 * Browser-safe OAuth Remote values contain no credential payloads.
 * @module @deepseek-ai/dsh-api-oauth-controller/types
 */

export type {
  OAuthAttemptStatus, OAuthAttemptView, OAuthPromptOptionView, OAuthPromptView,
} from '@deepseek-ai/dsh-llm-oauth-bridge/types'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /**
     * The Host refused an OAuth command: an invalid key, a missing prompt, or
     * an authorization-flow failure the caller should surface.
     */
    'oauth/rejected': { readonly key: string }
  }
}
