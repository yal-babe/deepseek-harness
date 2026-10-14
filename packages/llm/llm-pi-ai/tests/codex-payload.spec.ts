import { describe, expect, it } from 'vitest'
import { CODEX_INSTRUCTIONS, rewriteCodexPayload } from '../src/codex-payload.ts'

describe('Codex request rewrite', () => {
  it.each([null, 1, 'x', [], true])('passes through a non-object payload: %j', (payload) => {
    expect(rewriteCodexPayload(payload)).toBe(payload)
  })

  it('leaves the short default instructions and GPT-5 verbosity in place', () => {
    const payload = {
      model: 'gpt-5.5',
      instructions: CODEX_INSTRUCTIONS,
      input: [{ role: 'user', content: 'hi' }],
      text: { verbosity: 'low' },
    }
    expect(rewriteCodexPayload(payload)).toBe(payload)
  })

  it('moves a harness system prompt into input as a developer message', () => {
    expect(rewriteCodexPayload({
      model: 'gpt-5.5',
      instructions: 'Harness system prompt',
      input: [{ role: 'user', content: 'hi' }],
      text: { verbosity: 'low' },
    })).toEqual({
      model: 'gpt-5.5',
      instructions: CODEX_INSTRUCTIONS,
      input: [
        { role: 'developer', content: 'Harness system prompt' },
        { role: 'user', content: 'hi' },
      ],
      text: { verbosity: 'low' },
    })
  })

  it('drops GPT-6 text.verbosity and treats a missing input list as empty', () => {
    expect(rewriteCodexPayload({
      model: 'gpt-6-luna',
      instructions: 'Harness system prompt',
      text: { verbosity: 'low' },
    })).toEqual({
      model: 'gpt-6-luna',
      instructions: CODEX_INSTRUCTIONS,
      input: [{ role: 'developer', content: 'Harness system prompt' }],
    })
  })

  it('drops GPT-6 text.verbosity when instructions are already the short default', () => {
    expect(rewriteCodexPayload({
      model: 'gpt-6.1-sol',
      instructions: CODEX_INSTRUCTIONS,
      input: [{ role: 'user', content: 'hi' }],
      text: { verbosity: 'low' },
    })).toEqual({
      model: 'gpt-6.1-sol',
      instructions: CODEX_INSTRUCTIONS,
      input: [{ role: 'user', content: 'hi' }],
    })
  })

  it('leaves an object without string instructions or model unchanged', () => {
    const payload = { input: [{ role: 'user', content: 'hi' }], text: { verbosity: 'low' } }
    expect(rewriteCodexPayload(payload)).toBe(payload)
  })
})
