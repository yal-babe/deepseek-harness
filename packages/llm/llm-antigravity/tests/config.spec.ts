import { describe, expect, it } from 'vitest'
import {
  Config,
  DEFAULT_API_KEY_ENV,
  DEFAULT_BASE_URL,
  DEFAULT_OAUTH_AUTHORIZE_URL,
  DEFAULT_OAUTH_CLIENT_ID,
  DEFAULT_OAUTH_CLIENT_SECRET,
  DEFAULT_OAUTH_REDIRECT_PATH,
  DEFAULT_OAUTH_TOKEN_URL,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  resolvedConfig,
} from '../src/config.ts'

describe('Antigravity Config', () => {
  it('applies published defaults', () => {
    const snapshot = resolvedConfig(Config({}))
    expect(snapshot).toMatchObject({
      baseURL: DEFAULT_BASE_URL,
      oauthAuthorizeURL: DEFAULT_OAUTH_AUTHORIZE_URL,
      oauthTokenURL: DEFAULT_OAUTH_TOKEN_URL,
      oauthClientId: DEFAULT_OAUTH_CLIENT_ID,
      oauthClientSecret: DEFAULT_OAUTH_CLIENT_SECRET,
      oauthRedirectPath: DEFAULT_OAUTH_REDIRECT_PATH,
      apiKeyEnv: DEFAULT_API_KEY_ENV,
      models: [],
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
      generationTimeoutMs: 600_000,
      streamIdleTimeoutMs: DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    })
  })

  it('resolves generation deadlines independently of ordinary request deadlines', () => {
    const snapshot = resolvedConfig(Config({ requestTimeoutMs: 1000, generationTimeoutMs: 900_000 }))
    expect(snapshot.requestTimeoutMs).toBe(1000)
    expect(snapshot.generationTimeoutMs).toBe(900_000)
    expect(() => Config({ generationTimeoutMs: 0 })).toThrow()
  })

  it('strips a trailing slash from baseURL and prefixes oauthRedirectPath', () => {
    const snapshot = resolvedConfig(Config({
      baseURL: 'https://example.test/v1/',
      oauthRedirectPath: 'oauth/custom',
      models: [{ id: 'm', name: 'M' }],
    }))
    expect(snapshot.baseURL).toBe('https://example.test/v1')
    expect(snapshot.oauthRedirectPath).toBe('/oauth/custom')
    expect(snapshot.models).toEqual([{ id: 'm', name: 'M' }])
  })
})
