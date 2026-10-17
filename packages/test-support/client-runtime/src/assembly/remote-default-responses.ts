/**
 * Default responses for every Remote endpoint the web assembly calls while
 * booting and rendering with no sessions, no workspaces, and default settings.
 * The comment above each row names the plugin that calls it; endpoints boot
 * never touches stay absent so a new call fails loud. `$events` is built into
 * `RemoteMock`.
 * @module @deepseek-ai/dsh-client-test-runtime/src/assembly/remote-default-responses
 */
import { ok, openStream, type RemoteTable } from '@deepseek-ai/dsh-remote-mock'

const studioSignedOut = { origin: '', identity: null, phase: 'signed-out' as const, usedBytes: null, quotaBytes: null, pending: 0 }

/** Default responses of the boot-time Remote endpoints; a spec loads it first and layers its own table on top. */
export const remoteDefaultResponses: RemoteTable = {
  unary: {
    // Independent Studio account status, read on an explicit account opener.
    'studioCloud/getState': ok(studioSignedOut),
    // api-session-controller `sessions.handleConnected()` on `connection/reset`.
    'session/list': ok({ items: [] }),
    // ui-workspace startup with no entries; first-use initialization is ineligible.
    'workspace/initializeDefault': ok(undefined),
    // ui-settings `mirror.ensure()` at apply and again on `connection/reset`.
    'settings/describe': ok({ writable: true, hasDocument: false, namespaces: [] }),
    // ui-model-selection `ModelDirectoryResolver` constructor.
    'session/modelCatalog': ok({
      default: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      routableProviders: [],
      groups: [],
      failures: [],
    }),
    // ui-agent-preset hero chip and header label on first mount.
    'agentPresets/list': ok({ presets: [] }),
    // cordis-client-runner `ClientCordisInspectRegistry.sync` at apply and on `connection/reset`.
    'dynamicCordisRunner/syncInspectManifest': ok(null),
    // ui-cordis inventory at apply and on `connection/reset`.
    'dynamicCordisRunner/inventory': ok([]),
    // ui-settings-plugins web-search card `readCredential()` when the settings mirror first publishes.
    'credentials/describe': ok({}),
    // ui-permission-presets `PermissionCatalogDirectory` on its first read for a connection generation.
    'permissionPresets/catalog': ok({ options: [] }),
    // ui-settings-account refreshes details after a stored-grant snapshot.
    'account/getProfile': ok(null),
    'account/getBalance': ok(null),
    // ui-settings-account bonus notice read and acknowledgement at signing in.
    'account/getUnnotifiedBonuses': ok(null),
    'account/ackBonusNotified': ok(true),
    // ui-settings-oauth reads Codex attempt state at apply.
    'oauth/getState': ok({ status: 'idle', inFlight: false, credentialConfigured: false }),
    // ui-settings-account and ui-personal-center quota cards.
    'providerQuota/get': (provider: 'codex' | 'antigravity') => ok(provider === 'antigravity'
      ? { provider: 'antigravity', status: 'unsigned', plan: null, tierId: null, groups: [] }
      : {
        provider: 'codex',
        status: 'unsigned',
        planType: null,
        subscriptionActiveUntilMs: null,
        creditBalance: null,
        creditsUnlimited: false,
        windows: [],
        resetCredits: [],
        resetCreditsAvailableCount: null,
        models: [],
      }),
    'providerQuota/consumeCodexReset': ok({
      ok: false,
      quota: {
        provider: 'codex',
        status: 'unsigned',
        planType: null,
        subscriptionActiveUntilMs: null,
        creditBalance: null,
        creditsUnlimited: false,
        windows: [],
        resetCredits: [],
        resetCreditsAvailableCount: null,
        models: [],
      },
    }),
    // ui-personal-center Host usage fold.
    'usageStats/snapshot': ok({
      timezoneOffsetSeconds: 0,
      generatedAt: 0,
      totals: { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
      sessionCount: 0,
      toolCalls: 0,
      days: [],
      models: [],
      tools: [],
      sessions: [],
    }),
  },
  // Stream endpoints the roster opens later than boot; declared so a spec that forgets the script gets a stream miss.
  streams: [
    // api-session-controller `SessionEventStream.follow` when a Session opens.
    'session/follow',
  ],
  stream: {
    // api-session-controller client `apply`: the control stream's opening baseline, then open.
    'session/control': openStream([{ type: 'baseline', value: { projections: {} } }]),
    // ui-settings-account shares the account snapshot across settings and the sidebar menu.
    'studioCloud/watch': openStream([studioSignedOut]),
    // ui-pet store subscribes to the Host pet snapshot at apply.
    'pet/watch': openStream([{ revision: 1, primary: 'IDLE', sessions: [], pending: [], jobs: [], visible: true }]),
    'account/watch': openStream([{ status: 'signed-out', attempt: null, links: { usageUrl: 'https://platform.deepseek.com/usage', topUpUrl: 'https://platform.deepseek.com/top_up' } }]),
    // ui-settings-oauth watches the Codex credential key from apply.
    'oauth/watch': openStream([{ status: 'idle', inFlight: false, credentialConfigured: false }]),
    // api-workspace-controller client `apply`: the follow stream's opening baseline, then open.
    'workspace/follow': openStream([{ type: 'baseline', value: { items: [], archivedSessionIds: [], pinnedSessionIds: [] } }]),
    // api-remote-access client `mountAccess`: the owner's access snapshot, then open.
    'remoteAccess/follow': openStream([{ type: 'baseline', owner: true }]),
  },
}
