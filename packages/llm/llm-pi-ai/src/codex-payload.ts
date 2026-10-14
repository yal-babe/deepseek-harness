/**
 * ChatGPT Codex request rewrite. The backend accepts a short `instructions`
 * field and rejects a harness system prompt there; that prompt belongs in the
 * Responses `input` list. GPT-6 also rejects the GPT-5 `text.verbosity` field.
 *
 * @module dsh-llm-pi-ai/codex-payload
 */

/** Short instructions string pi-ai already sends when no system prompt exists. */
export const CODEX_INSTRUCTIONS = 'You are a helpful assistant.'

/**
 * Move a harness system prompt out of Codex `instructions` and drop GPT-6
 * `text.verbosity`.
 * @param payload - pi-ai's Codex Responses JSON body.
 * @returns the rewritten body, or `payload` unchanged when it is not a Codex object.
 */
export function rewriteCodexPayload(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return payload
  const body: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) body[key] = value
  const instructions = typeof body.instructions === 'string' ? body.instructions : ''
  const model = typeof body.model === 'string' ? body.model : ''
  let changed = false
  if (instructions.length > 0 && instructions !== CODEX_INSTRUCTIONS) {
    const input = Array.isArray(body.input) ? [...body.input] : []
    body.instructions = CODEX_INSTRUCTIONS
    body.input = [{ role: 'developer', content: instructions }, ...input]
    changed = true
  }
  if (/^gpt-6/u.test(model) && 'text' in body) {
    delete body.text
    changed = true
  }
  return changed ? body : payload
}
