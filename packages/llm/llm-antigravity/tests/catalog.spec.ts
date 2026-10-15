import { afterEach, describe, expect, it, vi } from 'vitest'
import { Config, PROVIDER, resolvedConfig } from '../src/config.ts'
import {
  cloudCodeAssistOrigin,
  cloudCodeGenerateUrl,
  cloudCodeHeaders,
  cloudCodeOrigin,
  CLOUD_CODE_DAILY_ORIGIN,
  CLOUD_CODE_PROD_ORIGIN,
  extractProjectId,
  fetchAvailableModels,
  isSelectableDiscoveredModel,
  parseAvailableModels,
} from '../src/catalog.ts'
import { AntigravityAdapter } from '../src/adapter.ts'
import { closeMockServers, mockServer } from './mock-server.ts'

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await closeMockServers()
})

const listing = {
  models: {
    'gemini-3-flash': { displayName: 'Gemini 3 Flash', maxTokens: 1_048_576 },
    'gemini-2.5-pro': { displayName: 'Gemini 2.5 Pro' },
    'chat_gemini': { displayName: 'Chat Gemini' },
    'tab_complete': { displayName: 'Tab' },
    '': { displayName: 'empty id' },
    internal: { displayName: 'Hidden', isInternal: true },
    unnamed: {},
    exhausted: { displayName: 'Gone', quotaInfo: { isExhausted: true } },
    drained: { displayName: 'Drained', quotaInfo: { remainingFraction: 0 } },
    usable: { displayName: 'Usable', quotaInfo: { remainingFraction: 0.4 } },
    broken: { maxTokens: 1.5 },
    blank: { displayName: '' },
    zero: { maxTokens: 0 },
    primitive: 3,
  },
}

const assist = { json: { cloudaicompanionProject: 'proj-1' } }
const discovered = [
  { id: 'gemini-3-flash', name: 'Gemini 3 Flash', contextWindow: 1_048_576 },
  { id: 'unnamed', name: 'unnamed' },
  { id: 'usable', name: 'Usable' },
  { id: 'broken', name: 'broken' },
  { id: 'blank', name: 'blank' },
  { id: 'zero', name: 'zero' },
  { id: 'primitive', name: 'primitive' },
]

