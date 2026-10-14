/**
 * Live Cloud Code catalog listing for the Antigravity route.
 *
 * @module dsh-llm-antigravity/catalog
 */

import { LlmError } from '@deepseek-ai/dsh-llm'
import { deadline } from '@deepseek-ai/dsh-timeout'
import type { AntigravityCatalogModel, ResolvedAntigravityConfig } from './config.ts'
import { asObject, providerHttpError, transportError } from './errors.ts'

const REQUEST_CODE = 'ANTIGRAVITY_TIMEOUT'
const IDLE_CODE = 'ANTIGRAVITY_IDLE'

/** Cloud Code client identity generate RPCs require. */
const CLOUD_CODE_API_CLIENT = 'google-cloud-sdk vscode_cloudshelleditor/0.1'
/** Floor version Cloud Code accepts for current catalog ids (CLIProxyAPI). */
const CLOUD_CODE_USER_AGENT_VERSION = '2.9.1'
const FREE_TIER_ID = 'free-tier'

/** Production Cloud Code origin used for `loadCodeAssist`. */
export const CLOUD_CODE_PROD_ORIGIN = 'https://cloudcode-pa.googleapis.com'
/** Consumer Cloud Code origin used for listing and generate. */
export const CLOUD_CODE_DAILY_ORIGIN = 'https://daily-cloudcode-pa.googleapis.com'

function cloudCodeUserAgent(): string {
  const os = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'windows' : 'linux'
  const arch = process.arch === 'x64' ? 'amd64' : process.arch
  return `antigravity/hub/${CLOUD_CODE_USER_AGENT_VERSION} ${os}/${arch}`
}

/** Cloud Code ClientMetadata for loadCodeAssist; omit `platform` (closed proto enum). */
function assistMetadata(): Record<string, string> {
  return { ideType: 'ANTIGRAVITY' }
}

/** Cloud Code control-plane metadata for onboardUser. */
function onboardMetadata(): Record<string, string> {
  return {
    ide_type: 'ANTIGRAVITY',
    ide_version: CLOUD_CODE_USER_AGENT_VERSION,
    ide_name: 'antigravity',
  }
}

/**
 * Cloud Code origin for `v1internal` RPCs. The default `baseURL` ends in `/v1`.
 * @param baseURL - Cloud Code root without a trailing slash.
 * @returns the origin that hosts `/v1internal:*` RPCs.
 */
export function cloudCodeOrigin(baseURL: string): string {
  return baseURL.replace(/\/v1$/u, '')
}

/**
 * Origin for `loadCodeAssist`. Consumer daily listing/generate still classifies
 * the account on production Cloud Code.
 * @param baseURL - Cloud Code root without a trailing slash.
 * @returns production when `baseURL` is the daily consumer host; otherwise the configured origin.
 */
export function cloudCodeAssistOrigin(baseURL: string): string {
  const origin = cloudCodeOrigin(baseURL)
  return origin === CLOUD_CODE_DAILY_ORIGIN ? CLOUD_CODE_PROD_ORIGIN : origin
}

/**
 * SSE generate URL for one Cloud Code companion project.
 * @param baseURL - Cloud Code root without a trailing slash.
 * @returns `{origin}/v1internal:streamGenerateContent?alt=sse`.
 */
export function cloudCodeGenerateUrl(baseURL: string): string {
  return `${cloudCodeOrigin(baseURL)}/v1internal:streamGenerateContent?alt=sse`
}

/**
 * Whether a discovered id belongs in the Antigravity selector catalog.
 * @param id - Cloud Code map key.
 * @returns false for `chat_*`, `tab_*`, Gemini 1.x/2.x, and `gemini-exp-*` ids.
 */
export function isSelectableDiscoveredModel(id: string): boolean {
  if (id.startsWith('chat_') || id.startsWith('tab_')) return false
  if (/^gemini-[12](?:[.-]|$)/u.test(id)) return false
  return !id.startsWith('gemini-exp-')
}

/**
 * Headers Cloud Code listing and generate RPCs require.
 * @param token - Bearer access token or API-key fallback.
 * @returns JSON POST headers with the Antigravity client identity.
 */
export function cloudCodeHeaders(token: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
    'user-agent': cloudCodeUserAgent(),
    'x-goog-api-client': CLOUD_CODE_API_CLIENT,
    'client-metadata': JSON.stringify(assistMetadata()),
  }
}

type CloudCodeRpc =
  | 'v1internal:loadCodeAssist'
  | 'v1internal:fetchAvailableModels'
  | 'v1internal:onboardUser'

