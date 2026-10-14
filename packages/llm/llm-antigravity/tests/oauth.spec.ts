import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context, Service } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import type { AuthorizationInteraction, AuthorizationNotice, AuthorizationPrompt } from '@deepseek-ai/dsh-authorization'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Antigravity from '../src/index.ts'
import { Config, DEFAULT_OAUTH_REDIRECT_PATH, OAUTH_SCOPES, resolvedConfig } from '../src/config.ts'
import {
  buildAuthorizeUrl,
  codeFromCallbackInput,
  exchangeToken,
  grantExpired,
  grantFromTokenResponse,
  parseGrant,
  RECORD_KEY,
  runPkce,
  tokenRequestFields,
} from '../src/oauth.ts'

const dirs: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

class FakeWebServer extends Service {
  readonly routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>()

  constructor(
    ctx: Context,
    readonly host = '127.0.0.1',
    readonly port = 9,
    readonly protocol: 'http:' | 'https:' = 'http:',
  ) {
    super(ctx, 'webServer')
  }

  register(route: { kind: 'exact'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }) {
    this.routes.set(route.path, route.handler)
    return () => { this.routes.delete(route.path) }
  }
}

function surface(answer = 'typed'): AuthorizationInteraction & {
  notices: AuthorizationNotice[]
  prompts: AuthorizationPrompt[]
} {
  const notices: AuthorizationNotice[] = []
  const prompts: AuthorizationPrompt[] = []
  return {
    notices,
    prompts,
    notify: (notice) => { notices.push(notice) },
    prompt: (prompt) => {
      prompts.push(prompt)
      return Promise.resolve(answer)
    },
  }
}

function connection(overrides: Record<string, unknown> = {}) {
  return resolvedConfig(Config(overrides))
}

describe('grant payload', () => {
  it('parses a version-1 grant and rejects anything else', () => {
    expect(parseGrant({
      version: 1, accessToken: 'at', refreshToken: 'rt', expiresAt: 9, tokenType: 'Bearer',
    })).toEqual({ version: 1, accessToken: 'at', refreshToken: 'rt', expiresAt: 9, tokenType: 'Bearer' })
    expect(parseGrant({ version: 2, accessToken: 'at' })).toBeUndefined()
    expect(parseGrant({ version: 1, accessToken: '' })).toBeUndefined()
    expect(parseGrant(null)).toBeUndefined()
  })

  it('treats a grant as expired within the refresh margin', () => {
    expect(grantExpired({ version: 1, accessToken: 'at' }, 100)).toBe(false)
    expect(grantExpired({ version: 1, accessToken: 'at', expiresAt: 100_000 }, 50_000)).toBe(true)
    expect(grantExpired({ version: 1, accessToken: 'at', expiresAt: 200_000 }, 50_000)).toBe(false)
  })

  it('builds a PKCE authorize URL with offline access and configured scopes', () => {
    const url = new URL(buildAuthorizeUrl(connection(), 'challenge', 'state-1', 'http://127.0.0.1/oauth/antigravity/callback'))
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBe('challenge')
    expect(url.searchParams.get('state')).toBe('state-1')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('scope')).toBe(OAUTH_SCOPES.join(' '))
  })

  it('translates a token response and refuses a missing access_token', () => {
    expect(grantFromTokenResponse({
      access_token: 'at', refresh_token: 'rt', expires_in: 10, token_type: 'Bearer',
    }, 1_000)).toEqual({
      version: 1, accessToken: 'at', refreshToken: 'rt', expiresAt: 11_000, tokenType: 'Bearer',
    })
    expect(() => grantFromTokenResponse({})).toThrow(/access_token/)
    expect(() => grantFromTokenResponse(null)).toThrow(/access_token/)
  })
})

describe('callback input', () => {
  it('accepts a bare code or a URL that echoes state', () => {
    expect(codeFromCallbackInput(' abc ', 's')).toBe('abc')
    expect(codeFromCallbackInput('http://127.0.0.1/oauth/antigravity/callback?code=c&state=s', 's')).toBe('c')
  })

  it.each([
    ['', 'empty'],
    ['http://[', 'valid URL'],
    ['http://127.0.0.1/?code=c&state=other', 'state mismatch'],
    ['http://127.0.0.1/?code=c', 'state mismatch'],
    ['http://127.0.0.1/?code=c&state=s&state=t', 'state mismatch'],
    ['http://127.0.0.1/?state=s', 'omitted code'],
    ['http://127.0.0.1/?code=a&code=b&state=s', 'omitted code'],
  ])('rejects %j', (input) => {
    expect(() => codeFromCallbackInput(input, 's')).toThrow()
  })
})

