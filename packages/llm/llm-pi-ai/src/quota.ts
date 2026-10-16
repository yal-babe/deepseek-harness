/**
 * Codex WHAM quota parse and fetch, aligned with CLI Proxy Management Center
 * `fetchCodexQuota` / `consumeCodexRateLimitResetCredit`. Tokens stay on Host.
 *
 * @module dsh-llm-pi-ai/quota
 */

import { randomUUID } from 'node:crypto'
import { catalogProvider } from './catalog.ts'

/** ChatGPT WHAM usage endpoint. */
export const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
/** ChatGPT subscription lookup; failure does not block the usage card. */
export const CODEX_SUBSCRIPTION_URL = 'https://chatgpt.com/backend-api/subscriptions'
/** Available Codex rate-limit reset credits. */
export const CODEX_RATE_LIMIT_RESET_CREDITS_URL =
  'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits'
/** Consume one reset credit. */
export const CODEX_CONSUME_RESET_URL =
  'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume'
/** Models available to the signed-in ChatGPT Codex subscription. */
export const CODEX_MODELS_URL = 'https://chatgpt.com/backend-api/codex/models'

const FIVE_HOURS_SECONDS = 18_000
const WEEK_SECONDS = 604_800
const DAY_SECONDS = 86_400
const SUBSCRIPTION_TIMEOUT_MS = 8_000
const DEFAULT_TIMEOUT_MS = 20_000

/** One Codex rate-limit window shown as remaining percent. */
export interface CodexQuotaWindow {
  /** Stable id for React keys: `primary` / `secondary` / `code-review` / additional key. */
  id: string
  /** Window kind used by the UI dictionary. */
  kind: 'fiveHour' | 'weekly' | 'monthly' | 'unknown'
  /** WHAM group: primary rate limit, code-review, or an additional metered feature. */
  group: 'standard' | 'codeReview' | 'additional'
  /** Additional feature name when `group` is `additional`; otherwise null. */
  featureName: string | null
  /** Remaining percent `100 - used_percent`; null when unused. */
  remainingPercent: number | null
  /** Used percent from WHAM; null when unused. */
  usedPercent: number | null
  /** Absolute reset instant, or null. */
  resetAtMs: number | null
  /** Window length in seconds when WHAM reported one. */
  windowSeconds: number | null
}

/** One model the current Codex subscription can list. */
export interface CodexSubscriptionModel {
  /** Wire slug. */
  id: string
  /** Display name when WHAM supplied one. */
  name: string | null
}

/** One available Codex rate-limit reset credit. */
export interface CodexResetCredit {
  /** Opaque credit id from WHAM when present. */
  id: string
  /** Absolute expiry; null when WHAM omitted one. */
  expiresAtMs: number | null
}

/** Safe Codex quota view: no tokens. */
export interface CodexQuotaSnapshot {
  /** Whether a stored oauth grant was present. */
  status: 'unsigned' | 'ready' | 'failed'
  /** WHAM `plan_type`, or null. */
  planType: string | null
  /** Subscription end, from subscriptions or the id_token. */
  subscriptionActiveUntilMs: number | null
  /** Credit balance string when WHAM reports a finite balance. */
  creditBalance: string | null
  /** True when WHAM reports unlimited credits. */
  creditsUnlimited: boolean
  /** Primary, secondary, code-review, and additional windows. */
  windows: CodexQuotaWindow[]
  /** Available `codex_rate_limits` reset credits. */
  resetCredits: CodexResetCredit[]
  /** Count from the credits list, else WHAM `available_count`. */
  resetCreditsAvailableCount: number | null
  /** Subscription catalog entries whose visibility is not hidden. */
  models: CodexSubscriptionModel[]
  /** Catalog query failed independently of the usage request. */
  modelsError?: string
  /** Host-safe failure text when `status` is `failed`. */
  error?: string
}

/** Dependencies a Host caller injects so tests substitute fetch and time. */
export interface CodexQuotaFetchOptions {
  /** Bearer access token from the stored openai-codex grant. */
  accessToken: string
  /** Optional ChatGPT account id from the id_token. */
  chatgptAccountId?: string
  /** Fallback subscription end from the id_token, Unix seconds or ISO. */
  subscriptionActiveUntil?: unknown
  /** HTTP implementation; defaults to global fetch. */
  fetchImpl?: typeof fetch
  /** Clock for relative `reset_after_seconds`; defaults to Date.now. */
  nowMs?: number
}

