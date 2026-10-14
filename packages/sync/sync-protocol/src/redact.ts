/**
 * Secret redaction for queued sync payloads and project-memory text.
 * @module @deepseek-ai/dsh-sync-protocol/redact
 */

const REDACTED = '[REDACTED]'

const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9_-]{8,}/g,
  /Bearer\s+\S+/gi,
  /(?:api[_-]?key|secret|token|password|passwd|authorization)\s*[:=]\s*['"]?[^\s'"]+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
]

/**
 * Replace credential-like substrings in one string with a stable marker.
 * @param text - untrusted text that may contain secrets.
 * @returns the same text with matched secrets replaced by `[REDACTED]`.
 */
export function redactSecrets(text: string): string {
  let result = text
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, REDACTED)
  }
  return result
}

/**
 * Recursively redact string leaves in a JSON-compatible value. Non-plain
 * objects (arrays, null, numbers, booleans) keep their structure.
 * @param value - JSON-compatible payload.
 * @returns a new value whose string leaves have been redacted.
 */
export function redactJsonValue(value: unknown): unknown {
  if (typeof value === 'string') return redactSecrets(value)
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(redactJsonValue)
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    result[key] = redactJsonValue(child)
  }
  return result
}
