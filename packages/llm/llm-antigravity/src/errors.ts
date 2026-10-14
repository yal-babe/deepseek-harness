/** Map HTTP status, provider payloads, and transport failures to LlmError codes. */

import {
  isContextWindowExceededError,
  isQuotaExceededError,
  LlmError,
  ProviderRequestId,
  QUOTA_EXCEEDED_CODE,
} from '@deepseek-ai/dsh-llm'
import { timeoutOf } from '@deepseek-ai/dsh-timeout'

/** Read a JSON object from an unknown payload. @param value - decoded JSON. @returns the object, or undefined. */
export function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * Classify a non-OK Cloud Code response.
 * @param status - HTTP status.
 * @param raw - decoded JSON body, when parseable.
 * @param text - raw response body for the cause.
 * @param headers - response headers for retry delay and request identity.
 * @returns a thrown-ready LlmError with AUTH, QUOTA, RATE_LIMIT, or PROTOCOL.
 */
export function providerHttpError(
  status: number,
  raw: unknown,
  text: string,
  headers?: Headers,
): LlmError {
  const envelope = asObject(raw) ?? {}
  const error = asObject(envelope.error) ?? envelope
  const message = typeof error.message === 'string' && error.message.length > 0
    ? error.message
    : `Antigravity Cloud Code request failed (${String(status)})`
  const type = typeof error.type === 'string' ? error.type : ''
  const codeField = typeof error.code === 'string' ? error.code : ''
  const detail = `${type} ${codeField} ${message}`
  let code: string
  if (status === 401 || status === 403 || /auth/i.test(type) || /auth/i.test(codeField)) code = 'AUTH'
  else if (isQuotaExceededError(detail) || status === 402) code = QUOTA_EXCEEDED_CODE
  else if (status === 429 || /rate.?limit/i.test(type) || /rate.?limit/i.test(codeField)) code = 'RATE_LIMIT'
  else if (isContextWindowExceededError(detail)) code = 'CONTEXT_WINDOW_EXCEEDED'
  else if (status === 400 || status === 413 || /invalid.?request/i.test(type)) code = 'INVALID_REQUEST'
  else if (status >= 500) code = 'NETWORK'
  else code = 'PROTOCOL'
  const retry = headers?.get('retry-after')
  const delay = retry == null
    ? Number.NaN
    : /^\d+(?:\.\d+)?$/u.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()
  const id = headers?.get('request-id') ?? headers?.get('x-request-id')
  return new LlmError(message, code, {
    status,
    cause: new Error(text),
    ...id ? { requestId: ProviderRequestId(id) } : {},
    ...Number.isFinite(delay) && delay > 0 ? { providerRetryAfterMs: delay } : {},
  })
}

/**
 * Classify a failed fetch or a stream that died on the socket.
 * @param error - the thrown value.
 * @param signal - the fused request signal (caller, timeout, idle).
 * @param idleCode - idle-watchdog timeout code, when this call is a stream.
 * @param requestCode - request-deadline timeout code.
 * @returns AUTH is never produced here; ABORTED, TIMEOUT, or NETWORK.
 */
export function transportError(
  error: unknown,
  signal: AbortSignal,
  idleCode: string,
  requestCode: string,
): LlmError {
  if (error instanceof LlmError) return error
  const carrier = abortReasonCarrier(error)
  if (timeoutOf(signal, idleCode) !== undefined || (carrier !== undefined && timeoutOf(carrier, idleCode) !== undefined)) {
    return new LlmError('Antigravity Cloud Code stream idle timeout', 'TIMEOUT', { cause: error })
  }
  if (timeoutOf(signal, requestCode) !== undefined || (carrier !== undefined && timeoutOf(carrier, requestCode) !== undefined)) {
    return new LlmError('Antigravity Cloud Code request timeout', 'TIMEOUT', { cause: error })
  }
  if (signal.aborted) {
    return new LlmError('Antigravity Cloud Code request aborted', 'ABORTED', { cause: error })
  }
  return new LlmError('Antigravity Cloud Code network failure', 'NETWORK', { cause: error })
}

/**
 * Classify a token-endpoint failure.
 * @param status - HTTP status when a response arrived.
 * @param text - response body or thrown-error message.
 * @returns AUTH for rejected grants, NETWORK for transport, PROTOCOL otherwise.
 */
export function oauthHttpError(status: number | undefined, text: string): LlmError {
  if (status === 401 || status === 403) {
    return new LlmError('Antigravity OAuth rejected the grant', 'AUTH', { status })
  }
  if (status === 429) {
    return new LlmError('Antigravity OAuth rate-limited the token request', 'RATE_LIMIT', { status })
  }
  if (status !== undefined && status >= 500) {
    return new LlmError('Antigravity OAuth token endpoint failed', 'NETWORK', { status })
  }
  if (status === undefined) {
    return new LlmError(`Antigravity OAuth token request failed: ${text}`, 'NETWORK')
  }
  return new LlmError(`Antigravity OAuth token request failed (${String(status)}): ${text}`, 'PROTOCOL', { status })
}

function abortReasonCarrier(value: unknown): { reason?: unknown } | undefined {
  return typeof value === 'object' && value !== null ? value : undefined
}