/**
 * Read the oauth access token from a stored pi-ai openai-codex grant payload.
 * @param payload - credential-record payload.
 * @returns the access token, or undefined when the payload is not this grant.
 */
export function accessTokenFromCodexGrant(payload: unknown): string | undefined {
  const grant = asObject(payload)
  if (grant === undefined || grant.type !== 'oauth') return undefined
  return typeof grant.access === 'string' && grant.access.length > 0 ? grant.access : undefined
}

/**
 * Read a ChatGPT id_token from a stored openai-codex grant when the payload carries one.
 * @param payload - credential-record payload.
 * @returns the id_token, or undefined.
 */
export function idTokenFromCodexGrant(payload: unknown): string | undefined {
  const grant = asObject(payload)
  if (grant === undefined || grant.type !== 'oauth') return undefined
  if (typeof grant.id_token === 'string' && grant.id_token.length > 0) return grant.id_token
  if (typeof grant.idToken === 'string' && grant.idToken.length > 0) return grant.idToken
  return undefined
}

/**
 * Decode a JWT payload object without verifying the signature.
 * @param token - compact JWT.
 * @returns the payload object, or undefined.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.')
  const encoded = parts[1]
  if (encoded === undefined) return undefined
  try {
    return asObject(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')))
  } catch (_invalidJwt) {
    return undefined
  }
}

/**
 * Read `chatgpt_account_id` from a ChatGPT id_token or access token payload.
 * @param token - compact JWT.
 * @returns the account id, or undefined.
 */
export function extractCodexChatgptAccountId(token: string): string | undefined {
  const payload = decodeJwtPayload(token)
  if (payload === undefined) return undefined
  if (typeof payload.chatgpt_account_id === 'string' && payload.chatgpt_account_id.length > 0) {
    return payload.chatgpt_account_id
  }
  const auth = asObject(payload['https://api.openai.com/auth'])
  if (typeof auth?.chatgpt_account_id === 'string' && auth.chatgpt_account_id.length > 0) {
    return auth.chatgpt_account_id
  }
  return undefined
}

/**
 * Read ChatGPT subscription end from a JWT payload.
 * @param token - compact JWT.
 * @returns epoch milliseconds, or undefined.
 */
export function extractCodexSubscriptionActiveUntilMs(token: string): number | undefined {
  const payload = decodeJwtPayload(token)
  if (payload === undefined) return undefined
  const auth = asObject(payload['https://api.openai.com/auth'])
  return instantMs(payload.chatgpt_subscription_active_until) ?? instantMs(auth?.chatgpt_subscription_active_until)
}

/**
 * Parse a WHAM usage JSON body into windows, credits, and reset-credit count.
 * Accepts snake_case and camelCase keys.
 * @param raw - decoded JSON.
 * @param nowMs - clock for relative reset offsets.
 * @returns parsed fields; missing members become null/empty.
 */
export function parseCodexUsage(
  raw: unknown,
  nowMs = Date.now(),
): Pick<
  CodexQuotaSnapshot,
  'planType' | 'creditBalance' | 'creditsUnlimited' | 'windows' | 'resetCreditsAvailableCount'
