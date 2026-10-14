/**
 * PKCE browser OAuth for the Antigravity grant stored at
 * `llm-antigravity/default`. A Host composition that mounts `webServer`
 * receives the callback on `oauthRedirectPath`; every other composition asks
 * the human to paste the redirected URL.
 *
 * @module dsh-llm-antigravity/oauth
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { deadline } from '@deepseek-ai/dsh-timeout'
import {
  OAUTH_SCOPES,
  PLUGIN_NAME,
  RECORD_ID,
  type ResolvedAntigravityConfig,
} from './config.ts'
import { asObject, oauthHttpError, transportError } from './errors.ts'

/** Credential key the adapter reads and the PKCE flow writes. */
export const RECORD_KEY = credentialKey(PLUGIN_NAME, RECORD_ID)

const IDLE_CODE = 'ANTIGRAVITY_OAUTH_IDLE'
const REQUEST_CODE = 'ANTIGRAVITY_OAUTH_TIMEOUT'

/** Versioned grant payload owned by this adapter. */
export interface AntigravityGrant {
  /** Payload version; readers reject any other value. */
  version: 1
  /** Bearer token sent on Cloud Code requests. */
  accessToken: string
  /** Refresh token, when the issuer supplied one. */
  refreshToken?: string
  /** Epoch milliseconds after which `accessToken` must be refreshed. */
  expiresAt?: number
  /** Token type from the issuer; omitted when it is Bearer. */
  tokenType?: string
}

/** Margin subtracted from `expiresAt` before a refresh is attempted. */
export const REFRESH_MARGIN_MS = 60_000

/**
 * Read a stored grant payload.
 * @param payload - the opaque credential-record payload.
 * @returns the grant, or undefined when the payload is absent or not this version.
 */
export function parseGrant(payload: unknown): AntigravityGrant | undefined {
  const object = asObject(payload)
  if (object === undefined || object.version !== 1 || typeof object.accessToken !== 'string' || object.accessToken.length === 0) {
    return undefined
  }
  const grant: AntigravityGrant = { version: 1, accessToken: object.accessToken }
  if (typeof object.refreshToken === 'string' && object.refreshToken.length > 0) grant.refreshToken = object.refreshToken
  if (typeof object.expiresAt === 'number' && Number.isFinite(object.expiresAt)) grant.expiresAt = object.expiresAt
  if (typeof object.tokenType === 'string' && object.tokenType.length > 0) grant.tokenType = object.tokenType
  return grant
}

/**
 * Whether the access token should be refreshed before the next request.
 * @param grant - stored grant.
 * @param now - epoch milliseconds; tests inject a clock.
 * @returns true when `expiresAt` is present and within the refresh margin.
 */
export function grantExpired(grant: AntigravityGrant, now = Date.now()): boolean {
  return grant.expiresAt !== undefined && grant.expiresAt - REFRESH_MARGIN_MS <= now
}

/**
 * Build the browser authorization URL for one PKCE attempt.
 * @param config - current OAuth endpoints and client id.
 * @param challenge - S256 code challenge.
 * @param state - opaque CSRF token.
 * @param redirectUri - exact redirect URI registered with the client.
 * @returns the complete authorize URL.
 */