describe('Cloud Code catalog listing', () => {
  it('omits metadata.platform from Cloud Code identity', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('arm64')
    expect(cloudCodeHeaders('t')['user-agent']).toBe('antigravity/hub/2.9.1 windows/arm64')
    expect(JSON.parse(cloudCodeHeaders('t')['client-metadata'] ?? '{}')).toEqual({ ideType: 'ANTIGRAVITY' })
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    expect(cloudCodeHeaders('t')['user-agent']).toBe('antigravity/hub/2.9.1 linux/arm64')
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('x64')
    expect(cloudCodeHeaders('t')['user-agent']).toBe('antigravity/hub/2.9.1 darwin/amd64')
  })

  it('strips a trailing /v1 from the Cloud Code root', () => {
    expect(cloudCodeOrigin('https://cloudcode-pa.googleapis.com/v1')).toBe('https://cloudcode-pa.googleapis.com')
    expect(cloudCodeOrigin('http://127.0.0.1:9')).toBe('http://127.0.0.1:9')
    expect(cloudCodeGenerateUrl('https://cloudcode-pa.googleapis.com/v1'))
      .toBe('https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse')
    expect(cloudCodeAssistOrigin(`${CLOUD_CODE_DAILY_ORIGIN}/v1`)).toBe(CLOUD_CODE_PROD_ORIGIN)
    expect(cloudCodeAssistOrigin('http://127.0.0.1:9/v1')).toBe('http://127.0.0.1:9')
  })

  it('skips chat, tab, internal, and empty ids and keeps disclosed capacity', () => {
    expect(isSelectableDiscoveredModel('gemini-3-flash')).toBe(true)
    expect(isSelectableDiscoveredModel('claude-opus-4-6-thinking')).toBe(true)
    expect(isSelectableDiscoveredModel('gemini-2.5-pro')).toBe(false)
    expect(isSelectableDiscoveredModel('gemini-2')).toBe(false)
    expect(isSelectableDiscoveredModel('gemini-exp-1206')).toBe(false)
    expect(isSelectableDiscoveredModel('chat_x')).toBe(false)
    expect(parseAvailableModels({ models: listing.models })).toEqual(discovered)
    expect(parseAvailableModels({})).toEqual([])
    expect(parseAvailableModels({ models: [] })).toEqual([])
  })

  it('loads the companion project then POSTs fetchAvailableModels', async () => {
    const server = await mockServer([assist, { json: listing }])
    const connection = resolvedConfig(Config({ baseURL: `${server.url}/v1` }))
    const models = await fetchAvailableModels(connection, 'token')
    expect(models).toEqual(discovered)
    expect(server.paths).toEqual(['/v1internal:loadCodeAssist', '/v1internal:fetchAvailableModels'])
    expect(server.headers[0]?.authorization).toBe('Bearer token')
    expect(server.headers[0]?.['user-agent']).toMatch(/^antigravity\/hub\/2\.9\.1 /)
    expect(server.headers[0]?.['x-goog-api-client']).toBe('google-cloud-sdk vscode_cloudshelleditor/0.1')
    expect(server.requests[0]).toEqual({
      metadata: { ideType: 'ANTIGRAVITY' },
    })
    expect(server.requests[1]).toEqual({ project: 'proj-1' })
  })

  it('reads nested and wrapped companion project ids', () => {
    expect(extractProjectId({ cloudaicompanionProject: 'direct' })).toBe('direct')
    expect(extractProjectId({ cloudaicompanionProject: { id: 'nested' } })).toBe('nested')
    expect(extractProjectId({ done: true, response: { cloudaicompanionProject: { id: 'lro' } } })).toBe('lro')
    expect(extractProjectId({})).toBeUndefined()
    expect(extractProjectId({ cloudaicompanionProject: '' })).toBeUndefined()
  })

  it('onboards a managed project when loadCodeAssist omits one', async () => {
    const onboarded = await mockServer([
      { json: { allowedTiers: [null, { isDefault: false, id: 'paid' }, { isDefault: true, id: 1 }, { isDefault: true, id: '' }, { id: 'legacy-tier', isDefault: true }] } },
      { json: { done: true, response: { cloudaicompanionProject: { id: 'onboarded' } } } },
      { json: listing },
    ])
    await fetchAvailableModels(resolvedConfig(Config({ baseURL: `${onboarded.url}/v1` })), 't')
    expect(onboarded.paths).toEqual([
      '/v1internal:loadCodeAssist',
      '/v1internal:onboardUser',
      '/v1internal:fetchAvailableModels',
    ])
    expect(onboarded.requests[1]).toEqual({
      tier_id: 'legacy-tier',
      metadata: { ide_type: 'ANTIGRAVITY', ide_version: '2.9.1', ide_name: 'antigravity' },
    })
    expect(onboarded.requests[2]).toEqual({ project: 'onboarded' })
  })

  it('lists without a project when Assist and onboard omit one', async () => {
    const omitted = await mockServer([
      { json: { currentTier: { id: 'free-tier' } } },
      { json: {} },
      { json: listing },
    ])
    await fetchAvailableModels(resolvedConfig(Config({ baseURL: `${omitted.url}/v1` })), 't')
    expect(omitted.requests[1]).toMatchObject({ tier_id: 'free-tier' })
    expect(omitted.requests[2]).toEqual({})
    const empty = await mockServer([
      { json: { cloudaicompanionProject: '' } },
      { status: 400, body: '{"error":{"message":"nope"}}' },
      { json: listing },
    ])
    await fetchAvailableModels(resolvedConfig(Config({ baseURL: `${empty.url}/v1` })), 't')
    expect(empty.requests[2]).toEqual({})
  })

  it('lists without a project when onboard throws a non-LlmError', async () => {
    const server = await mockServer([{ json: {} }, { json: listing }])
    const original = globalThis.fetch.bind(globalThis)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).includes('onboardUser')) throw new Error('offline')
      return original(input, init)
    })
    await fetchAvailableModels(resolvedConfig(Config({ baseURL: `${server.url}/v1` })), 't')
    expect(server.requests.at(-1)).toEqual({})
  })

  it('fails loud when onboard rejects the grant', async () => {
    const denied = await mockServer([
      { json: {} },
      { status: 401, body: '{"error":{"message":"nope"}}' },
    ])
    await expect(fetchAvailableModels(resolvedConfig(Config({ baseURL: denied.url })), 't'))
      .rejects.toMatchObject({ code: 'AUTH' })
  })

  it('fails loud when onboard is aborted or times out', async () => {
    const aborted = await mockServer([{ json: {} }, { json: listing, delayMs: 5_000 }])
    const controller = new AbortController()
    const pendingAbort = fetchAvailableModels(
      resolvedConfig(Config({ baseURL: aborted.url })),
      't',
      controller.signal,
    )
    await aborted.waitForRequests(2)
    controller.abort()
    await expect(pendingAbort).rejects.toMatchObject({ code: 'ABORTED' })

    const hung = await mockServer([{ json: {} }, { json: listing, delayMs: 60_000 }])
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pendingTimeout = fetchAvailableModels(
      resolvedConfig(Config({ baseURL: hung.url, requestTimeoutMs: 20 })),
      't',
    )
    await hung.waitForRequests(2)
    const rejected = expect(pendingTimeout).rejects.toMatchObject({ code: 'TIMEOUT' })
    await vi.advanceTimersByTimeAsync(20)
    await rejected
    vi.useRealTimers()
  })

  it('maps a listing HTTP failure, in-band RPC error, and invalid JSON', async () => {
    const failed = await mockServer([{ status: 401, body: '{"error":{"message":"nope"}}' }])
    await expect(fetchAvailableModels(resolvedConfig(Config({ baseURL: failed.url })), 't'))
      .rejects.toMatchObject({ code: 'AUTH' })
    const gateway = await mockServer([{ status: 500, body: 'upstream' }])
    await expect(fetchAvailableModels(resolvedConfig(Config({ baseURL: gateway.url })), 't'))
      .rejects.toMatchObject({ code: 'NETWORK' })
    const rpc = await mockServer([{
      json: { error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED' } },
    }])
    await expect(fetchAvailableModels(resolvedConfig(Config({ baseURL: rpc.url })), 't'))
      .rejects.toMatchObject({ code: 'RATE_LIMIT', failure: { status: 429 } })
    const untyped = await mockServer([{ json: { error: { message: 'bad' } } }])
    await expect(fetchAvailableModels(resolvedConfig(Config({ baseURL: untyped.url })), 't'))
      .rejects.toMatchObject({ failure: { status: 400 } })
    const blank = await mockServer([{ status: 500, raw: '' }])
    await expect(fetchAvailableModels(resolvedConfig(Config({ baseURL: blank.url })), 't'))
      .rejects.toMatchObject({ code: 'NETWORK' })
    const invalid = await mockServer([{ raw: 'not-json' }])
    await expect(fetchAvailableModels(resolvedConfig(Config({ baseURL: invalid.url })), 't'))
      .rejects.toMatchObject({ code: 'PROTOCOL' })
    const listed = await mockServer([assist, { raw: 'not-json' }])
    await expect(fetchAvailableModels(resolvedConfig(Config({ baseURL: listed.url })), 't'))
      .rejects.toMatchObject({ code: 'PROTOCOL' })
  })

  it('honors an aborted caller signal', async () => {
    const server = await mockServer([{ json: listing, delayMs: 5_000 }])
    const controller = new AbortController()
    const pending = fetchAvailableModels(resolvedConfig(Config({ baseURL: server.url })), 't', controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('maps a refused listing connection to NETWORK', async () => {
    await expect(fetchAvailableModels(
      resolvedConfig(Config({ baseURL: 'http://127.0.0.1:1' })),
      't',
    )).rejects.toMatchObject({ code: 'NETWORK' })
  })

  it('times out a hung listing', async () => {
    const server = await mockServer([{ json: listing, delayMs: 60_000 }])
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = fetchAvailableModels(
      resolvedConfig(Config({ baseURL: server.url, requestTimeoutMs: 20 })),
      't',
    )
    await server.requestReceived
    const rejected = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' })
    await vi.advanceTimersByTimeAsync(20)
    await rejected
    vi.useRealTimers()
  })
})

describe('listModels live catalog', () => {
  it('fetches Cloud Code when models is empty and a credential is present', async () => {
    const server = await mockServer([assist, { json: listing }])
    const current = new AntigravityAdapter({
      options: () => resolvedConfig(Config({ baseURL: `${server.url}/v1`, models: [] })),
      resolveAccessToken: () => Promise.resolve('token'),
    })
    expect(await current.listModels(PROVIDER)).toEqual(discovered.map(model => ({
      provider: PROVIDER,
      id: model.id,
      name: model.name,
      inputModalities: ['text'],
    })))
  })

  it('keeps an explicit models list without contacting Cloud Code', async () => {
    const current = new AntigravityAdapter({
      options: () => resolvedConfig(Config({
        baseURL: 'http://127.0.0.1:1/v1',
        models: [{ id: 'fixed', name: 'Fixed' }],
      })),
      resolveAccessToken: () => Promise.reject(new Error('must not resolve a token')),
    })
    expect(await current.listModels(PROVIDER)).toEqual([
      { provider: PROVIDER, id: 'fixed', name: 'Fixed', inputModalities: ['text'] },
    ])
  })

  it('hides the catalog until a selectable credential exists', async () => {
    const current = new AntigravityAdapter({
      options: () => resolvedConfig(Config({ models: [{ id: 'fixed' }] })),
      resolveAccessToken: () => Promise.resolve('token'),
      hasSelectableCredential: () => Promise.resolve(false),
    })
    expect(await current.listModels(PROVIDER)).toEqual([])
  })
})

describe('listing failures stay visible', () => {
  it('does not invent a catalog when listing fails', async () => {
    const server = await mockServer([{ status: 503, body: 'down' }])
    const current = new AntigravityAdapter({
      options: () => resolvedConfig(Config({ baseURL: server.url, models: [] })),
      resolveAccessToken: () => Promise.resolve('token'),
    })
    await expect(current.listModels(PROVIDER)).rejects.toMatchObject({ code: 'NETWORK' })
  })
})


describe('credential-scoped model catalog cache', () => {
  it('coalesces cold loads and serves warm listings without another network request', async () => {
    const server = await mockServer([assist, { json: listing }])
    const current = new AntigravityAdapter({
      options: () => resolvedConfig(Config({ baseURL: server.url })),
      resolveAccessToken: () => Promise.resolve('first'),
    })
    const [first, concurrent] = await Promise.all([current.listModels(PROVIDER), current.listModels(PROVIDER)])
    expect(concurrent).toEqual(first)
    expect(server.requests).toHaveLength(2)
    expect(await current.listModels(PROVIDER)).toEqual(first)
    expect(server.requests).toHaveLength(2)
    current.disposeCatalog()
  })

  it('does not reuse a listing after a credential change', async () => {
    const server = await mockServer([assist, { json: listing }, assist, { json: listing }])
    let token = 'first'
    const current = new AntigravityAdapter({
      options: () => resolvedConfig(Config({ baseURL: server.url })),
      resolveAccessToken: () => Promise.resolve(token),
    })
    await current.listModels(PROVIDER)
    token = 'second'
    await current.listModels(PROVIDER)
    expect(server.requests).toHaveLength(4)
    current.disposeCatalog()
  })
})


describe('model catalog background refresh', () => {
  it('returns the previous listing while refreshing an expired directory', async () => {
    let now = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const server = await mockServer([assist, { json: listing }, assist, { json: { models: { 'gemini-3-new': { displayName: 'New' } } }, delayMs: 20 }])
    const current = new AntigravityAdapter({
      options: () => resolvedConfig(Config({ baseURL: server.url, catalogMaxAgeMs: 100 })),
      resolveAccessToken: () => Promise.resolve('token'),
    })
    const first = await current.listModels(PROVIDER)
    now += 101
    expect(await current.listModels(PROVIDER)).toEqual(first)
    await vi.waitFor(async () => { expect((await current.listModels(PROVIDER))[0]?.id).toBe('gemini-3-new') })
    expect(server.requests).toHaveLength(4)
    current.disposeCatalog()
  })
})
