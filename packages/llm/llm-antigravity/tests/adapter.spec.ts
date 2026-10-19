import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import LlmRuntime, {
  createAssistantMessage,
  createDeveloperMessage,
  createSystemMessage,
  createToolResultMessage,
  createUserMessage,
  LlmError,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Antigravity from '../src/index.ts'
import { AntigravityAdapter, serializeRequest, translateSse } from '../src/adapter.ts'
import { Config, PROVIDER, resolvedConfig } from '../src/config.ts'
import { RECORD_KEY } from '../src/oauth.ts'
import { assemble, collect } from './assemble.ts'
import { assistProject, closeMockServers, cloudEvent, mockServer, sseStream, textEvents } from './mock-server.ts'

const dirs: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await closeMockServers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

function connection(baseURL: string, extra: Partial<ReturnType<typeof resolvedConfig>> = {}) {
  return resolvedConfig(Config({ baseURL, models: [{ id: 'gemini-flash', name: 'Flash' }], ...extra }))
}

function adapter(baseURL: string, token = 'test-token') {
  return new AntigravityAdapter({
    options: () => connection(baseURL),
    resolveAccessToken: () => Promise.resolve(token),
  })
}

async function harness(baseURL: string, extra: Record<string, unknown> = {}): Promise<Context> {
  vi.stubEnv('ANTIGRAVITY_API_KEY', 'env-key')
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(Antigravity, { baseURL, models: [{ id: 'gemini-flash' }], ...extra })
  return ctx
}

describe('AntigravityAdapter streaming', () => {
  it('persists tool signatures through assembly and restores them only for the same model', async () => {
    const server = await mockServer([assistProject, { events: [
      cloudEvent([{ text: 'Looking for files' }]),
      cloudEvent([
        { thoughtSignature: 'opaque-signature', functionCall: { id: 'c1', name: 'glob', args: { pattern: '*' } } },
        { functionCall: { id: 'c2', name: 'read', args: { path: 'README.md' } } },
      ], 'STOP'),
    ] }])
    const ctx = await harness(server.url)
    try {
      const result = await assemble(ctx, {
        model: 'gemini-flash',
        messages: [createUserMessage({ content: [{ type: 'text', text: 'Explore' }], source: { kind: 'user' } })],
      })
      const message = JSON.parse(JSON.stringify(result.message)) as typeof result.message
      if (message.source.kind !== 'model') throw new Error('Expected model source')
      expect(message.source.replayState).toMatchObject({
        response: { kind: 'antigravity', version: 1, model: 'gemini-flash' },
        blocks: [{ type: 'text' }, { type: 'tool-call', thoughtSignature: 'opaque-signature' }, { type: 'tool-call' }],
      })
      const body = (model: string) => serializeRequest({ provider: PROVIDER, model, messages: [message] }, 'p')
      expect(body('gemini-flash').request).toMatchObject({ contents: [{ role: 'model', parts: [
        { text: 'Looking for files' },
        { thoughtSignature: 'opaque-signature', functionCall: { id: 'c1', name: 'glob' } },
        { functionCall: { id: 'c2', name: 'read' } },
      ] }] })
      expect(JSON.stringify(body('another-model'))).not.toContain('opaque-signature')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('streams text, usage before finish, and Cloud Code headers', async () => {
    const server = await mockServer([assistProject, { events: textEvents }])
    const ctx = await harness(server.url)
    const result = await assemble(ctx, {
      model: 'gemini-flash',
      messages: [createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } })],
    })
    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(result.finish).toEqual({ kind: 'stop' })
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 1, totalTokens: 4 })
    const usageAt = result.output.findIndex(chunk => chunk.type === 'usage')
    const finishAt = result.output.findIndex(chunk => chunk.type === 'finish')
    expect(usageAt).toBeGreaterThan(-1)
    expect(usageAt).toBeLessThan(finishAt)
    expect(server.paths).toEqual(['/v1internal:loadCodeAssist', '/v1internal:streamGenerateContent?alt=sse'])
    expect(server.headers[1]?.authorization).toBe('Bearer env-key')
    expect(server.headers[1]?.['user-agent']).toMatch(/^antigravity\/hub\/2\.9\.1 /)
    expect(server.requests[1]).toMatchObject({
      project: 'proj-1',
      model: 'gemini-flash',
      userAgent: 'antigravity',
      requestType: 'agent',
      request: { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] },
    })
    await ctx.fiber.dispose()
  })

  it('streams reasoning, raw tool-call JSON, and maps finish reasons', async () => {
    const events = [
      cloudEvent([{ thought: true, text: 'think' }]),
      cloudEvent([{ thought: true, text: ' more' }]),
      cloudEvent([{ text: 'ok' }]),
      cloudEvent(
        [{ functionCall: { id: 'call_1', name: 'read', args: { path: 'a' } } }],
        'OTHER',
        {
          promptTokenCount: 10,
          candidatesTokenCount: 4,
          cachedContentTokenCount: 2,
          thoughtsTokenCount: 1,
          totalTokenCount: 15,
        },
      ),
    ]
    const output = await collect(translateSse(sseStream(events), () => {}))
    expect(output.filter(chunk => chunk.type === 'reasoning-delta').map(chunk => chunk.text))
      .toEqual(['think', ' more'])
    expect(output.filter(chunk => chunk.type === 'block-start').map(chunk => chunk.blockType))
      .toEqual(['reasoning', 'text', 'tool-call'])
    expect(output.filter(chunk => chunk.type === 'tool-call-delta').map(chunk => chunk.argumentsDelta))
      .toEqual(['{"path":"a"}'])
    expect(output.at(-2)).toEqual({
      type: 'usage',
      usage: { inputTokens: 8, outputTokens: 5, totalTokens: 15, cacheReadTokens: 2, reasoningTokens: 1 },
    })
    expect(output.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'tool-calls' } })
  })

  it.each([
    ['MAX_TOKENS', 'max-tokens'],
    ['OTHER', 'stop'],
    ['SAFETY', 'error'],
  ] as const)('maps finishReason %s', async (reason, kind) => {
    const output = await collect(translateSse(sseStream([
      cloudEvent([{ text: 'x' }]),
      cloudEvent([], reason),
    ]), () => {}))
    expect(output.at(-1)).toMatchObject({ type: 'finish', reason: { kind } })
  })

  it('reads content from a single Cloud Code candidate', async () => {
    const output = await collect(translateSse(sseStream([
      '{"candidates":[{"content":{"parts":[null,{"text":"hi"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":4,"candidatesTokenCount":1,"cachedContentTokenCount":1}}',
    ]), () => {}))
    expect(output.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text)).toEqual(['hi'])
    expect(output.find(chunk => chunk.type === 'usage')?.usage).toEqual({
      inputTokens: 3, outputTokens: 1, totalTokens: 5, cacheReadTokens: 1,
    })
  })

  it('skips empty parts, synthesizes a tool-call id, and ignores duplicate calls', async () => {
    const output = await collect(translateSse(sseStream([
      cloudEvent([{ thought: true, text: '' }, { text: '' }]),
      '{"response":{"candidates":[{}]}}',
      cloudEvent([{ functionCall: { name: 'echo' } }]),
      cloudEvent([{ functionCall: { name: 'echo' } }], 'OTHER'),
    ]), () => {}))
    expect(output.filter(chunk => chunk.type === 'tool-call-delta')).toEqual([
      { type: 'tool-call-delta', index: 0, id: 'call_0', name: 'echo', argumentsDelta: '{}' },
    ])
    expect(output.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'tool-calls' } })
  })

  it('ignores empty frames, comments, and trailing usage-only chunks', async () => {
    const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(': keep-alive\n\ndata: \n\n'))
        controller.enqueue(new TextEncoder().encode(`data: ${cloudEvent([{ text: 'hi' }])}\n\n`))
        controller.enqueue(new TextEncoder().encode(`data: ${cloudEvent([], 'STOP')}\n\n`))
        controller.enqueue(new TextEncoder().encode('data: {"response":{"candidates":[],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1}}}\n\n'))
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const output = await collect(translateSse(body, () => {}))
    expect(output.find(chunk => chunk.type === 'usage')?.usage).toEqual({
      inputTokens: 1, outputTokens: 1, totalTokens: 2,
    })
  })

  it('rejects malformed SSE, in-band errors, and empty completions', async () => {
    await expect(collect(translateSse(sseStream(['not-json']), () => {})))
      .rejects.toMatchObject({ code: 'PROTOCOL' })
    await expect(collect(translateSse(sseStream(['[]']), () => {})))
      .rejects.toMatchObject({ code: 'PROTOCOL' })
    await expect(collect(translateSse(sseStream(['{"error":{"message":"nope","type":"authentication_error"}}']), () => {})))
      .rejects.toMatchObject({ code: 'AUTH' })
    await expect(collect(translateSse(sseStream([
      cloudEvent([], 'STOP'),
    ]), () => {}))).rejects.toMatchObject({ code: 'EMPTY_RESPONSE' })
    await expect(collect(translateSse(sseStream([]), () => {})))
      .rejects.toMatchObject({ code: 'EMPTY_RESPONSE' })
  })

  it('throws PROTOCOL when a tool call never receives a name', async () => {
    await expect(collect(translateSse(sseStream([
      cloudEvent([
        { functionCall: { args: { x: 1 } } },
        { functionCall: { args: { y: 2 } } },
      ], 'OTHER'),
    ]), () => {}))).rejects.toMatchObject({ code: 'PROTOCOL' })
  })

  it('infers tool-calls when the stream ends without finishReason', async () => {
    const output = await collect(translateSse(sseStream([
      cloudEvent([{ functionCall: { id: 'c1', name: 'echo', args: {} } }]),
    ]), () => {}))
    expect(output.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'tool-calls' } })
  })

  it('treats missing usage counts as zero', async () => {
    const output = await collect(translateSse(sseStream([
      cloudEvent([{ text: 'hi' }], 'STOP', {}),
    ]), () => {}))
    expect(output.find(chunk => chunk.type === 'usage')?.usage).toEqual({
      inputTokens: 0, outputTokens: 0, totalTokens: 0,
    })
  })
})