async function cloudCodeRpc(
  connection: ResolvedAntigravityConfig,
  token: string,
  signal: AbortSignal,
  rpc: CloudCodeRpc,
  body: Record<string, unknown>,
  origin = cloudCodeOrigin(connection.baseURL),
): Promise<unknown> {
  const response = await fetch(`${origin}/${rpc}`, {
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
    throw new LlmError('Antigravity catalog listing returned invalid JSON', 'PROTOCOL')
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

/**
 * Read the Cloud Code companion project for listing and generate.
 * @param connection - current configuration snapshot.
 * @param token - Bearer token from the stored grant or API-key fallback.
 * @param signal - fused caller and request-deadline signal.
 * @returns a managed project id, or undefined when Assist and onboard omit one.
 */
export async function loadCloudCodeProject(
  connection: ResolvedAntigravityConfig,
  token: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  const raw = await cloudCodeRpc(
    connection,
    token,
    signal,
    'v1internal:loadCodeAssist',
    { metadata: assistMetadata() },
    cloudCodeAssistOrigin(connection.baseURL),
  )
  const existing = extractProjectId(raw)
  if (existing !== undefined) return existing
  return onboardCloudCodeProject(connection, token, signal, raw)
}

/**
 * Read a companion project id from a Cloud Code JSON body.
 * @param raw - `loadCodeAssist` or `onboardUser` payload.
 * @returns the project id, or undefined when the body omits one.
 */
export function extractProjectId(raw: unknown): string | undefined {
  const data = asObject(raw)
  if (data === undefined) return undefined
  for (const key of ['cloudaicompanionProject', 'projectId', 'project'] as const) {
    const value = data[key]
    if (typeof value === 'string' && value.length > 0) return value
    const nested = asObject(value)
    const id = nested === undefined ? undefined : nested.id
    if (typeof id === 'string' && id.length > 0) return id
  }
  return extractProjectId(asObject(data.response))
}

async function onboardCloudCodeProject(
  connection: ResolvedAntigravityConfig,
  token: string,
  signal: AbortSignal,
  assist: unknown,
): Promise<string | undefined> {
  try {
    const raw = await cloudCodeRpc(connection, token, signal, 'v1internal:onboardUser', {
      tier_id: onboardTierId(assist),
      metadata: onboardMetadata(),
    })
    return extractProjectId(raw)
  } catch (error) {
    if (error instanceof LlmError && (error.code === 'AUTH' || error.code === 'ABORTED' || error.code === 'TIMEOUT')) {
      throw error
    }
    return undefined
  }
}

function onboardTierId(assist: unknown): string {
  const allowed = asObject(assist)?.allowedTiers
  if (Array.isArray(allowed)) {
    for (const entry of allowed) {
      const tier = asObject(entry)
      if (tier?.isDefault === true && typeof tier.id === 'string' && tier.id.length > 0) return tier.id
    }
  }
  const current = asObject(asObject(assist)?.currentTier)
  if (typeof current?.id === 'string' && current.id.length > 0) return current.id
  return FREE_TIER_ID
}

/**
 * Read selector entries from a `fetchAvailableModels` JSON body.
 * @param raw - decoded response.
 * @returns catalog entries in response order; skips auxiliary, internal, and quota-exhausted ids.
 */
export function parseAvailableModels(raw: unknown): AntigravityCatalogModel[] {
  const models = asObject(asObject(raw)?.models)
  if (models === undefined) return []
  const catalog: AntigravityCatalogModel[] = []
  for (const [id, value] of Object.entries(models)) {
    if (id.length === 0 || !isSelectableDiscoveredModel(id)) continue
    const entry = asObject(value) ?? {}
    if (entry.isInternal === true) continue
    const quota = asObject(entry.quotaInfo)
    if (quota?.isExhausted === true || quota?.remainingFraction === 0) continue
    const name = typeof entry.displayName === 'string' && entry.displayName.length > 0 ? entry.displayName : id
    const contextWindow = typeof entry.maxTokens === 'number' && Number.isSafeInteger(entry.maxTokens) && entry.maxTokens > 0
      ? entry.maxTokens
      : undefined
    catalog.push({
      id,
      name,
      ...contextWindow === undefined ? {} : { contextWindow },
    })
  }
  return catalog
}

/**
 * POST Cloud Code `loadCodeAssist` then `v1internal:fetchAvailableModels`.
 * @param connection - current configuration snapshot.
 * @param token - Bearer token from the stored grant or API-key fallback.
 * @param signal - caller cancellation; combined with `requestTimeoutMs`.
 * @returns discovered catalog entries.
 */
export async function fetchAvailableModels(
  connection: ResolvedAntigravityConfig,
  token: string,
  signal?: AbortSignal,
): Promise<AntigravityCatalogModel[]> {
  using timer = deadline(signal, connection.requestTimeoutMs, REQUEST_CODE)
  const fused = signal === undefined ? timer.signal : AbortSignal.any([signal, timer.signal])
  try {
    const project = await loadCloudCodeProject(connection, token, fused)
    const raw = await cloudCodeRpc(
      connection,
      token,
      fused,
      'v1internal:fetchAvailableModels',
      project === undefined ? {} : { project },
    )
    return parseAvailableModels(raw)
  } catch (error) {
    throw transportError(error, fused, IDLE_CODE, REQUEST_CODE)
  }
}