> {
  const data = asObject(raw) ?? {}
  const planType = stringOf(pick(data, 'plan_type', 'planType'))
  const credits = asObject(pick(data, 'credits'))
  const unlimited = credits?.unlimited === true
  const balance = credits === undefined ? null : stringOf(pick(credits, 'balance', 'remaining'))
  const windows: CodexQuotaWindow[] = []
  pushClassifiedWindows(windows, asObject(pick(data, 'rate_limit', 'rateLimit')), 'standard', null, nowMs)
  pushClassifiedWindows(
    windows,
    asObject(pick(data, 'code_review_rate_limit', 'codeReviewRateLimit')),
    'codeReview',
    null,
    nowMs,
  )
  const additionalRaw = pick(data, 'additional_rate_limits', 'additionalRateLimits')
  if (Array.isArray(additionalRaw)) {
    additionalRaw.forEach((item, index) => {
      const row = asObject(item)
      if (row === undefined) return
      const feature = stringOf(pick(row, 'limit_name', 'limitName', 'metered_feature', 'meteredFeature'))
        ?? `additional-${String(index + 1)}`
      const nested = asObject(pick(row, 'rate_limit', 'rateLimit')) ?? row
      pushClassifiedWindows(windows, nested, 'additional', feature, nowMs)
    })
  } else {
    const additional = asObject(additionalRaw)
    if (additional !== undefined) {
      for (const [key, value] of Object.entries(additional)) {
        const nested = asObject(value)
        const rate = nested === undefined ? undefined : asObject(pick(nested, 'rate_limit', 'rateLimit')) ?? nested
        pushClassifiedWindows(windows, rate, 'additional', key, nowMs)
      }
    }
  }
  const resetEnvelope = asObject(pick(data, 'rate_limit_reset_credits', 'rateLimitResetCredits'))
  const availableCount = integerOf(pick(resetEnvelope ?? {}, 'available_count', 'availableCount'))
  return {
    planType,
    creditBalance: unlimited ? null : balance,
    creditsUnlimited: unlimited,
    windows,
    resetCreditsAvailableCount: availableCount,
  }
}

/**
 * Keep reset credits whose type is `codex_rate_limits` and status is `available`.
 * @param raw - decoded JSON array or `{ credits: [] }`.
 * @returns available credits in list order.
 */
export function parseCodexResetCredits(raw: unknown): CodexResetCredit[] {
  const rows = Array.isArray(raw) ? raw : asArray(asObject(raw)?.credits ?? asObject(raw)?.items)
  const credits: CodexResetCredit[] = []
  for (const row of rows) {
    const item = asObject(row)
    if (item === undefined) continue
    const resetType = stringOf(pick(item, 'reset_type', 'resetType'))
    const status = stringOf(pick(item, 'status'))
    if (resetType !== 'codex_rate_limits' || status !== 'available') continue
    const id = stringOf(pick(item, 'id', 'credit_id', 'creditId')) ?? `credit-${String(credits.length)}`
    credits.push({ id, expiresAtMs: instantMs(pick(item, 'expires_at', 'expiresAt')) ?? null })
  }
  return credits
}

/**
 * Parse ChatGPT subscriptions JSON for `active_until`.
 * @param raw - decoded JSON.
 * @returns epoch milliseconds, or undefined.
 */
export function parseCodexSubscriptionActiveUntilMs(raw: unknown): number | undefined {
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed.length === 0) return undefined
    try { return parseCodexSubscriptionActiveUntilMs(JSON.parse(trimmed) as unknown) }
    catch (_invalidSubscriptionJson) { return instantMs(trimmed) }
  }
  const data = asObject(raw)
  if (data === undefined) {
    if (Array.isArray(raw)) {
      for (const item of raw) {
        const until = parseCodexSubscriptionActiveUntilMs(item)
        if (until !== undefined) return until
      }
    }
    return undefined
  }
  const direct = instantMs(pick(data, 'active_until', 'activeUntil', 'chatgpt_subscription_active_until'))
  if (direct !== undefined) return direct
  for (const key of ['items', 'subscriptions', 'data', 'subscription', 'https://api.openai.com/auth'] as const) {
    const nested = data[key]
    for (const item of Array.isArray(nested) ? nested : [nested]) {
      const until = parseCodexSubscriptionActiveUntilMs(item)
      if (until !== undefined) return until
    }
  }
  return undefined
}

/**
 * Keep Codex catalog rows whose visibility is not hidden.
 * @param raw - decoded JSON array or `{ models | items | data }`.
 * @returns visible models in list order.
 */
export function parseCodexSubscriptionModels(raw: unknown): CodexSubscriptionModel[] {
  const rows = Array.isArray(raw)
    ? raw
    : asArray(asObject(raw)?.models ?? asObject(raw)?.items ?? asObject(raw)?.data)
  const models: CodexSubscriptionModel[] = []
  for (const row of rows) {
    const item = asObject(row)
    if (item === undefined) continue
    const visibility = (stringOf(pick(item, 'visibility')) ?? 'list').toLowerCase()
    if (visibility === 'hide' || visibility === 'hidden') continue
    const id = stringOf(pick(item, 'slug', 'id'))
    if (id === null) continue
    models.push({ id, name: stringOf(pick(item, 'display_name', 'displayName', 'name')) })
  }
  return models
}

