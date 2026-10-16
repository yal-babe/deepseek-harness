/** Codex token refresh retaining identity claims omitted by the adapter library. */
import type { OAuthCredential } from '@earendil-works/pi-ai'
import { LlmError } from '@deepseek-ai/dsh-llm'

/**
 * Refresh a grant and retain the ID token used for subscription metadata.
 * @param credential - current stored Codex OAuth grant.
 * @param signal - caller's request deadline.
 * @returns replacement credential; callers must commit it under the credential-store lock.
 */
export async function refreshCodexIdentity(credential: OAuthCredential, signal: AbortSignal): Promise<OAuthCredential> {
  const response = await fetch('https://auth.openai.com/oauth/token', {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token', refresh_token: credential.refresh,
      client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
    }),
  })
  if (!response.ok) throw new LlmError('Codex subscription authentication could not be refreshed', 'AUTH')
  const raw: unknown = await response.json()
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new LlmError('Codex token response is invalid', 'PROTOCOL')
  }
  const data = raw as Record<string, unknown>
  if (typeof data.access_token !== 'string' || data.access_token.length === 0
    || typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0
    || (data.refresh_token !== undefined && (typeof data.refresh_token !== 'string' || data.refresh_token.length === 0))
    || (data.id_token !== undefined && (typeof data.id_token !== 'string' || data.id_token.length === 0))) {
    throw new LlmError('Codex token response is missing required fields', 'PROTOCOL')
  }
  return {
    ...credential,
    access: data.access_token,
    refresh: typeof data.refresh_token === 'string' ? data.refresh_token : credential.refresh,
    expires: Date.now() + data.expires_in * 1000,
    subscriptionMetadataChecked: true,
    ...typeof data.id_token === 'string' ? { id_token: data.id_token } : {},
  }
}
