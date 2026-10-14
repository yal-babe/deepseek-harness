/** Codex and Antigravity OAuth controls on Models provider cards. */
import type { Context } from '@deepseek-ai/cordis'
import type { OAuthAttemptView } from '@deepseek-ai/dsh-llm-oauth-bridge/types'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import {
  authorizeBrowsingContextOpened,
  CodexOauthCard,
  type CodexOauthInjected,
} from './CodexOauthCard.tsx'
import { en, zh, type OauthKey } from './locales.ts'

export type { CodexOauthCardProps, CodexOauthInjected } from './CodexOauthCard.tsx'
export { authorizeBrowsingContextOpened, OAUTH_CARD_PROVIDERS } from './CodexOauthCard.tsx'
export type { OauthKey } from './locales.ts'

/** Credential record `llm-pi-ai` writes for the Codex route. */
const CODEX_OAUTH_KEY = 'llm-pi-ai/openai-codex'
/** Credential record `llm-antigravity` writes for the default Antigravity grant. */
const ANTIGRAVITY_OAUTH_KEY = 'llm-antigravity/default'

interface OauthAccountSeat {
  readonly settingsNs: string
  readonly credentialKey: string
}

const ACCOUNT_SEATS: readonly OauthAccountSeat[] = [
  { settingsNs: 'llm-pi-ai', credentialKey: CODEX_OAUTH_KEY },
  { settingsNs: 'llm-antigravity', credentialKey: ANTIGRAVITY_OAUTH_KEY },
]

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Codex and Antigravity OAuth copy on the Models provider card. */
    'settings.oauth': OauthKey
  }
}

const NS = 'settings.oauth'
const idle: OAuthAttemptView = { status: 'idle', inFlight: false, credentialConfigured: false }

/** Services required by OAuth account settings. */
export const inject = ['slots', 'locale', 'remote', 'remote.oauth']

function unwrap(result: RemoteResult<OAuthAttemptView>): OAuthAttemptView {
  if (!result.ok) throw result.error
  return result.value
}

/**
 * Watch one credential's OAuth projection and bind Host operations for its card.
 * @param ctx - client plugin context.
 * @param credentialKey - credential record address (`<scope>/<id>`).
 * @returns injected operations and a disposer for the watch stream.
 */
function bindOauth(ctx: Context, credentialKey: string): { operations: CodexOauthInjected; dispose: () => Promise<void> } {
  let snapshot: OAuthAttemptView = idle
  const listeners = new Set<() => void>()
  const publish = (value: OAuthAttemptView): void => {
    snapshot = value
    for (const listener of listeners) listener()
  }
  const stream = ctx.remote.$stream<OAuthAttemptView>({
    name: 'oauth',
    open: signal => ctx.remote.oauth.watch(credentialKey, signal),
    ended: () => new Error('oauth stream ended'),
  })
  let disposed = false
  void (async () => {
    for await (const frame of stream) {
      publish(frame.value)
      frame.accept()
    }
  })().catch(() => { if (!disposed) publish({ ...snapshot, status: 'failed', error: 'oauth stream ended' }) })

  return {
    operations: {
      hooks: {
        oauth: {
          getSnapshot: () => snapshot,
          subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
        },
      },
      async start() { publish(unwrap(await ctx.remote.oauth.start(credentialKey, 'oauth'))) },
      async cancel() { publish(unwrap(await ctx.remote.oauth.cancel(credentialKey))) },
      async signOut() { publish(unwrap(await ctx.remote.oauth.signOut(credentialKey))) },
      async answerPrompt(value) { publish(unwrap(await ctx.remote.oauth.answerPrompt(credentialKey, value))) },
      async declinePrompt() { publish(unwrap(await ctx.remote.oauth.declinePrompt(credentialKey))) },
      openAuthorizeUrl(url) {
        return authorizeBrowsingContextOpened(
          window.open(url, '_blank', 'noopener,noreferrer'),
          window.location.protocol,
        )
      },
    },
    dispose: async () => {
      disposed = true
      await stream.dispose()
    },
  }
}

/**
 * Register Codex and Antigravity sign-in controls on their Models provider cards.
 * @param ctx - client plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'ui-settings-oauth: dictionaries')
  const bindings = ACCOUNT_SEATS.map(seat => ({ seat, ...bindOauth(ctx, seat.credentialKey) }))
  ctx.effect(() => () => Promise.all(bindings.map(binding => binding.dispose())), 'ui-settings-oauth: state streams')

  ctx.slots.inject('settings.models.provider-card', () => bindings.map(({ seat, operations }) => ctx.slots.register({
    name: 'settings.models.provider-card',
    key: seat.settingsNs,
    locale: NS,
    inject: () => operations,
  }, CodexOauthCard)))
}
