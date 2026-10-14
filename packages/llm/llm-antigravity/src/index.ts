/**
 * Antigravity Cloud Code adapter: one `antigravity` provider route,
 * PKCE browser sign-in, and an API-key fallback.
 *
 * ```yaml
 * - id: llm-antigravity
 *   name: '@deepseek-ai/dsh-llm-antigravity'
 *   config:
 *     baseURL: https://daily-cloudcode-pa.googleapis.com/v1
 *     apiKeyEnv: ANTIGRAVITY_API_KEY
 * ```
 *
 * @module @deepseek-ai/dsh-llm-antigravity
 */
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { Context } from '@deepseek-ai/cordis'
import { AntigravityAdapter, antigravityCatalogVisible, resolveAccessToken } from './adapter.ts'
import { Config, PLUGIN_NAME, PROVIDER, resolvedConfig } from './config.ts'
import { registerAntigravityFlow } from './oauth.ts'

export {
  AntigravityAdapter,
  antigravityCatalogVisible,
  catalogModelInfo,
  serializeRequest,
  translateSse,
} from './adapter.ts'
export type { AntigravityAdapterOptions } from './adapter.ts'
export {
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
  OAUTH_SCOPES,
  PLUGIN_NAME,
  PROVIDER,
  RECORD_ID,
  resolvedConfig,
} from './config.ts'
export type { AntigravityCatalogModel, ResolvedAntigravityConfig } from './config.ts'
export { providerHttpError, transportError } from './errors.ts'
export {
  buildAuthorizeUrl,
  codeFromCallbackInput,
  exchangeToken,
  grantExpired,
  grantFromTokenResponse,
  parseGrant,
  RECORD_KEY,
  REFRESH_MARGIN_MS,
  registerAntigravityFlow,
  runPkce,
  tokenRequestFields,
} from './oauth.ts'
export type { AntigravityGrant } from './oauth.ts'

/** Function-plugin name; also the credential-record scope. */
export const name = PLUGIN_NAME
/** Required injection; authorization, credentials, and webServer are optional. */
export const inject = ['llm']

/**
 * Register the `antigravity` adapter, its configurable-provider directory, and
 * the PKCE sign-in flow when `ctx.authorization` is mounted.
 * @param ctx - plugin context carrying `ctx.llm`.
 * @param config - validated deployment options.
 */
export function apply(ctx: Context, config: Config): void {
  const options = () => resolvedConfig(config)
  options()
  const refreshing: { current?: Promise<string> } = {}
  const adapter = new AntigravityAdapter({
    options,
    resolveAccessToken: (connection, signal) => resolveAccessToken(ctx, connection, signal, refreshing),
    hasSelectableCredential: () => antigravityCatalogVisible(ctx, options()),
  })
  ctx.llm.registerAdapter([PROVIDER], adapter)
  ctx.llm.registerConfigurableProviders([{
    provider: PROVIDER,
    displayName: 'Antigravity',
    settingsNs: ctx.fiber.entry?.options.id ?? name,
    settingsPath: [],
  }])
  registerAntigravityFlow(ctx, options)
}