describe('token exchange', () => {
  it('posts urlencoded fields and returns the grant', async () => {
    const fetchImpl = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ access_token: 'at', expires_in: 60 }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    const grant = await exchangeToken(connection(), {
      grant_type: 'authorization_code', code: 'c', redirect_uri: 'http://127.0.0.1/x', client_id: 'id', code_verifier: 'v',
    }, new AbortController().signal)
    expect(grant.accessToken).toBe('at')
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({ 'content-type': 'application/x-www-form-urlencoded' }) as unknown,
    })
  })

  it('attaches the configured client secret and omits an empty one', () => {
    expect(tokenRequestFields(connection(), { grant_type: 'refresh_token', refresh_token: 'r' })).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'r',
      client_id: connection().oauthClientId,
      client_secret: connection().oauthClientSecret,
    })
    expect(tokenRequestFields(connection({ oauthClientSecret: '' }), { grant_type: 'refresh_token', refresh_token: 'r' }).client_secret)
      .toBeUndefined()
  })

  it.each([
    [401, 'AUTH'],
    [403, 'AUTH'],
    [429, 'RATE_LIMIT'],
    [503, 'NETWORK'],
    [400, 'PROTOCOL'],
  ] as const)('maps token HTTP %s to %s', async (status, code) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status }))
    await expect(exchangeToken(connection(), { grant_type: 'refresh_token', refresh_token: 'r', client_id: 'id' }, new AbortController().signal))
      .rejects.toMatchObject({ code })
  })

  it('maps a dropped token request to NETWORK and non-JSON to PROTOCOL', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'))
    await expect(exchangeToken(connection(), { grant_type: 'refresh_token', refresh_token: 'r', client_id: 'id' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'NETWORK' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not-json', { status: 200 }))
    await expect(exchangeToken(connection(), { grant_type: 'refresh_token', refresh_token: 'r', client_id: 'id' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'PROTOCOL' })
  })
})

describe('PKCE flow', () => {
  async function authorizedContext(): Promise<Context> {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ag-oauth-'))
    dirs.push(dir)
    const ctx = new Context()
    await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
    await ctx.plugin(AuthorizationService)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(Antigravity, { baseURL: 'http://127.0.0.1:1' })
    return ctx
  }

  it('registers the flow only when authorization is mounted, and disposes it with the plugin', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(Antigravity, {})
    expect(ctx.get('authorization')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('completes PKCE from a pasted callback URL', async () => {
    const fetchImpl = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }),
      { status: 200 },
    ))
    const ctx = await authorizedContext()
    let captured = ''
    const ui = surface()
    const originalPrompt = ui.prompt
    ui.prompt = async (prompt) => {
      captured = ui.notices[0]?.url ?? ''
      const state = new URL(captured).searchParams.get('state') ?? ''
      ui.prompt = originalPrompt
      return originalPrompt({ ...prompt, message: prompt.message })
        .then(() => `http://127.0.0.1${DEFAULT_OAUTH_REDIRECT_PATH}?code=pasted&state=${state}`)
    }
    await expect(ctx.authorization.begin({ key: RECORD_KEY, interaction: ui }))
      .resolves.toEqual({ status: 'authorized' })
    expect(ui.notices[0]?.url).toContain('code_challenge')
    expect(String(fetchImpl.mock.calls[0]?.[1]?.body)).toContain('client_secret=')
    expect(await ctx.credentials.readRecord(RECORD_KEY)).toMatchObject({
      kind: 'grant', payload: { version: 1, accessToken: 'at' },
    })
    await ctx.fiber.dispose()
  })

  it('completes PKCE through the Host callback, including an IPv6 bind address', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ access_token: 'host-at' }),
      { status: 200 },
    ))
    const ctx = new Context()
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ag-oauth-'))
    dirs.push(dir)
    await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
    await ctx.plugin(AuthorizationService)
    const web = new FakeWebServer(ctx, '::1', 8443, 'https:')
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(Antigravity, { baseURL: 'http://127.0.0.1:1' })
    const ui = surface()
    const pending = ctx.authorization.begin({ key: RECORD_KEY, interaction: ui })
    await vi.waitFor(() => { expect(web.routes.size).toBe(1) })
    const url = ui.notices[0]?.url
    expect(url).toContain(encodeURIComponent('https://[::1]:8443/oauth/antigravity/callback'))
    const state = new URL(url ?? '').searchParams.get('state') ?? ''
    const res = { status: 0, body: '', writeHead(status: number) { this.status = status; return this }, end(body?: string) { this.body = body ?? ''; return this } }
    web.routes.get(DEFAULT_OAUTH_REDIRECT_PATH)!({
      method: 'GET',
      url: `${DEFAULT_OAUTH_REDIRECT_PATH}?code=from-host&state=${state}`,
    } as IncomingMessage, res as unknown as ServerResponse)
    await expect(pending).resolves.toEqual({ status: 'authorized' })
    expect(res.status).toBe(200)
    expect(res.body).toContain('Signed in')
    expect(await ctx.credentials.readRecord(RECORD_KEY)).toMatchObject({
      payload: { accessToken: 'host-at' },
    })
    expect(web.routes.size).toBe(0)
    await ctx.fiber.dispose()
  })

  it('rejects a malformed Host callback and aborts a waiting attempt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ag-oauth-'))
    dirs.push(dir)
    const world = new Context()
    await world.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
    await world.plugin(AuthorizationService)
    const web = new FakeWebServer(world)
    await world.plugin(LlmRuntime)
    await world.plugin(Antigravity, { baseURL: 'http://127.0.0.1:1' })
    const ui = surface()
    const controller = new AbortController()
    const pending = world.authorization.begin({ key: RECORD_KEY, interaction: ui, signal: controller.signal })
    await vi.waitFor(() => { expect(web.routes.size).toBe(1) })
    const handler = web.routes.get(DEFAULT_OAUTH_REDIRECT_PATH)!
    const bad = { status: 0, writeHead(status: number) { this.status = status; return this }, end() { return this } }
    handler({ method: 'POST', url: DEFAULT_OAUTH_REDIRECT_PATH } as IncomingMessage, bad as unknown as ServerResponse)
    expect(bad.status).toBe(400)
    handler({ method: 'GET', url: 'http://[' } as IncomingMessage, bad as unknown as ServerResponse)
    expect(bad.status).toBe(400)
    handler({ method: 'GET' } as IncomingMessage, bad as unknown as ServerResponse)
    const state = new URL(ui.notices[0]?.url ?? '').searchParams.get('state') ?? ''
    controller.abort()
    handler({
      method: 'GET',
      url: `${DEFAULT_OAUTH_REDIRECT_PATH}?code=late&state=${state}`,
    } as IncomingMessage, bad as unknown as ServerResponse)
    expect(bad.status).toBe(410)
    await expect(pending).resolves.toEqual({ status: 'cancelled' })
    await world.fiber.dispose()
  })

  it('runs a direct PKCE prompt without a plugin mount', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ access_token: 'direct' }),
      { status: 200 },
    ))
    const ctx = new Context()
    const session = {
      method: 'oauth',
      signal: new AbortController().signal,
      notify: () => undefined,
      prompt: () => Promise.resolve('bare-code'),
      commit: vi.fn(() => Promise.resolve()),
    }
    await runPkce(ctx, session, connection())
    expect(session.commit).toHaveBeenCalledWith({
      kind: 'grant', payload: expect.objectContaining({ accessToken: 'direct' }) as unknown,
    })
  })
})

describe('aborted PKCE', () => {
  it('fails the Host callback wait when the session is already aborted', async () => {
    const ctx = new Context()
    new FakeWebServer(ctx)
    const controller = new AbortController()
    controller.abort()
    const session = {
      method: 'oauth',
      signal: controller.signal,
      notify: () => undefined,
      prompt: () => Promise.resolve('nope'),
      commit: () => Promise.resolve(),
    }
    await expect(runPkce(ctx, session, connection())).rejects.toMatchObject({ code: 'ABORTED' })
    await ctx.fiber.dispose()
  })
})
