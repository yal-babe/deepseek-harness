import { describe, expect, it } from 'vitest'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { TimeoutReason } from '@deepseek-ai/dsh-timeout'
import { asObject, oauthHttpError, providerHttpError, transportError } from '../src/errors.ts'

describe('error mapping', () => {
  it('reads retry-after and request-id from provider HTTP errors', () => {
    const error = providerHttpError(
      429,
      { error: { message: 'slow', type: 'rate_limit_error' } },
      'slow',
      new Headers({ 'retry-after': '2', 'x-request-id': 'req-1' }),
    )
    expect(error).toMatchObject({
      code: 'RATE_LIMIT',
      failure: { status: 429, providerRetryAfterMs: 2000, requestId: 'req-1' },
    })
  })

  it('classifies quota, auth-type, and HTTP-date retry-after', () => {
    expect(providerHttpError(200, { error: { message: 'quota exceeded', code: 'insufficient_quota' } }, 'x').code).toBe('QUOTA')
    expect(providerHttpError(401, { error: { type: 'authentication_error', message: 'no' } }, 'x').code).toBe('AUTH')
    const later = new Date(Date.now() + 5_000).toUTCString()
    const error = providerHttpError(429, { error: { message: 'wait' } }, 'x', new Headers({ 'retry-after': later }))
    expect(error.failure.providerRetryAfterMs).toBeGreaterThan(0)
  })

  it('maps oauth status-less failures to NETWORK', () => {
    expect(oauthHttpError(undefined, 'offline').code).toBe('NETWORK')
  })

  it('passes LlmError through and maps timeout or abort reasons', () => {
    const original = new LlmError('kept', 'PROTOCOL')
    const signal = AbortSignal.abort('nope')
    expect(transportError(original, signal, 'IDLE', 'REQ')).toBe(original)
    const idle = AbortSignal.abort(new TimeoutReason('IDLE', 10))
    expect(transportError(new Error('x'), idle, 'IDLE', 'REQ').code).toBe('TIMEOUT')
    const request = AbortSignal.abort(new TimeoutReason('REQ', 10))
    expect(transportError(new Error('x'), request, 'IDLE', 'REQ').code).toBe('TIMEOUT')
    const aborted = new AbortController()
    aborted.abort()
    expect(transportError(new Error('x'), aborted.signal, 'IDLE', 'REQ').code).toBe('ABORTED')
    expect(transportError({ reason: new TimeoutReason('IDLE', 10) }, new AbortController().signal, 'IDLE', 'REQ').code)
      .toBe('TIMEOUT')
    expect(transportError({ reason: new TimeoutReason('REQ', 10) }, new AbortController().signal, 'IDLE', 'REQ').code)
      .toBe('TIMEOUT')
    expect(transportError('offline', new AbortController().signal, 'IDLE', 'REQ').code).toBe('NETWORK')
  })

  it('rejects non-objects in asObject', () => {
    expect(asObject(null)).toBeUndefined()
    expect(asObject([])).toBeUndefined()
    expect(asObject({ a: 1 })).toEqual({ a: 1 })
  })
})
