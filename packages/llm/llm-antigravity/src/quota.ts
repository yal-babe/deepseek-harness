/**
 * Antigravity quota parse and fetch, aligned with CLI Proxy Management Center
 * `fetchAntigravityQuota` + `loadCodeAssist` subscription. No reset cards.
 *
 * @module dsh-llm-antigravity/quota
 */

import { LlmError } from '@deepseek-ai/dsh-llm'
import { deadline } from '@deepseek-ai/dsh-timeout'
import {
  CLOUD_CODE_DAILY_ORIGIN,
  CLOUD_CODE_PROD_ORIGIN,
  cloudCodeAssistOrigin,
  cloudCodeHeaders,
  cloudCodeOrigin,
  loadCloudCodeProject,
} from './catalog.ts'
import type { ResolvedAntigravityConfig } from './config.ts'
import { asObject, providerHttpError, transportError } from './errors.ts'

const REQUEST_CODE = 'ANTIGRAVITY_TIMEOUT'

/** Quota summary URL fallback order from Management Center. */
export const ANTIGRAVITY_QUOTA_URLS = [
  `${CLOUD_CODE_DAILY_ORIGIN}/v1internal:retrieveUserQuotaSummary`,
  'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary',
  `${CLOUD_CODE_PROD_ORIGIN}/v1internal:retrieveUserQuotaSummary`,
] as const

/** One remaining-fraction bucket inside a quota group. */
export interface AntigravityQuotaBucket {
  /** `5h` or `weekly` after sort. */
  id: '5h' | 'weekly' | string
  /** Remaining fraction in 0..1; null when omitted. */
  remainingFraction: number | null
  /** Absolute reset instant. */
  resetAtMs: number | null
}

/** One named quota group (Gemini vs third-party). */
export interface AntigravityQuotaGroup {
  /** Group id from the summary, or a synthesized index. */
  id: string
  /** Display name from the summary when present. */
  label: string | null
  /** Buckets sorted 5h then weekly. */
  buckets: AntigravityQuotaBucket[]
}

/** Subscription tier mapped from `loadCodeAssist`. */
export type AntigravityPlan = 'free' | 'pro' | 'ultra' | 'ultra-lite' | 'unknown'

/** Safe Antigravity quota view: no tokens. */
export interface AntigravityQuotaSnapshot {
  /** Whether a stored grant or API-key fallback authenticated the call. */
  status: 'unsigned' | 'ready' | 'failed'
  /** Mapped plan id. */
  plan: AntigravityPlan | null
  /** Raw tier id when present. */
  tierId: string | null
  /** Quota groups from the summary. */
  groups: AntigravityQuotaGroup[]
  /** Host-safe failure text when `status` is `failed`. */
  error?: string
}

/**
 * Map a Cloud Code tier id onto the Management Center plan vocabulary.
 * @param tierId - `paidTier` or `currentTier` id.
 */
export function mapAntigravityPlan(tierId: string | null): AntigravityPlan | null {
  if (tierId === null || tierId.length === 0) return null
  const id = tierId.toLowerCase()
  if (id === 'free-tier' || id === 'free') return 'free'
  if (id === 'g1-pro-tier' || id === 'pro') return 'pro'
  if (id === 'g1-ultra-tier' || id === 'ultra') return 'ultra'
  if (id === 'g1-ultra-lite-tier' || id === 'ultra-lite' || id === 'ultralite') return 'ultra-lite'
  return 'unknown'
}

/**
 * Read `paidTier` then `currentTier` from a `loadCodeAssist` body.
 * @param raw - decoded JSON.
 */
export function parseAntigravitySubscription(raw: unknown): { plan: AntigravityPlan | null; tierId: string | null } {
  const data = asObject(raw) ?? {}
  const paid = asObject(data.paidTier)
  const current = asObject(data.currentTier)
  const tierId = stringOf(paid?.id) ?? stringOf(current?.id)
  return { plan: mapAntigravityPlan(tierId), tierId }
}