describe('request serialization', () => {
  it('serializes system, developer, assistant tools, and sampling fields', () => {
    const payload = serializeRequest({
      provider: PROVIDER,
      model: 'gemini-flash',
      system: 'be brief',
      temperature: 0.2,
      maxTokens: 9,
      stop: ['END'],
      reasoningEffort: 'high' as never,
      tools: [{ name: 'echo', description: 'Echo', parameters: { type: 'object' } }],
      messages: [
        createSystemMessage('sys'),
        createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }),
        createAssistantMessage({
          content: [
            { type: 'reasoning', text: 'skip' },
            { type: 'text', text: 'calling' },
            { type: 'tool-call', id: ToolCallId('c1'), name: 'echo', arguments: '{"x":1}' },
          ],
          source: { provider: PROVIDER, model: 'gemini-flash' },
        }),
        createToolResultMessage({
          callId: ToolCallId('c1'),
          content: [{ type: 'text', text: 'ok' }],
          isError: false,
        }),
      ],
    }, 'proj-1')
    expect(payload).toMatchObject({
      project: 'proj-1',
      model: 'gemini-flash',
      userAgent: 'antigravity',
      requestType: 'agent',
      request: {
        systemInstruction: { parts: [{ text: 'be brief' }, { text: 'sys' }] },
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 9,
          stopSequences: ['END'],
        },
        tools: [{ functionDeclarations: [{ name: 'echo', description: 'Echo', parameters: { type: 'object' } }] }],
      },
    })
    expect(
      (payload.request as { generationConfig: Record<string, unknown> }).generationConfig,
    ).not.toHaveProperty('thinkingConfig')
    expect(payload.request).toMatchObject({
      contents: [
        { role: 'user', parts: [{ text: 'hi' }] },
        {
          role: 'model',
          parts: [
            { text: 'calling' },
            { functionCall: { id: 'c1', name: 'echo', args: { x: 1 } } },
          ],
        },
        {
          role: 'user',
          parts: [{ functionResponse: { id: 'c1', name: 'echo', response: { output: 'ok' } } }],
        },
      ],
    })
  })

  it('omits empty system text, maps developer text, and serializes tool-only assistants', () => {
    const payload = serializeRequest({
      provider: PROVIDER,
      model: 'm',
      messages: [
        createSystemMessage(''),
        createDeveloperMessage({ content: [{ type: 'text', text: 'dev' }], source: { kind: 'user' } }),
        createDeveloperMessage({ content: [{ type: 'tool-addition', toolName: 'x' }], source: { kind: 'user' } }),
        createUserMessage({
          content: [{ type: 'reasoning', text: 'hidden' }],
          source: { kind: 'user' },
        }),
        createUserMessage({
          content: [
            { type: 'reasoning', text: 'hidden' },
            { type: 'text', text: 'ask' },
            { type: 'tool-call', id: ToolCallId('ignored'), name: 'n', arguments: '{}' },
            { type: 'tool-removal', toolName: 'y' },
          ],
          source: { kind: 'user' },
        }),
        createAssistantMessage({
          content: [
            { type: 'text', text: 'plain' },
            { type: 'tool-addition', toolName: 'x' },
            { type: 'tool-removal', toolName: 'y' },
          ],
          source: { provider: PROVIDER, model: 'm' },
        }),
        createAssistantMessage({
          content: [{ type: 'tool-call', id: ToolCallId('c'), name: 'n', arguments: 'not-json' }],
          source: { provider: PROVIDER, model: 'm' },
        }),
        createToolResultMessage({
          callId: ToolCallId('missing'),
          content: [{ type: 'text', text: '{"ok":true}' }],
          isError: false,
        }),
      ],
    }, 'p')
    expect(payload.request).toMatchObject({
      systemInstruction: { parts: [{ text: 'dev' }] },
      contents: [
        { role: 'user', parts: [{ text: 'ask' }] },
        {
          role: 'model',
          parts: [
            { text: 'plain' },
            { functionCall: { id: 'c', name: 'n', args: { value: 'not-json' } } },
          ],
        },
        {
          role: 'user',
          parts: [{ functionResponse: { id: 'missing', name: 'missing', response: { ok: true } } }],
        },
      ],
    })
  })

  it('refuses image and file request blocks', () => {
    expect(() => serializeRequest({
      provider: PROVIDER,
      model: 'm',
      messages: [createUserMessage({
        content: [{ type: 'image', attachment: { attachmentId: 'x' } as never }],
        source: { kind: 'user' },
      })],
    }, 'p')).toThrow(LlmError)
    expect(() => serializeRequest({
      provider: PROVIDER,
      model: 'm',
      messages: [createUserMessage({
        content: [{ type: 'file', attachment: { attachmentId: 'y' } as never }],
        source: { kind: 'user' },
      })],
    }, 'p')).toThrow(LlmError)
    expect(() => serializeRequest({
      provider: PROVIDER,
      model: 'm',
      messages: [createAssistantMessage({
        content: [{ type: 'image', attachment: { attachmentId: 'z' } as never }],
        source: { provider: PROVIDER, model: 'm' },
      })],
    }, 'p')).toThrow(LlmError)
  })

  it('merges consecutive same-role turns and wraps non-object tool JSON', () => {
    const payload = serializeRequest({
      provider: PROVIDER,
      model: 'm',
      messages: [
        createUserMessage({ content: [{ type: 'text', text: 'a' }], source: { kind: 'user' } }),
        createUserMessage({ content: [{ type: 'text', text: 'b' }], source: { kind: 'user' } }),
        createAssistantMessage({
          content: [
            { type: 'text', text: '' },
            { type: 'tool-call', id: ToolCallId('c1'), name: 'echo', arguments: '[1]' },
          ],
          source: { provider: PROVIDER, model: 'm' },
        }),
        createToolResultMessage({ callId: ToolCallId('c1'), content: [], isError: false }),
        createToolResultMessage({
          callId: ToolCallId('c2'),
          content: [{ type: 'text', text: '3' }],
          isError: false,
        }),
      ],
    }, 'p')
    expect(payload.request).toMatchObject({
      contents: [
        { role: 'user', parts: [{ text: 'a' }, { text: 'b' }] },
        { role: 'model', parts: [{ functionCall: { id: 'c1', name: 'echo', args: { value: [1] } } }] },
        {
          role: 'user',
          parts: [
            { functionResponse: { id: 'c1', name: 'echo', response: { output: '' } } },
            { functionResponse: { id: 'c2', name: 'c2', response: { output: 3 } } },
          ],
        },
      ],
    })
  })
})