/**
 * Whether a consume response is a successful redeem (`reset` or `already_redeemed`).
 * @param raw - decoded JSON.
 * @returns True if consume response is successful or already redeemed.
 */
export function isCodexConsumeSuccess(raw: unknown): boolean {
  const code = stringOf(asObject(raw)?.code)
  return code === 'reset' || code === 'already_redeemed'
}

/**
 * Fetch usage, subscriptions, and reset credits for one stored grant.
 * @param options - access token and optional JWT-derived account facts.
 * @returns a ready snapshot, or failed with a Host-safe message.
 */
export async function fetchCodexQuota(options: CodexQuotaFetchOptions): Promise<CodexQuotaSnapshot> {
  const fetchImpl = options.fetchImpl ?? fetch
  const nowMs = options.nowMs ?? Date.now()
  const headers = codexHeaders(options.accessToken, options.chatgptAccountId)
  try {
    const [resetCredits, subscriptionMs, models] = await Promise.all([
      loadResetCredits(fetchImpl, headers),
      loadSubscriptionMs(fetchImpl, options),
      loadSubscriptionModels(fetchImpl, headers),
    ])
    const tokenUntil = instantMs(options.subscriptionActiveUntil)
      ?? (options.accessToken.length > 0 ? extractCodexSubscriptionActiveUntilMs(options.accessToken) : undefined)
    const usageResponse = await fetchImpl(CODEX_USAGE_URL, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    })
    const usageText = await usageResponse.text()
    if (!usageResponse.ok) {
      return { ...failedQuota(`usage HTTP ${String(usageResponse.status)}`),
        subscriptionActiveUntilMs: subscriptionMs ?? tokenUntil ?? null, ...models }
    }
    let usageRaw: unknown
    try { usageRaw = JSON.parse(usageText) }
    catch (_invalidUsageJson) { return failedQuota('usage JSON is invalid') }
    const usage = parseCodexUsage(usageRaw, nowMs)
    const count = resetCredits.length > 0 ? resetCredits.length : usage.resetCreditsAvailableCount
    return {
      status: 'ready',
      planType: usage.planType,
      subscriptionActiveUntilMs: subscriptionMs ?? tokenUntil ?? null,
      creditBalance: usage.creditBalance,
      creditsUnlimited: usage.creditsUnlimited,
      windows: usage.windows,
      resetCredits,
      resetCreditsAvailableCount: count,
      ...models,
    }
  } catch (error: unknown) {
    return failedQuota(error instanceof Error ? error.message : String(error))
  }
}

/**
 * Redeem one available Codex rate-limit reset credit, then reload usage.
 * @param options - access token used for consume and the follow-up usage read.
 * @returns the refreshed snapshot, or a failed snapshot that keeps no prior card.
 */
export async function consumeCodexRateLimitResetCredit(
  options: CodexQuotaFetchOptions,
): Promise<{ ok: boolean; quota: CodexQuotaSnapshot }> {
  const fetchImpl = options.fetchImpl ?? fetch
  const headers = {
    ...codexHeaders(options.accessToken, options.chatgptAccountId),
    accept: 'application/json',
    'openai-beta': 'codex-1',
    originator: 'Codex Desktop',
    'content-type': 'application/json',
  }
  try {
    const response = await fetchImpl(CODEX_CONSUME_RESET_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ redeem_request_id: randomUUID() }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    })
    const text = await response.text()
    let raw: unknown
    try { raw = text.length === 0 ? {} : JSON.parse(text) }
    catch (_invalidConsumeJson) { raw = {} }
    if (!response.ok || !isCodexConsumeSuccess(raw)) {
      return { ok: false, quota: await fetchCodexQuota(options) }
    }
    return { ok: true, quota: await fetchCodexQuota(options) }
  } catch (error: unknown) {
    return { ok: false, quota: failedQuota(error instanceof Error ? error.message : String(error)) }
  }
}

function failedQuota(error: string): CodexQuotaSnapshot {
  return {
    status: 'failed',
    planType: null,
    subscriptionActiveUntilMs: null,
    creditBalance: null,
    creditsUnlimited: false,
    windows: [],
    resetCredits: [],
    resetCreditsAvailableCount: null,
    models: [],
    error,
  }
}