/**
 * Build quota groups: each group's buckets sorted `5h` then `weekly`.
 * `remainingFraction` is leftover; `resetTime` becomes `resetAtMs`.
 * @param raw - decoded `retrieveUserQuotaSummary` JSON.
 */
export function buildAntigravityQuotaGroups(raw: unknown): AntigravityQuotaGroup[] {
  const data = asObject(raw) ?? {}
  const rows = asArray(data.quotaGroups ?? data.groups ?? data.buckets)
  const groups: AntigravityQuotaGroup[] = []
  if (rows.length === 0) {
    const nested = asObject(data.quota)
    if (nested !== undefined) return buildAntigravityQuotaGroups({ quotaGroups: [nested] })
  }
  for (const [index, row] of rows.entries()) {
    const item = asObject(row)
    if (item === undefined) continue
    const buckets = asArray(item.buckets ?? item.quotaBuckets ?? item.limits).map((entry, bucketIndex) => {
      const bucket = asObject(entry) ?? {}
      const id = normalizeBucketId(stringOf(pick(bucket, 'id', 'type', 'window')) ?? String(bucketIndex))
      return {
        id,
        remainingFraction: fractionOf(pick(bucket, 'remainingFraction', 'remaining_fraction', 'remaining')),
        resetAtMs: instantMs(pick(bucket, 'resetTime', 'reset_time', 'resetAt', 'reset_at')) ?? null,
      } satisfies AntigravityQuotaBucket
    }).sort(compareBuckets)
    groups.push({
      id: stringOf(pick(item, 'id', 'name', 'displayName')) ?? `group-${String(index)}`,
      label: stringOf(pick(item, 'displayName', 'name', 'label')),
      buckets,
    })
  }
  return groups
}

/**
 * Fetch quota summary (URL fallback) and subscription from `loadCodeAssist`.
 * @param connection - current Antigravity configuration.
 * @param token - Bearer access token.
 * @param project - Cloud Code companion project id.
 * @param signal - optional caller cancellation.
 * @param fetchImpl - HTTP implementation; defaults to global fetch.
 */
