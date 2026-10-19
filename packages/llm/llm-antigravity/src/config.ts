/** Plugin configuration and per-request snapshots for the Antigravity adapter. */
import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** Registered provider route this adapter serves. */
export const PROVIDER = 'antigravity'

/** Plugin name and credential-record scope. */
export const PLUGIN_NAME = 'llm-antigravity'

/** Credential-record id written by the PKCE flow and read by every request. */
export const RECORD_ID = 'default'

/** Default Cloud Code root for consumer listing and generate. */
export const DEFAULT_BASE_URL = 'https://daily-cloudcode-pa.googleapis.com/v1'

/** Google OAuth authorization endpoint used by Antigravity sign-in. */
export const DEFAULT_OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'

/** Google OAuth token endpoint used by authorization-code exchange and refresh. */
export const DEFAULT_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'

/**
 * Public OAuth client id for Antigravity. A deployment that registered its own
 * client replaces this value and `oauthClientSecret`.
 */
export const DEFAULT_OAUTH_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com'

/**
 * Published installed-app secret for {@link DEFAULT_OAUTH_CLIENT_ID}. Google's
 * token endpoint requires it with this client; it is not a deployment secret.
 */
export const DEFAULT_OAUTH_CLIENT_SECRET = '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'

/** Host callback pathname registered on `ctx.webServer` when that service exists. */
export const DEFAULT_OAUTH_REDIRECT_PATH = '/oauth/antigravity/callback'

/** Credential reference resolved when no stored grant authenticates the request. */
export const DEFAULT_API_KEY_ENV = 'ANTIGRAVITY_API_KEY'

/** Default deadline for one HTTP request, including token exchange. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

/** Default maximum idle interval while one stream read is outstanding. */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000

/** OAuth scopes requested by the Antigravity browser flow. */
export const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
] as const

/** One advisory catalog entry advertised through `listModels()`. */
export interface AntigravityCatalogModel {
  /** Model id sent as `GenerateOptions.model` and on the wire. */
  id: string
  /** Selector label; omitted entries use `id`. */
  name?: string
  /** Optional distinction shown beside otherwise similar models. */
  description?: string
  /** Combined request and response context in tokens, when disclosed. */
  contextWindow?: number
}

/** Live plugin configuration. Volatile fields are read per request. */
export interface Config {
  /**
   * Cloud Code root for listing and generate. The default is the consumer daily
   * host; production `cloudcode-pa` is for enterprise deployments.
   */
  baseURL: Volatile<string>
  /** Browser authorization endpoint. */
  oauthAuthorizeURL: Volatile<string>
  /** Token exchange and refresh endpoint. */
  oauthTokenURL: Volatile<string>
  /** OAuth client id sent on authorize and token requests. */
  oauthClientId: Volatile<string>
  /** OAuth client secret sent on token requests; empty omits the field. */
  oauthClientSecret: Volatile<string>
  /** Exact pathname registered as the Host OAuth callback. */
  oauthRedirectPath: Volatile<string>
  /** Credential reference used when no grant is stored. */
  apiKeyEnv: Volatile<string>
  /**
   * Advisory catalog. An empty list (the default) loads the Cloud Code
   * companion project then POSTs `v1internal:fetchAvailableModels` after
   * sign-in. A non-empty list replaces that listing.
   */
  models: Volatile<AntigravityCatalogModel[]>
  /** Deadline for non-generation HTTP requests, including token exchange and refresh. */
  requestTimeoutMs: Volatile<number>
  /** Total generation deadline, including setup and streamed output. */
  generationTimeoutMs: Volatile<number>
  /** Maximum age of the credential-scoped model catalog before background refresh. */
  catalogMaxAgeMs: Volatile<number>
  /** Maximum provider idle time while one stream read is outstanding. */
  streamIdleTimeoutMs: Volatile<number>
}

const catalogModel: z<AntigravityCatalogModel> = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
})

/** Validated deployment choices for the Antigravity adapter. */
export const Config = z.object({
  baseURL: z.string().default(DEFAULT_BASE_URL).volatile(),
  oauthAuthorizeURL: z.string().default(DEFAULT_OAUTH_AUTHORIZE_URL).volatile(),
  oauthTokenURL: z.string().default(DEFAULT_OAUTH_TOKEN_URL).volatile(),
  oauthClientId: z.string().default(DEFAULT_OAUTH_CLIENT_ID).volatile(),
  oauthClientSecret: z.string().role('secret').default(DEFAULT_OAUTH_CLIENT_SECRET).volatile(),
  oauthRedirectPath: z.string().default(DEFAULT_OAUTH_REDIRECT_PATH).volatile(),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV).volatile(),
  models: z.array(catalogModel).default([]).volatile(),
  requestTimeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_REQUEST_TIMEOUT_MS).volatile(),
  generationTimeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(600_000).volatile(),
  catalogMaxAgeMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(300_000).volatile(),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS).volatile(),
})

/** Detached connection facts captured for one operation. */
export interface ResolvedAntigravityConfig {
  /** Cloud Code root without a trailing slash. */
  baseURL: string
  /** Browser authorization endpoint. */
  oauthAuthorizeURL: string
  /** Token exchange and refresh endpoint. */
  oauthTokenURL: string
  /** OAuth client id. */
  oauthClientId: string
  /** OAuth client secret; empty omits `client_secret` from token requests. */
  oauthClientSecret: string
  /** Host callback pathname, always absolute. */
  oauthRedirectPath: string
  /** Credential reference for the API-key fallback. */
  apiKeyEnv: string
  /** Detached advisory catalog; empty means list Cloud Code at request time. */
  models: AntigravityCatalogModel[]
  /** Non-generation HTTP request deadline in milliseconds. */
  requestTimeoutMs: number
  /** Total generation deadline in milliseconds, including setup and streamed output. */
  generationTimeoutMs: number
  /** Model catalog freshness in milliseconds. */
  catalogMaxAgeMs: number
  /** Stream idle deadline in milliseconds. */
  streamIdleTimeoutMs: number
}

/**
 * Read the current value behind every Config reference.
 * @param config - live plugin configuration.
 * @returns detached connection facts for one operation.
 */
export function resolvedConfig(config: Config): ResolvedAntigravityConfig {
  const path = config.oauthRedirectPath.get()
  return {
    baseURL: config.baseURL.get().replace(/\/+$/u, ''),
    oauthAuthorizeURL: config.oauthAuthorizeURL.get(),
    oauthTokenURL: config.oauthTokenURL.get(),
    oauthClientId: config.oauthClientId.get(),
    oauthClientSecret: config.oauthClientSecret.get(),
    oauthRedirectPath: path.startsWith('/') ? path : `/${path}`,
    apiKeyEnv: config.apiKeyEnv.get(),
    models: config.models.get().map(model => ({ ...model })),
    requestTimeoutMs: config.requestTimeoutMs.get(),
    generationTimeoutMs: config.generationTimeoutMs.get(),
    catalogMaxAgeMs: config.catalogMaxAgeMs.get(),
    streamIdleTimeoutMs: config.streamIdleTimeoutMs.get(),
  }
}