function unsignedQuota(): CodexQuotaSnapshot {
  return {
    status: 'unsigned',
    planType: null,
    subscriptionActiveUntilMs: null,
    creditBalance: null,
    creditsUnlimited: false,
    windows: [],
    resetCredits: [],
    resetCreditsAvailableCount: null,
    models: [],
  }
}

/** Empty unsigned Codex snapshot. */
export const unsignedCodexQuota = unsignedQuota

function codexHeaders(accessToken: string, accountId: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    accept: 'application/json',
    'content-type': 'application/json',
    'user-agent': 'codex-tui/0.154.0 (Mac OS 26.5.2; arm64) iTerm.app/3.6.11 (codex-tui; 0.154.0)',
  }
  if (accountId !== undefined && accountId.length > 0) headers['chatgpt-account-id'] = accountId
  return headers
}

async function loadResetCredits(
  fetchImpl: typeof fetch,
  headers: Record<string, string>,
): Promise<CodexResetCredit[]> {
  try {
    const response = await fetchImpl(CODEX_RATE_LIMIT_RESET_CREDITS_URL, {
      method: 'GET',
      headers: {
        ...headers,
        accept: 'application/json',
        'openai-beta': 'codex-1',
        originator: 'Codex Desktop',
      },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    })
    if (!response.ok) return []
    return parseCodexResetCredits(JSON.parse(await response.text()))
  } catch (_resetCreditsUnavailable) {
    return []
  }
}

async function loadSubscriptionMs(
  fetchImpl: typeof fetch,
  options: CodexQuotaFetchOptions,
): Promise<number | undefined> {
  const accountId = options.chatgptAccountId
  if (accountId === undefined || accountId.length === 0) return undefined
  try {
    const url = `${CODEX_SUBSCRIPTION_URL}?account_id=${encodeURIComponent(accountId)}`
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: codexHeaders(options.accessToken, accountId),
      signal: AbortSignal.timeout(SUBSCRIPTION_TIMEOUT_MS),
    })
    if (!response.ok) return undefined
    const text = await response.text()
    let raw: unknown = text
    try { raw = JSON.parse(text) }
    catch (_invalidSubscriptionJson) { /* keep the raw text for ISO/epoch parse */ }
    return parseCodexSubscriptionActiveUntilMs(raw)
  } catch (_subscriptionUnavailable) {
    return undefined
  }
}