export async function fetchAntigravityQuota(
  connection: ResolvedAntigravityConfig,
  token: string,
  project: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<AntigravityQuotaSnapshot> {
  using timer = deadline(signal, connection.requestTimeoutMs, REQUEST_CODE)
  const fused = signal === undefined ? timer.signal : AbortSignal.any([signal, timer.signal])
  try {
    const [summary, assist] = await Promise.all([
      retrieveQuotaSummary(connection, token, project, fused, fetchImpl),
      loadAssist(connection, token, fused, fetchImpl),
    ])
    const subscription = parseAntigravitySubscription(assist)
    return {
      status: 'ready',
      plan: subscription.plan,
      tierId: subscription.tierId,
      groups: buildAntigravityQuotaGroups(summary),
    }
  } catch (error: unknown) {
    if (error instanceof LlmError && error.code === 'AUTH') {
      return { status: 'unsigned', plan: null, tierId: null, groups: [] }
    }
    throw transportError(error, fused, 'ANTIGRAVITY_IDLE', REQUEST_CODE)
  }
}

/**
 * Load the companion project then fetch quota; unsigned when no project exists.
 * @param connection - current configuration.
 * @param token - Bearer token.
 * @param signal - optional cancellation.
 */
export async function fetchAntigravityQuotaForToken(
  connection: ResolvedAntigravityConfig,
  token: string,
  signal?: AbortSignal,
): Promise<AntigravityQuotaSnapshot> {
  using timer = deadline(signal, connection.requestTimeoutMs, REQUEST_CODE)
  const fused = signal === undefined ? timer.signal : AbortSignal.any([signal, timer.signal])
  try {
    const project = await loadCloudCodeProject(connection, token, fused)
    if (project === undefined) {
      return { status: 'failed', plan: null, tierId: null, groups: [], error: 'Cloud Code project is unavailable' }
    }
    return await fetchAntigravityQuota(connection, token, project, fused)
  } catch (error: unknown) {
    const mapped = transportError(error, fused, 'ANTIGRAVITY_IDLE', REQUEST_CODE)
    if (mapped instanceof LlmError && (mapped.code === 'AUTH' || mapped.code === 'MISSING_CREDENTIAL')) {
      return { status: 'unsigned', plan: null, tierId: null, groups: [] }
    }
    return {
      status: 'failed',
      plan: null,
      tierId: null,
      groups: [],
      error: mapped.message,
    }
  }
}

/** Empty unsigned Antigravity snapshot. */
export function unsignedAntigravityQuota(): AntigravityQuotaSnapshot {
  return { status: 'unsigned', plan: null, tierId: null, groups: [] }
}

async function retrieveQuotaSummary(
  connection: ResolvedAntigravityConfig,
  token: string,
  project: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const configured = `${cloudCodeOrigin(connection.baseURL)}/v1internal:retrieveUserQuotaSummary`
  const urls = ANTIGRAVITY_QUOTA_URLS.includes(configured as typeof ANTIGRAVITY_QUOTA_URLS[number])
    ? [...ANTIGRAVITY_QUOTA_URLS]
    : [configured, ...ANTIGRAVITY_QUOTA_URLS]
  let lastError: unknown
  for (const url of urls) {
    try {
      return await postJson(fetchImpl, url, token, { project }, signal)
    } catch (error: unknown) {
      lastError = error
      if (error instanceof LlmError && (error.code === 'AUTH' || error.code === 'ABORTED' || error.code === 'TIMEOUT')) {
        throw error
      }
    }
  }
  throw lastError instanceof Error ? lastError : new LlmError('Antigravity quota summary failed', 'PROTOCOL')
}

async function loadAssist(
  connection: ResolvedAntigravityConfig,
  token: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const origin = cloudCodeAssistOrigin(connection.baseURL)
  try {
    return await postJson(
      fetchImpl,
      `${origin}/v1internal:loadCodeAssist`,
      token,
      { metadata: { ideType: 'ANTIGRAVITY' } },
      signal,
    )
  } catch (_assistUnavailable) {
    return {}
  }
}

async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  token: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: 'POST',
    signal,
    redirect: 'error',
    headers: cloudCodeHeaders(token),
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let raw: unknown
  try { raw = text.length === 0 ? {} : JSON.parse(text) }
  catch {
    if (!response.ok) throw providerHttpError(response.status, undefined, text, response.headers)
    throw new LlmError('Antigravity quota listing returned invalid JSON', 'PROTOCOL')
  }
  const rpcError = asObject(asObject(raw)?.error)
  if (!response.ok || rpcError !== undefined) {
    const status = !response.ok
      ? response.status
      : typeof rpcError?.code === 'number' && Number.isSafeInteger(rpcError.code) ? rpcError.code : 400
    throw providerHttpError(status, raw, text, response.headers)
  }
  return raw
}

function normalizeBucketId(raw: string): string {
  const id = raw.toLowerCase()
  if (id === '5h' || id === 'five_hour' || id === 'five-hour' || id === '5hour') return '5h'
  if (id === 'weekly' || id === 'week' || id === '7d') return 'weekly'
  return raw
}

function compareBuckets(left: AntigravityQuotaBucket, right: AntigravityQuotaBucket): number {
  const rank = (id: string): number => id === '5h' ? 0 : id === 'weekly' ? 1 : 2
  return rank(left.id) - rank(right.id)
}

function pick(object: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (object[key] !== undefined) return object[key]
  }
  return undefined
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function fractionOf(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value > 1 ? value / 100 : value
}

function instantMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000
  }
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  return undefined
}