export function buildAuthorizeUrl(
  config: Pick<ResolvedAntigravityConfig, 'oauthAuthorizeURL' | 'oauthClientId'>,
  challenge: string,
  state: string,
  redirectUri: string,
): string {
  const url = new URL(config.oauthAuthorizeURL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', config.oauthClientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('scope', OAUTH_SCOPES.join(' '))
  return url.href
}

/**
 * Build token-request fields, attaching the client secret when configured.
 * @param config - client id and secret.
 * @param fields - grant-specific token-request fields.
 * @returns urlencoded token-request fields.
 */
export function tokenRequestFields(
  config: Pick<ResolvedAntigravityConfig, 'oauthClientId' | 'oauthClientSecret'>,
  fields: Record<string, string>,
): Record<string, string> {
  return {
    ...fields,
    client_id: config.oauthClientId,
    ...config.oauthClientSecret.length === 0 ? {} : { client_secret: config.oauthClientSecret },
  }
}

/**
 * Exchange an authorization code or refresh token at the token endpoint.
 * @param config - token URL, client id, and request deadline.
 * @param body - urlencoded token-request fields.
 * @param signal - cancellation for this exchange.
 * @returns the stored grant image.
 */
export async function exchangeToken(
  config: Pick<ResolvedAntigravityConfig, 'oauthTokenURL' | 'oauthClientId' | 'requestTimeoutMs'>,
  body: Record<string, string>,
  signal: AbortSignal,
): Promise<AntigravityGrant> {
  using timer = deadline(signal, config.requestTimeoutMs, REQUEST_CODE)
  let response: Response
  try {
    response = await fetch(config.oauthTokenURL, {
      method: 'POST',
      signal: timer.signal,
      redirect: 'error',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(body),
    })
  } catch (error) {
    throw transportError(error, timer.signal, IDLE_CODE, REQUEST_CODE)
  }
  const text = await response.text()
  if (!response.ok) throw oauthHttpError(response.status, text)
  let raw: unknown
  try { raw = JSON.parse(text) }
  catch {
    throw new LlmError('Antigravity OAuth token response is not JSON', 'PROTOCOL', { status: response.status })
  }
  return grantFromTokenResponse(raw)
}

/**
 * Translate a token-endpoint JSON body into a stored grant.
 * @param raw - decoded token response.
 * @param now - current epoch milliseconds used to calculate expiry.
 * @returns the grant to commit.
 */
export function grantFromTokenResponse(raw: unknown, now = Date.now()): AntigravityGrant {
  const object = asObject(raw)
  if (object === undefined) {
    throw new LlmError('Antigravity OAuth token response omitted access_token', 'PROTOCOL')
  }
  const accessToken = typeof object.access_token === 'string' ? object.access_token : ''
  if (accessToken.length === 0) throw new LlmError('Antigravity OAuth token response omitted access_token', 'PROTOCOL')
  const grant: AntigravityGrant = { version: 1, accessToken }
  if (typeof object.refresh_token === 'string' && object.refresh_token.length > 0) grant.refreshToken = object.refresh_token
  if (typeof object.expires_in === 'number' && Number.isFinite(object.expires_in) && object.expires_in > 0) {
    grant.expiresAt = now + object.expires_in * 1000
  }
  if (typeof object.token_type === 'string' && object.token_type.length > 0) grant.tokenType = object.token_type
  return grant
}

/**
 * Register the Antigravity PKCE flow. No-op until `ctx.authorization` exists.
 * @param ctx - plugin context that may carry `ctx.authorization`.
 * @param options - live configuration reader for authorize/token endpoints.
 */
export function registerAntigravityFlow(
  ctx: Context,
  options: () => ResolvedAntigravityConfig,
): void {
  ctx.inject(['authorization'], (authorized) => {
    authorized.authorization.registerFlow({
      key: RECORD_KEY,
      label: 'Antigravity',
      methods: [{ id: 'oauth', label: 'Google' }],
      run: session => runPkce(authorized, session, options()),
    })
  })
}

/** Host HTTP server used only for the OAuth callback pathname. */
interface HostCallbackServer {
  readonly protocol: string
  readonly host: string
  readonly port: number | undefined
  register(route: {
    kind: 'exact'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void
  }): () => void
}

/**
 * Run one PKCE attempt through the Host callback or a pasted redirect URL.
 * @param ctx - context that may carry `webServer`.
 * @param session - authorization session for this attempt.
 * @param config - endpoints captured for this attempt.
 */
export async function runPkce(
  ctx: Context,
  session: AuthorizationSession,
  config: ResolvedAntigravityConfig,
): Promise<void> {
  const verifier = randomBytes(32).toString('base64url')
  const state = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const webServer = hostCallbackServer(ctx)
  const redirectUri = webServer === undefined
    ? `http://127.0.0.1${config.oauthRedirectPath}`
    : `${callbackOrigin(webServer)}${config.oauthRedirectPath}`
  const authorizeUrl = buildAuthorizeUrl(config, challenge, state, redirectUri)
  const code = webServer === undefined
    ? await promptForCode(session, authorizeUrl, state)
    : await waitForHostCallback(session, webServer, config.oauthRedirectPath, state, authorizeUrl)
  const grant = await exchangeToken(config, tokenRequestFields(config, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  }), session.signal)
  await session.commit({ kind: 'grant', payload: grant })
}