describe('provider failures and cancellation', () => {
  it.each([
    [401, '{"error":{"message":"nope"}}', 'AUTH'],
    [402, '{"error":{"message":"insufficient_quota"}}', 'QUOTA'],
    [429, '{"error":{"message":"slow"}}', 'RATE_LIMIT'],
    [400, '{"error":{"message":"input is too long for this model"}}', 'CONTEXT_WINDOW_EXCEEDED'],
    [413, '{"error":{"type":"invalid_request_error","message":"big"}}', 'INVALID_REQUEST'],
    [503, 'upstream', 'NETWORK'],
    [418, 'teapot', 'PROTOCOL'],
  ] as const)('maps HTTP %s to %s', async (status, body, code) => {
    const server = await mockServer([assistProject, { status, body }])
    const current = adapter(server.url)
    await expect(collect(current.stream({ provider: PROVIDER, model: 'm', messages: [] })))
      .rejects.toMatchObject({ code, failure: { status } })
  })

  it('throws PROTOCOL when Cloud Code omits a companion project', async () => {
    const server = await mockServer([
      { json: {} },
      { status: 400, body: '{"error":{"message":"nope"}}' },
    ])
    await expect(collect(adapter(server.url).stream({ provider: PROVIDER, model: 'm', messages: [] })))
      .rejects.toMatchObject({ code: 'PROTOCOL' })
    expect(server.paths).toEqual(['/v1internal:loadCodeAssist', '/v1internal:onboardUser'])
  })

  it('throws PROTOCOL when the provider returns no body', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('loadCodeAssist')) {
        return new Response(JSON.stringify({ cloudaicompanionProject: 'p' }), {
          status: 200, headers: { 'content-type': 'application/json' },
        })
      }
      const response = new Response('unused', { status: 200 })
      Object.defineProperty(response, 'body', { value: null })
      return response
    })
    const current = adapter('http://example.test')
    await expect(collect(current.stream({ provider: PROVIDER, model: 'm', messages: [] })))
      .rejects.toMatchObject({ code: 'PROTOCOL' })
  })

  it('maps a refused connection to NETWORK', async () => {
    const current = adapter('http://127.0.0.1:1')
    await expect(collect(current.stream({ provider: PROVIDER, model: 'm', messages: [] })))
      .rejects.toMatchObject({ code: 'NETWORK' })
  })

  it('honors an aborted caller signal', async () => {
    const server = await mockServer([assistProject, { events: textEvents, delayMs: 5_000 }])
    const current = adapter(server.url)
    const controller = new AbortController()
    const pending = collect(current.stream({
      provider: PROVIDER, model: 'm', messages: [], signal: controller.signal,
    }))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('times out an idle stream', async () => {
    const server = await mockServer([assistProject, { events: [], holdOpen: true }])
    const current = new AntigravityAdapter({
      options: () => connection(server.url, { streamIdleTimeoutMs: 20, requestTimeoutMs: 30_000 }),
      resolveAccessToken: () => Promise.resolve('k'),
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = collect(current.stream({ provider: PROVIDER, model: 'm', messages: [] }))
    await server.waitForRequests(2)
    const rejected = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' })
    await vi.advanceTimersByTimeAsync(20)
    await rejected
    vi.useRealTimers()
  })

  it('does not cut streamed output off at the non-generation request deadline', async () => {
    const server = await mockServer([assistProject, { events: [cloudEvent([{ text: 'partial' }])], holdOpen: true }])
    const current = new AntigravityAdapter({
      options: () => connection(server.url, { requestTimeoutMs: 30_000, generationTimeoutMs: 600_000, streamIdleTimeoutMs: 300_000 }),
      resolveAccessToken: () => Promise.resolve('k'),
    })
    const controller = new AbortController()
    const progress = Promise.withResolvers<undefined>()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = (async () => {
      for await (const chunk of current.stream({ provider: PROVIDER, model: 'm', messages: [], signal: controller.signal })) {
        if (chunk.type === 'text-delta') progress.resolve(undefined)
      }
    })()
    const rejected = expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
    try {
      await progress.promise
      await vi.advanceTimersByTimeAsync(31_000)
    } finally {
      controller.abort()
      await rejected
      vi.useRealTimers()
    }
  })

  it('times out a generation at its own total deadline', async () => {
    const server = await mockServer([assistProject, { events: textEvents, delayMs: 60_000 }])
    const current = new AntigravityAdapter({
      options: () => connection(server.url, { generationTimeoutMs: 20, streamIdleTimeoutMs: 30_000 }),
      resolveAccessToken: () => Promise.resolve('k'),
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = collect(current.stream({ provider: PROVIDER, model: 'm', messages: [] }))
    await server.waitForRequests(2)
    const rejected = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' })
    await vi.advanceTimersByTimeAsync(20)
    await rejected
    vi.useRealTimers()
  })
})

describe('authentication', () => {
  it('prefers a stored grant over the API key', async () => {
    const server = await mockServer([assistProject, { events: textEvents }])
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ag-'))
    dirs.push(dir)
    const ctx = new Context()
    await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
    await ctx.plugin(LlmRuntime)
    vi.stubEnv('ANTIGRAVITY_API_KEY', 'env-key')
    await ctx.plugin(Antigravity, { baseURL: server.url, models: [{ id: 'm' }] })
    await ctx.credentials.modifyRecord(RECORD_KEY, () => Promise.resolve({
      kind: 'grant', payload: { version: 1, accessToken: 'grant-token' },
    }))
    await assemble(ctx, { model: 'm', messages: [] })
    expect(server.headers[0]?.authorization).toBe('Bearer grant-token')
    await ctx.fiber.dispose()
  })

  it('refreshes an expired grant and reuses the in-flight refresh', async () => {
    const server = await mockServer([
      assistProject, { events: textEvents },
      assistProject, { events: textEvents },
      assistProject, { events: textEvents },
    ])
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ag-'))
    dirs.push(dir)
    const ctx = new Context()
    await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(Antigravity, {
      baseURL: server.url,
      oauthTokenURL: 'http://127.0.0.1/token',
      models: [{ id: 'm' }],
    })
    await ctx.credentials.modifyRecord(RECORD_KEY, () => Promise.resolve({
      kind: 'grant',
      payload: { version: 1, accessToken: 'old', refreshToken: 'rt', expiresAt: 1 },
    }))
    const originalFetch = globalThis.fetch.bind(globalThis)
    let tokenCalls = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('/token')) {
        tokenCalls += 1
        const body = tokenCalls === 1
          ? { access_token: 'fresh', expires_in: 3600 }
          : { access_token: 'newer', refresh_token: 'rt2', expires_in: 3600 }
        return new Response(JSON.stringify(body), {
          status: 200, headers: { 'content-type': 'application/json' },
        })
      }
      return originalFetch(input, init)
    })
    await Promise.all([
      assemble(ctx, { model: 'm', messages: [] }),
      assemble(ctx, { model: 'm', messages: [] }),
    ])
    expect(tokenCalls).toBe(1)
    expect(server.headers[0]?.authorization).toBe('Bearer fresh')
    expect(server.headers[1]?.authorization).toBe('Bearer fresh')
    const stored = await ctx.credentials.readRecord(RECORD_KEY)
    expect(stored).toMatchObject({ kind: 'grant', payload: { accessToken: 'fresh', refreshToken: 'rt' } })
    await ctx.credentials.modifyRecord(RECORD_KEY, () => Promise.resolve({
      kind: 'grant',
      payload: { version: 1, accessToken: 'fresh', refreshToken: 'rt', expiresAt: 1 },
    }))
    await assemble(ctx, { model: 'm', messages: [] })
    expect(await ctx.credentials.readRecord(RECORD_KEY)).toMatchObject({
      kind: 'grant', payload: { accessToken: 'newer', refreshToken: 'rt2' },
    })
    await ctx.fiber.dispose()
  })

  it('fails loud on a stored non-grant or unusable grant', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ag-'))
    dirs.push(dir)
    const ctx = new Context()
    await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(Antigravity, { baseURL: 'http://127.0.0.1:1', models: [{ id: 'm' }] })
    await ctx.credentials.modifyRecord(RECORD_KEY, () => Promise.resolve({ kind: 'api-key', key: 'x' }))
    expect((await assemble(ctx, { model: 'm', messages: [] })).finish)
      .toMatchObject({ kind: 'error', failure: { code: 'AUTH' } })
    await ctx.credentials.modifyRecord(RECORD_KEY, () => Promise.resolve({ kind: 'grant', payload: { version: 2 } }))
    expect((await assemble(ctx, { model: 'm', messages: [] })).finish)
      .toMatchObject({ kind: 'error', failure: { code: 'AUTH' } })
    await ctx.credentials.modifyRecord(RECORD_KEY, () => Promise.resolve({
      kind: 'grant', payload: { version: 1, accessToken: 'expired', expiresAt: 1 },
    }))
    expect((await assemble(ctx, { model: 'm', messages: [] })).finish)
      .toMatchObject({ kind: 'error', failure: { code: 'AUTH' } })
    await ctx.fiber.dispose()
  })

  it('fails with MISSING_CREDENTIAL when no grant and no key exist', async () => {
    vi.stubEnv('ANTIGRAVITY_API_KEY', '')
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(Antigravity, { baseURL: 'http://127.0.0.1:1' })
    expect((await assemble(ctx, { model: 'm', messages: [] })).finish)
      .toMatchObject({ kind: 'error', failure: { code: 'MISSING_CREDENTIAL' } })
    await ctx.fiber.dispose()
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ag-'))
    dirs.push(dir)
    const withCreds = new Context()
    await withCreds.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
    await withCreds.plugin(LlmRuntime)
    await withCreds.plugin(Antigravity, { baseURL: 'http://127.0.0.1:1' })
    expect((await assemble(withCreds, { model: 'm', messages: [] })).finish)
      .toMatchObject({ kind: 'error', failure: { code: 'MISSING_CREDENTIAL' } })
    await withCreds.fiber.dispose()
  })
})

