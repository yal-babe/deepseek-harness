/**
 * Host Remote that reads Codex and Antigravity quota with stored OAuth grants
 * and returns browser-safe views. Named `providerQuota` so the method `get`
 * does not collide with Gateway reserved verbs.
 */

import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-credentials'
import {
  Config,
  fetchAntigravityQuotaForToken,
  resolveAccessToken,
  resolvedConfig,
  unsignedAntigravityQuota,
  type AntigravityQuotaSnapshot,
} from '@deepseek-ai/dsh-llm-antigravity'
import { LlmError } from '@deepseek-ai/dsh-llm'
import {
  accessTokenFromCodexGrant,
  consumeCodexRateLimitResetCredit,
  extractCodexChatgptAccountId,
  extractCodexSubscriptionActiveUntilMs,
  fetchCodexQuota,
  idTokenFromCodexGrant,
  recordKeyFor,
  unsignedCodexQuota,
  type CodexQuotaSnapshot,
} from '@deepseek-ai/dsh-llm-pi-ai'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  AntigravityQuotaView,
  ConsumeCodexResetResult,
  CodexQuotaView,
  ProviderQuotaView,
  QuotaProviderId,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    providerQuota: ProviderQuota
  }
}

/** Codex and Antigravity quota over stored Host grants. */
export class ProviderQuota extends TypertRemoteService {
  static inject = ['credentials']

  private readonly antigravityRefresh: { current?: Promise<string> } = {}

  /** @param ctx - Host with credentials; Antigravity refresh writes back through the same store. */
  constructor(ctx: Context) {
    super(ctx, 'providerQuota')
  }

  /**
   * Read one provider's safe quota view.
   * @param provider - `codex` or `antigravity`.
   * @returns unsigned when no grant is stored; ready or failed otherwise.
   */
  @Remote
  async get(provider: QuotaProviderId): Promise<ProviderQuotaView> {
    if (provider === 'codex') return await this.readCodex()
    if (provider === 'antigravity') return await this.readAntigravity()
    throw new RemoteError(
      'provider-quota/unknown-provider',
      `unknown quota provider "${String(provider)}"`,
      { provider: String(provider) },
    )
  }

  /**
   * Redeem one Codex rate-limit reset credit after the Client confirms.
   * Does not call CLI Proxy `resetCooldown`.
   * @returns whether WHAM accepted the redeem, plus the latest usage card.
   */
  @Remote
  async consumeCodexReset(): Promise<ConsumeCodexResetResult> {
    const grant = await this.codexAccess()
    if (grant === undefined) return { ok: false, quota: viewCodex(unsignedCodexQuota()) }
    const result = await consumeCodexRateLimitResetCredit({
      accessToken: grant.access,
      ...grant.accountId === undefined ? {} : { chatgptAccountId: grant.accountId },
      ...grant.subscriptionUntil === undefined ? {} : { subscriptionActiveUntil: grant.subscriptionUntil },
    })
    return { ok: result.ok, quota: viewCodex(result.quota) }
  }

  private async readCodex(): Promise<CodexQuotaView> {
    const grant = await this.codexAccess()
    if (grant === undefined) return viewCodex(unsignedCodexQuota())
    return viewCodex(await fetchCodexQuota({
      accessToken: grant.access,
      ...grant.accountId === undefined ? {} : { chatgptAccountId: grant.accountId },
      ...grant.subscriptionUntil === undefined ? {} : { subscriptionActiveUntil: grant.subscriptionUntil },
    }))
  }

  private async readAntigravity(): Promise<AntigravityQuotaView> {
    const connection = resolvedConfig(Config({}))
    try {
      const token = await resolveAccessToken(
        this.ctx,
        connection,
        AbortSignal.timeout(connection.requestTimeoutMs),
        this.antigravityRefresh,
      )
      return viewAntigravity(await fetchAntigravityQuotaForToken(connection, token))
    } catch (error: unknown) {
      if (error instanceof LlmError && (error.code === 'AUTH' || error.code === 'MISSING_CREDENTIAL')) {
        return viewAntigravity(unsignedAntigravityQuota())
      }
      return viewAntigravity({
        status: 'failed',
        plan: null,
        tierId: null,
        groups: [],
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private async codexAccess(): Promise<{
    access: string
    accountId?: string
    subscriptionUntil?: number
  } | undefined> {
    const record = await this.ctx.credentials.readRecord(recordKeyFor('openai-codex'))
    if (record === undefined || record.kind !== 'grant') return undefined
    const access = accessTokenFromCodexGrant(record.payload)
    if (access === undefined) return undefined
    const idToken = idTokenFromCodexGrant(record.payload)
    const accountId = extractCodexChatgptAccountId(access)
      ?? (idToken === undefined ? undefined : extractCodexChatgptAccountId(idToken))
    const subscriptionUntil = extractCodexSubscriptionActiveUntilMs(access)
      ?? (idToken === undefined ? undefined : extractCodexSubscriptionActiveUntilMs(idToken))
    return {
      access,
      ...accountId === undefined ? {} : { accountId },
      ...subscriptionUntil === undefined ? {} : { subscriptionUntil },
    }
  }
}

export default ProviderQuota

function viewCodex(snapshot: CodexQuotaSnapshot): CodexQuotaView {
  const view: CodexQuotaView = {
    provider: 'codex',
    status: snapshot.status,
    planType: snapshot.planType,
    subscriptionActiveUntilMs: snapshot.subscriptionActiveUntilMs,
    creditBalance: snapshot.creditBalance,
    creditsUnlimited: snapshot.creditsUnlimited,
    windows: snapshot.windows.map(window => ({
      id: window.id,
      kind: window.kind,
      group: window.group,
      featureName: window.featureName,
      remainingPercent: window.remainingPercent,
      resetAtMs: window.resetAtMs,
    })),
    resetCredits: snapshot.resetCredits,
    resetCreditsAvailableCount: snapshot.resetCreditsAvailableCount,
    models: snapshot.models,
  }
  if (snapshot.error !== undefined) view.error = snapshot.error
  return view
}

function viewAntigravity(snapshot: AntigravityQuotaSnapshot): AntigravityQuotaView {
  const view: AntigravityQuotaView = {
    provider: 'antigravity',
    status: snapshot.status,
    plan: snapshot.plan,
    tierId: snapshot.tierId,
    groups: snapshot.groups.map(group => ({
      id: group.id,
      label: group.label,
      buckets: group.buckets.map(bucket => ({
        id: bucket.id,
        kind: bucket.id === '5h' ? 'fiveHour' : bucket.id === 'weekly' ? 'weekly' : 'unknown',
        group: 'standard' as const,
        featureName: null,
        remainingPercent: bucket.remainingFraction === null ? null : Math.round(bucket.remainingFraction * 1000) / 10,
        resetAtMs: bucket.resetAtMs,
      })),
    })),
  }
  if (snapshot.error !== undefined) view.error = snapshot.error
  return view
}
