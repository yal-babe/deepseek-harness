import { afterEach, describe, expect, it, vi } from 'vitest'
import { Config, resolvedConfig } from '../src/config.ts'
import {
  ANTIGRAVITY_QUOTA_URLS,
  fetchAntigravityQuota,
  fetchAntigravityQuotaForToken,
  unsignedAntigravityQuota,
} from '../src/quota.ts'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const connection = resolvedConfig(Config({}))
afterEach(() => { vi.unstubAllGlobals() })

describe('fetchAntigravityQuota', () => {
  it('falls back to the next quota URL and maps paidTier', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const href = String(input)
      if (href === ANTIGRAVITY_QUOTA_URLS[0]) return jsonResponse({}, 500)
      if (href.includes('retrieveUserQuotaSummary')) {
        return jsonResponse({
          quotaGroups: [{
            id: 'gemini',
            displayName: 'Gemini',
            buckets: [
              { id: 'weekly', remainingFraction: 40, resetTime: '2026-10-20T00:00:00.000Z' },
              { type: 'five-hour', remaining_fraction: 0.2 },
            ],
          }],
        })
      }
      if (href.includes('loadCodeAssist')) {
        return jsonResponse({ paidTier: { id: 'g1-pro-tier' }, currentTier: { id: 'free-tier' } })
      }
      return jsonResponse({}, 404)
    })
    const snapshot = await fetchAntigravityQuota(connection, 'tok', 'proj', undefined, fetchImpl as typeof fetch)
    expect(snapshot.status).toBe('ready')
    expect(snapshot.plan).toBe('pro')
    expect(snapshot.groups[0]?.buckets.map(bucket => bucket.id)).toEqual(['5h', 'weekly'])
    expect(snapshot.groups[0]?.buckets[1]?.remainingFraction).toBe(0.4)
  })

  it('returns unsigned when Assist reports AUTH', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { code: 401, message: 'denied' } }, 401))
    const snapshot = await fetchAntigravityQuota(connection, 'tok', 'proj', undefined, fetchImpl as typeof fetch)
    expect(snapshot.status).toBe('unsigned')
  })
})

describe('fetchAntigravityQuotaForToken', () => {
  it('loads quota after Cloud Code returns a project', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const href = String(input)
      if (href.includes('loadCodeAssist')) return jsonResponse({ cloudaicompanionProject: 'proj' })
      if (href.includes('retrieveUserQuotaSummary')) {
        return jsonResponse({ quotaGroups: [{ id: 'g', buckets: [{ id: '5h', remainingFraction: 1 }] }] })
      }
      return jsonResponse({})
    }))
    const snapshot = await fetchAntigravityQuotaForToken(connection, 'tok', AbortSignal.timeout(5_000))
    expect(snapshot.status).toBe('ready')
    expect(snapshot.groups).toHaveLength(1)
  })

  it('fails when Cloud Code omits a project', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    const snapshot = await fetchAntigravityQuotaForToken(connection, 'tok')
    expect(snapshot.status).toBe('failed')
    expect(snapshot.error).toBe('Cloud Code project is unavailable')
  })

  it('returns the unsigned empty snapshot helper', () => {
    expect(unsignedAntigravityQuota()).toEqual({ status: 'unsigned', plan: null, tierId: null, groups: [] })
  })

  it('keeps a ready card when Assist is unavailable', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const href = String(input)
      if (href.includes('retrieveUserQuotaSummary')) {
        return jsonResponse({ quotaGroups: [{ id: 'g', buckets: [{ id: '5h', remainingFraction: 1 }] }] })
      }
      throw new Error('assist down')
    })
    const snapshot = await fetchAntigravityQuota(connection, 'tok', 'proj', undefined, fetchImpl as typeof fetch)
    expect(snapshot.status).toBe('ready')
    expect(snapshot.plan).toBeNull()
  })

  it('throws AUTH from the first quota URL without falling back', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { code: 401 } }, 401))
    await expect(fetchAntigravityQuota(connection, 'tok', 'proj', undefined, fetchImpl as typeof fetch))
      .resolves.toMatchObject({ status: 'unsigned' })
  })

  it('rejects invalid JSON listings and empty error codes', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const href = String(input)
      if (href.includes('retrieveUserQuotaSummary')) return new Response('not-json', { status: 200 })
      return jsonResponse({})
    })
    await expect(fetchAntigravityQuota(connection, 'tok', 'proj', undefined, fetchImpl as typeof fetch))
      .rejects.toThrow()
    const failedHttp = vi.fn(async () => new Response('not-json', { status: 502 }))
    await expect(fetchAntigravityQuota(connection, 'tok', 'proj', undefined, failedHttp as typeof fetch))
      .rejects.toThrow()
  })

  it('treats for-token AUTH as unsigned and other failures as failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 401 } }, 401)))
    expect((await fetchAntigravityQuotaForToken(connection, 'tok')).status).toBe('unsigned')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect((await fetchAntigravityQuotaForToken(connection, 'tok')).status).toBe('failed')
    vi.stubGlobal('fetch', vi.fn(async () => { throw 'down' }))
    expect((await fetchAntigravityQuotaForToken(connection, 'tok')).status).toBe('failed')
  })

  it('prepends a custom Cloud Code origin and accepts empty JSON bodies', async () => {
    const custom = resolvedConfig(Config({ baseURL: 'https://example.test/v1' }))
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const href = String(input)
      if (href.startsWith('https://example.test/')) return new Response('', { status: 200 })
      if (href.includes('loadCodeAssist')) return jsonResponse({ error: { message: 'nope' } })
      return jsonResponse({}, 404)
    })
    const snapshot = await fetchAntigravityQuota(custom, 'tok', 'proj', AbortSignal.timeout(5_000), fetchImpl as typeof fetch)
    expect(snapshot.status).toBe('ready')
  })

  it('maps an RPC error on an HTTP 200 listing', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const href = String(input)
      if (href.includes('retrieveUserQuotaSummary')) return jsonResponse({ error: { code: 400, message: 'nope' } })
      return jsonResponse({})
    })
    await expect(fetchAntigravityQuota(connection, 'tok', 'proj', undefined, fetchImpl as typeof fetch)).rejects.toThrow()
    const untyped = vi.fn(async (input: RequestInfo | URL) => {
      const href = String(input)
      if (href.includes('retrieveUserQuotaSummary')) return jsonResponse({ error: { message: 'nope' } })
      return jsonResponse({})
    })
    await expect(fetchAntigravityQuota(connection, 'tok', 'proj', undefined, untyped as typeof fetch)).rejects.toThrow()
    const nonError = vi.fn(async () => { throw 42 })
    await expect(fetchAntigravityQuota(connection, 'tok', 'proj', undefined, nonError as typeof fetch)).rejects.toThrow()
  })
})