describe('plugin registration', () => {
  it('registers the adapter, catalog, and configurable provider, and drops them on dispose', async () => {
    vi.stubEnv('ANTIGRAVITY_API_KEY', 'k')
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    const fiber = await ctx.plugin(Antigravity, { models: [{ id: 'gemini-flash', name: 'Flash', description: 'fast', contextWindow: 1_000_000 }] })
    expect(ctx.llm.listProviders()).toEqual([{ id: PROVIDER, name: 'Antigravity' }])
    expect(await ctx.llm.listModels(PROVIDER)).toEqual([{
      provider: PROVIDER, id: 'gemini-flash', name: 'Flash', description: 'fast', inputModalities: ['text'],
    }])
    expect(await ctx.llm.resolveModelInfo(PROVIDER, 'gemini-flash')).toMatchObject({
      id: 'gemini-flash', context: { contextWindow: 1_000_000 },
    })
    expect(await ctx.llm.resolveModelInfo(PROVIDER, 'unknown')).toMatchObject({
      id: 'unknown', name: 'unknown', inputModalities: ['text'],
    })
    expect(ctx.llm.listConfigurableProviders()).toEqual([expect.objectContaining({
      provider: PROVIDER, displayName: 'Antigravity', settingsPath: [],
    })])
    await fiber.dispose()
    expect(ctx.llm.listProviders()).toEqual([])
    expect(ctx.llm.listConfigurableProviders()).toEqual([])
    await ctx.fiber.dispose()
  })

  it('advertises no models until a credential is present, then lists Cloud Code', async () => {
    vi.stubEnv('ANTIGRAVITY_API_KEY', '')
    const unsigned = new Context()
    await unsigned.plugin(LlmRuntime)
    await unsigned.plugin(Antigravity, {})
    expect(await unsigned.llm.listModels(PROVIDER)).toEqual([])
    await unsigned.fiber.dispose()

    const server = await mockServer([
      { json: { cloudaicompanionProject: 'proj-1' } },
      { json: { models: { 'gemini-live': { displayName: 'Live' } } } },
    ])
    vi.stubEnv('ANTIGRAVITY_API_KEY', 'k')
    const signed = new Context()
    await signed.plugin(LlmRuntime)
    await signed.plugin(Antigravity, { baseURL: `${server.url}/v1` })
    expect(await signed.llm.listModels(PROVIDER)).toEqual([{
      provider: PROVIDER, id: 'gemini-live', name: 'Live', inputModalities: ['text'],
    }])
    await signed.fiber.dispose()
  })

  it('treats a stored grant as selectable for listModels', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ag-'))
    dirs.push(dir)
    const ctx = new Context()
    await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(Antigravity, { models: [{ id: 'm', name: 'M' }] })
    expect(await ctx.llm.listModels(PROVIDER)).toEqual([])
    await ctx.credentials.modifyRecord(RECORD_KEY, () => Promise.resolve({
      kind: 'grant', payload: { version: 1, accessToken: 't' },
    }))
    expect(await ctx.llm.listModels(PROVIDER)).toEqual([
      { provider: PROVIDER, id: 'm', name: 'M', inputModalities: ['text'] },
    ])
    await ctx.fiber.dispose()
  })

  it('treats a stored API-key reference as selectable for listModels', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ag-'))
    dirs.push(dir)
    await writeFile(join(dir, '.credentials.yaml'), 'version: 1\nrefs:\n  ANTIGRAVITY_API_KEY: stored-key\n', { mode: 0o600 })
    const ctx = new Context()
    await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(Antigravity, { models: [{ id: 'm', name: 'M' }] })
    expect(await ctx.llm.listModels(PROVIDER)).toEqual([
      { provider: PROVIDER, id: 'm', name: 'M', inputModalities: ['text'] },
    ])
    await ctx.fiber.dispose()
  })

  it('does not default-export a plugin class', async () => {
    expect('default' in Antigravity).toBe(false)
    expect(credentialKey('llm-antigravity', 'default')).toBe(RECORD_KEY)
  })
})


describe('Gemini usage accounting', () => {
  it('includes thoughts in output and preserves explicit zero cache reads', async () => {
    const output = await collect(translateSse(sseStream([
      cloudEvent([{ text: 'answer' }], 'STOP', { promptTokenCount: 10, candidatesTokenCount: 2, thoughtsTokenCount: 20, cachedContentTokenCount: 0 }),
    ]), () => {}))
    expect(output.find(chunk => chunk.type === 'usage')).toEqual({
      type: 'usage', usage: { inputTokens: 10, outputTokens: 22, reasoningTokens: 20, totalTokens: 32, cacheReadTokens: 0 },
    })
  })
})