function hostCallbackServer(ctx: Context): HostCallbackServer | undefined {
  return ctx.get('webServer')
}

function callbackOrigin(webServer: HostCallbackServer): string {
  if (webServer.port === undefined) throw new Error('Antigravity OAuth requires a listening Host callback server')
  const host = webServer.host.includes(':') ? `[${webServer.host}]` : webServer.host
  return `${webServer.protocol}//${host}:${String(webServer.port)}`
}

async function promptForCode(session: AuthorizationSession, authorizeUrl: string, state: string): Promise<string> {
  session.notify({
    message: 'Open this page to continue signing in to Antigravity. After the browser redirects, paste the full URL.',
    url: authorizeUrl,
  })
  const pasted = await session.prompt({
    kind: 'text',
    message: 'Paste the redirected URL, or the authorization code, to finish signing in.',
  })
  return codeFromCallbackInput(pasted, state)
}

/**
 * Extract the authorization code from a pasted redirect URL or a bare code.
 * @param input - human-supplied callback URL or code.
 * @param state - CSRF token that a URL must echo.
 * @returns the authorization code.
 */
export function codeFromCallbackInput(input: string, state: string): string {
  const trimmed = input.trim()
  if (trimmed.length === 0) throw new LlmError('Antigravity OAuth callback was empty', 'PROTOCOL')
  if (!trimmed.includes('://')) return trimmed
  let url: URL
  try { url = new URL(trimmed) }
  catch {
    throw new LlmError('Antigravity OAuth callback URL is not a valid URL', 'PROTOCOL')
  }
  const receivedState = url.searchParams.get('state') ?? ''
  if (!safeEqual(receivedState, state) || url.searchParams.getAll('state').length !== 1) {
    throw new LlmError('Antigravity OAuth callback state mismatch', 'AUTH')
  }
  const code = url.searchParams.get('code')
  if (code === null || code.length === 0 || url.searchParams.getAll('code').length !== 1) {
    throw new LlmError('Antigravity OAuth callback omitted code', 'PROTOCOL')
  }
  return code
}

async function waitForHostCallback(
  session: AuthorizationSession,
  webServer: HostCallbackServer,
  path: string,
  state: string,
  authorizeUrl: string,
): Promise<string> {
  const received = Promise.withResolvers<string>()
  void received.promise.catch(() => undefined)
  const abort = (): void => { received.reject(new LlmError('Antigravity OAuth callback aborted', 'ABORTED')) }
  session.signal.addEventListener('abort', abort, { once: true })
  const dispose = webServer.register({
    kind: 'exact',
    path,
    handler: (req, res) => { handleCallback(req, res, path, state, session.signal, received) },
  })
  try {
    if (session.signal.aborted) throw new LlmError('Antigravity OAuth callback aborted', 'ABORTED')
    session.notify({
      message: 'Open this page to continue signing in to Antigravity.',
      url: authorizeUrl,
    })
    return await received.promise
  } finally {
    session.signal.removeEventListener('abort', abort)
    dispose()
  }
}

function handleCallback(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  state: string,
  signal: AbortSignal,
  received: PromiseWithResolvers<string>,
): void {
  const fail = (status: number): void => {
    res.writeHead(status, { 'cache-control': 'no-store' }).end()
  }
  let url: URL
  try { url = new URL(req.url ?? '/', 'http://127.0.0.1') }
  catch { fail(400); return }
  const receivedState = url.searchParams.get('state') ?? ''
  const code = url.searchParams.get('code')
  if (req.method !== 'GET' || url.pathname !== path || !safeEqual(receivedState, state)
    || url.searchParams.getAll('state').length !== 1 || code === null || code.length === 0
    || url.searchParams.getAll('code').length !== 1) {
    fail(400)
    return
  }
  if (signal.aborted) { fail(410); return }
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  }).end('<!doctype html><title>Antigravity</title><body><p>Signed in. You can close this tab.</p></body></html>')
  received.resolve(code)
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}