async function loadSubscriptionModels(
  fetchImpl: typeof fetch,
  headers: Record<string, string>,
): Promise<{ models: CodexSubscriptionModel[]; modelsError?: string }> {
  try {
    const response = await fetchImpl(`${CODEX_MODELS_URL}?client_version=0.154.0`, {
      method: 'GET',
      headers: {
        ...headers,
        originator: 'codex-tui',
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(SUBSCRIPTION_TIMEOUT_MS),
    })
    if (!response.ok) return { models: [], modelsError: 'models-unavailable' }
    return { models: parseCodexSubscriptionModels(JSON.parse(await response.text())) }
  } catch (_modelsUnavailable) {
    return { models: [], modelsError: 'models-unavailable' }
  }
}

function pushClassifiedWindows(
  windows: CodexQuotaWindow[],
  raw: Record<string, unknown> | undefined,
  group: CodexQuotaWindow['group'],
  featureName: string | null,
  nowMs: number,
): void {
  if (raw === undefined) return
  const { fiveHour, weekly } = classifyWindows(raw)
  if (fiveHour !== undefined) {
    windows.push(windowOf(fiveHour, idFor(group, featureName, 'fiveHour'), group, featureName, nowMs, fiveHour.limitReached))
  }
  if (weekly !== undefined) {
    windows.push(windowOf(weekly, idFor(group, featureName, kindOfWindow(integerOf(pick(weekly, 'limit_window_seconds', 'limitWindowSeconds')))), group, featureName, nowMs, weekly.limitReached))
  }
}

function classifyWindows(
  raw: Record<string, unknown>,
): { fiveHour: Record<string, unknown> | undefined; weekly: Record<string, unknown> | undefined } {
  const primary = asObject(pick(raw, 'primary_window', 'primaryWindow', 'primary'))
    ?? (isFlatWindow(raw) ? raw : undefined)
  const secondary = asObject(pick(raw, 'secondary_window', 'secondaryWindow', 'secondary'))
  const limitReached = raw.limit_reached === true || raw.limitReached === true || raw.allowed === false
  const taggedPrimary = primary === undefined ? undefined : { ...primary, limitReached }
  const taggedSecondary = secondary === undefined ? undefined : { ...secondary, limitReached }
  let fiveHour: Record<string, unknown> | undefined
  let weekly: Record<string, unknown> | undefined
  for (const window of [taggedPrimary, taggedSecondary]) {
    if (window === undefined) continue
    const seconds = integerOf(pick(window, 'limit_window_seconds', 'limitWindowSeconds'))
    const kind = kindOfWindow(seconds)
    if (kind === 'fiveHour' && fiveHour === undefined) fiveHour = window
    else if ((kind === 'weekly' || kind === 'monthly') && weekly === undefined) weekly = window
  }
  if (fiveHour === undefined && taggedPrimary !== undefined && taggedPrimary !== weekly) fiveHour = taggedPrimary
  if (weekly === undefined && taggedSecondary !== undefined && taggedSecondary !== fiveHour) weekly = taggedSecondary
  return { fiveHour, weekly }
}

function isFlatWindow(raw: Record<string, unknown>): boolean {
  return pick(raw, 'used_percent', 'usedPercent', 'limit_window_seconds', 'limitWindowSeconds', 'reset_at', 'resetAt') !== undefined
    && asObject(pick(raw, 'primary_window', 'primaryWindow', 'primary', 'secondary_window', 'secondaryWindow', 'secondary')) === undefined
}

function idFor(
  group: CodexQuotaWindow['group'],
  featureName: string | null,
  kind: CodexQuotaWindow['kind'],
): string {
  const prefix = group === 'additional' ? `additional:${featureName === null || featureName.length === 0 ? 'feature' : featureName}` : group
  return `${prefix}:${kind}`
}

function windowOf(
  raw: Record<string, unknown>,
  id: string,
  group: CodexQuotaWindow['group'],
  featureName: string | null,
  nowMs: number,
  limitReached: unknown,
): CodexQuotaWindow {
  const usedPercentRaw = numberOf(pick(raw, 'used_percent', 'usedPercent'))
  const windowSeconds = integerOf(pick(raw, 'limit_window_seconds', 'limitWindowSeconds'))
  const resetAt = instantMs(pick(raw, 'reset_at', 'resetAt'))
  const resetAfter = integerOf(pick(raw, 'reset_after_seconds', 'resetAfterSeconds'))
  const usedPercent = usedPercentRaw ?? (limitReached === true ? 100 : null)
  return {
    id,
    kind: kindOfWindow(windowSeconds),
    group,
    featureName,
    usedPercent,
    remainingPercent: usedPercent === null ? null : Math.max(0, Math.min(100, 100 - usedPercent)),
    resetAtMs: resetAt ?? (resetAfter === null ? null : nowMs + resetAfter * 1000),
    windowSeconds,
  }
}

function kindOfWindow(seconds: number | null): CodexQuotaWindow['kind'] {
  if (seconds === FIVE_HOURS_SECONDS) return 'fiveHour'
  if (seconds === WEEK_SECONDS) return 'weekly'
  if (seconds !== null && seconds >= 28 * DAY_SECONDS && seconds <= 31 * DAY_SECONDS) return 'monthly'
  return 'unknown'
}

function pick(object: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (object[key] !== undefined) return object[key]
  }
  return undefined
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function integerOf(value: unknown): number | null {
  const n = numberOf(value)
  return n === null || !Number.isSafeInteger(n) ? null : n
}

function instantMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000
  }
  if (typeof value === 'string' && value.length > 0) {
    const numeric = Number(value)
    if (Number.isFinite(numeric) && /^-?\d+(\.\d+)?$/u.test(value)) {
      return numeric > 1e12 ? numeric : numeric * 1000
    }
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  return undefined
}

/**
 * List the installed Codex adapter's model catalog without claiming subscription verification.
 * @returns configured adapter model identifiers and display names.
 */
export function codexAdapterModels(): CodexSubscriptionModel[] {
  return (catalogProvider('openai-codex')?.getModels() ?? []).map(model => ({ id: model.id, name: model.name }))
}
