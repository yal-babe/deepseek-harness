/** Cloud Code `streamGenerateContent` SSE transport for the `antigravity` route. */

import { createHash } from 'node:crypto'
import { EventSourceParserStream } from 'eventsource-parser/stream'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import {
  assertUsableApiKey,
  LlmAdapter,
  LlmError,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock,
  FinishReason,
  GenerateOptions,
  LlmModelInfo,
  LlmResolvedModelInfo,
  StreamChunk,
  TokenUsage,
  ToolSchema,
} from '@deepseek-ai/dsh-llm'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { deadline, idleWatchdog } from '@deepseek-ai/dsh-timeout'
import { cloudCodeGenerateUrl, cloudCodeHeaders, fetchAvailableModels, loadCloudCodeProject } from './catalog.ts'
import {
  PLUGIN_NAME,
  PROVIDER,
  type AntigravityCatalogModel,
  type ResolvedAntigravityConfig,
} from './config.ts'
import { asObject, providerHttpError, transportError } from './errors.ts'
import { exchangeToken, grantExpired, parseGrant, RECORD_KEY, tokenRequestFields } from './oauth.ts'

const IDLE_CODE = 'ANTIGRAVITY_IDLE'
const REQUEST_CODE = 'ANTIGRAVITY_TIMEOUT'

/** Dependencies the plugin injects so tests can substitute credential lookup. */
export interface AntigravityAdapterOptions {
  /** Live configuration snapshot for the next request. */
  options: () => ResolvedAntigravityConfig
  /** Resolve a Bearer token from the stored grant or the API-key fallback. */
  resolveAccessToken: (connection: ResolvedAntigravityConfig, signal: AbortSignal) => Promise<string>
  /**
   * Whether selectors may advertise this route's catalog. Omitted always
   * advertises, which is what unit tests that bypass plugin `apply` need.
   */
  hasSelectableCredential?: () => Promise<boolean>
}

interface OpenBlock {
  index: number
  type: 'text' | 'reasoning' | 'tool-call'
  text: string
  id?: ToolCallId
  name?: string
  arguments: string
  started: boolean
}

/**
 * Direct Cloud Code adapter. Auth is a stored PKCE grant at
 * `llm-antigravity/default`, or the configured API-key fallback.
 */
export class AntigravityAdapter extends LlmAdapter {
  constructor(private readonly dependencies: AntigravityAdapterOptions) {
    super()
  }

  private catalog: {
    scope: string
    models?: readonly LlmModelInfo[]
    loadedAt?: number
    inflight?: Promise<readonly LlmModelInfo[]>
  } | undefined
  private readonly catalogAbort = new AbortController()

  /** Abort catalog work when the adapter's owning plugin is disposed. */
  disposeCatalog(): void {
    this.catalogAbort.abort()
    this.catalog = undefined
  }

  override providerInfo(provider: string) {
    return { id: provider, name: 'Antigravity' }
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    if (this.dependencies.hasSelectableCredential !== undefined
      && !await this.dependencies.hasSelectableCredential()) {
      this.catalog = undefined
      return []
    }
    const connection = this.dependencies.options()
    if (connection.models.length > 0) {
      return connection.models.map(model => catalogModelInfo(provider, model))
    }
    const signal = AbortSignal.any([this.catalogAbort.signal, AbortSignal.timeout(connection.requestTimeoutMs)])
    const token = await this.dependencies.resolveAccessToken(connection, signal)
    const scope = `${provider}\n${connection.baseURL}\n${createHash('sha256').update(token).digest('hex')}`
    if (this.catalog?.scope !== scope) this.catalog = { scope }
    const cache = this.catalog
    const refresh = (): Promise<readonly LlmModelInfo[]> => {
      if (cache.inflight !== undefined) return cache.inflight
      const load = fetchAvailableModels(connection, token, signal).then((models) => {
        const listing = models.map(model => catalogModelInfo(provider, model))
        signal.throwIfAborted()
        cache.models = listing
        cache.loadedAt = Date.now()
        return listing
      }).finally(() => { delete cache.inflight })
      cache.inflight = load
      return load
    }
    if (cache.models === undefined) return refresh()
    if (Date.now() - (cache.loadedAt ?? 0) >= connection.catalogMaxAgeMs) {
      // A failed refresh retains this credential's last successful listing.
      void refresh().catch(() => { cache.loadedAt = Date.now() })
    }
    return cache.models
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const connection = this.dependencies.options()
    const configured = connection.models.find(entry => entry.id === model)
    return Promise.resolve({
      ...configured === undefined
        ? { provider, id: model, name: model, inputModalities: ['text' as const] }
        : catalogModelInfo(provider, configured),
      ...configured?.contextWindow === undefined ? {} : { context: { contextWindow: configured.contextWindow } },
    })
  }

  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.generate(options, this.dependencies.options())
  }

  private async * generate(
    options: GenerateOptions,
    connection: ResolvedAntigravityConfig,
  ): AsyncGenerator<StreamChunk> {
    const consumer = new AbortController()
    using requestTimer = deadline(options.signal, connection.requestTimeoutMs, REQUEST_CODE)
    const fused = options.signal === undefined
      ? AbortSignal.any([consumer.signal, requestTimer.signal])
      : AbortSignal.any([consumer.signal, requestTimer.signal, options.signal])
    using watchdog = idleWatchdog(fused, connection.streamIdleTimeoutMs, IDLE_CODE)
    const iterator = this.request(options, connection, watchdog.signal, () => { watchdog.pulse() })
    try {
      while (true) {
        const next = await watchdog.next(iterator)
        if (next.done) return
        yield next.value
      }
    } catch (error) {
      throw transportError(error, watchdog.signal, IDLE_CODE, REQUEST_CODE)
    } finally {
      consumer.abort()
      /* v8 ignore next -- the detached drain only rejects while unwinding an abandoned request. */
      void iterator.return(undefined).catch(() => {})
    }
  }

  private async * request(
    options: GenerateOptions,
    connection: ResolvedAntigravityConfig,
    signal: AbortSignal,
    activity: () => void,
  ): AsyncGenerator<StreamChunk> {
    signal.throwIfAborted()
    const token = await this.dependencies.resolveAccessToken(connection, signal)
    activity()
    signal.throwIfAborted()
    const project = await loadCloudCodeProject(connection, token, signal)
    if (project === undefined) {
      throw new LlmError('Antigravity Cloud Code did not return a companion project', 'PROTOCOL')
    }
    activity()
    signal.throwIfAborted()
    const body = serializeRequest(options, project)
    const response = await fetch(cloudCodeGenerateUrl(connection.baseURL), {
      method: 'POST',
      signal,
      redirect: 'error',
      headers: {
        ...cloudCodeHeaders(token),
        accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const text = await response.text()
      let raw: unknown
      try { raw = JSON.parse(text) } catch { /* HTTP status is authoritative when a gateway does not return JSON. */ }
      throw providerHttpError(response.status, raw, text, response.headers)
    }
    if (response.body === null) throw new LlmError('Antigravity Cloud Code returned no response body', 'PROTOCOL')
    yield* translateSse(response.body, activity)
  }
}

/**
 * Advertise one catalog entry as selector metadata.
 * @param provider - registered provider id.
 * @param model - advisory catalog entry.
 * @returns selector metadata.
 */
export function catalogModelInfo(provider: string, model: AntigravityCatalogModel): LlmModelInfo {
  return {
    provider,
    id: model.id,
    name: model.name ?? model.id,
    ...model.description === undefined ? {} : { description: model.description },
    inputModalities: ['text'],
  }
}

/**
 * Whether the Antigravity route has a stored grant or a usable API key.
 * Selectors hide the catalog until this is true, matching DeepSeek Account.
 * @param ctx - plugin context that may carry credentials.
 * @param connection - current configuration snapshot.
 * @returns true when `listModels` should advertise catalog entries.
 */
export async function antigravityCatalogVisible(
  ctx: Context,
  connection: ResolvedAntigravityConfig,
): Promise<boolean> {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    if ((await credentials.describeRecord(RECORD_KEY)).configured) return true
    return (await credentials.describe(credentialRef(connection.apiKeyEnv))).configured
  }
  const ambient = launchEnvironmentOf(ctx).get(connection.apiKeyEnv)
  return ambient !== undefined && ambient.value.length > 0
}

/**
 * Resolve a Bearer token from the stored grant, refreshing it when expired, or
 * from the API-key credential reference.
 * @param ctx - plugin context that may carry credentials.
 * @param connection - current configuration snapshot.
 * @param signal - cancellation for a refresh request.
 * @param refreshing - in-flight refresh shared across concurrent calls.
 * @returns the access token or API key.
 */
export async function resolveAccessToken(
  ctx: Context,
  connection: ResolvedAntigravityConfig,
  signal: AbortSignal,
  refreshing: { current?: Promise<string> },
): Promise<string> {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    const record = await credentials.readRecord(RECORD_KEY)
    if (record !== undefined) {
      if (record.kind !== 'grant') {
        throw new LlmError('llm-antigravity: stored credential is not an OAuth grant; sign in again', 'AUTH')
      }
      const grant = parseGrant(record.payload)
      if (grant === undefined) {
        throw new LlmError('llm-antigravity: stored grant is unusable; sign in again', 'AUTH')
      }
      if (!grantExpired(grant)) return grant.accessToken
      if (grant.refreshToken === undefined) {
        throw new LlmError('llm-antigravity: stored grant expired; sign in again', 'AUTH')
      }
      const inflight = refreshing.current ?? refreshGrant(ctx, connection, grant.refreshToken, signal)
        .finally(() => { delete refreshing.current })
      refreshing.current = inflight
      return inflight
    }
  }
  return resolveApiKey(ctx, connection)
}

async function refreshGrant(
  ctx: Context,
  connection: ResolvedAntigravityConfig,
  refreshToken: string,
  signal: AbortSignal,
): Promise<string> {
  const next = await exchangeToken(connection, tokenRequestFields(connection, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  }), signal)
  const credentials = ctx.get('credentials')
  /* v8 ignore next -- refresh starts only after a grant was read from credentials. */
  if (credentials === undefined) return next.accessToken
  if (next.refreshToken === undefined) next.refreshToken = refreshToken
  await credentials.modifyRecord(RECORD_KEY, () => Promise.resolve({ kind: 'grant', payload: next }))
  return next.accessToken
}

async function resolveApiKey(ctx: Context, connection: ResolvedAntigravityConfig): Promise<string> {
  const ref = credentialRef(connection.apiKeyEnv)
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    const hit = await credentials.resolve(ref)
    if (hit !== undefined) return assertUsableApiKey(hit.value, PLUGIN_NAME, ref)
  } else {
    const ambient = launchEnvironmentOf(ctx).get(ref)
    if (ambient !== undefined && ambient.value.length > 0) return assertUsableApiKey(ambient.value, PLUGIN_NAME, ref)
  }
  throw new LlmError(
    `llm-antigravity: no credential for provider route "${PROVIDER}"; sign in through the Antigravity authorization`
    + ` flow, store ${ref} through the credentials service, or export ${ref} in the launching environment`,
    'MISSING_CREDENTIAL',
  )
}

/**
 * Build the Cloud Code `streamGenerateContent` JSON body.
 * @param options - harness request.
 * @param project - companion project from `loadCodeAssist`.
 * @returns the wire payload.
 */
export function serializeRequest(options: GenerateOptions, project: string): Record<string, unknown> {
  const { systemInstruction, contents } = serializeContents(options)
  const request: Record<string, unknown> = { contents }
  if (systemInstruction !== undefined) request.systemInstruction = systemInstruction
  const generationConfig = serializeGenerationConfig(options)
  if (generationConfig !== undefined) request.generationConfig = generationConfig
  if (options.tools !== undefined && options.tools.length > 0) {
    request.tools = [{ functionDeclarations: options.tools.map(serializeTool) }]
  }
  return {
    project,
    model: options.model,
    request,
    userAgent: 'antigravity',
    requestType: 'agent',
    requestId: `agent-${randomUUID()}`,
  }
}

function serializeGenerationConfig(options: GenerateOptions): Record<string, unknown> | undefined {
  const config: Record<string, unknown> = {}
  if (options.temperature !== undefined) config.temperature = options.temperature
  if (options.maxTokens !== undefined) config.maxOutputTokens = options.maxTokens
  if (options.stop !== undefined && options.stop.length > 0) config.stopSequences = options.stop
  return Object.keys(config).length === 0 ? undefined : config
}

function serializeTool(tool: ToolSchema): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }
}

interface GeminiContent {
  role: 'user' | 'model'
  parts: Record<string, unknown>[]
}

function serializeContents(options: GenerateOptions): {
  systemInstruction?: { parts: Array<{ text: string }> }
  contents: GeminiContent[]
} {
  const systemParts: Array<{ text: string }> = []
  if (options.system !== undefined && options.system.length > 0) {
    systemParts.push({ text: options.system })
  }
  const contents: GeminiContent[] = []
  const toolNames = new Map<string, string>()
  for (const message of options.messages) {
    switch (message.role) {
      case 'system':
      case 'developer': {
        const text = textOf(message.content)
        if (text.length > 0) systemParts.push({ text })
        break
      }
      case 'user':
        pushContent(contents, 'user', textParts(textOf(message.content)))
        break
      case 'assistant':
        pushContent(contents, 'model', serializeAssistantParts(message.content, toolNames))
        break
      case 'tool':
        pushContent(contents, 'user', [serializeFunctionResponse(message.toolCallId, textOf(message.content), toolNames)])
        break
      /* v8 ignore next 2 -- RequestMessage is a closed union; the default is for exhaustiveness. */
      default:
        return assertNever(message, 'unsupported request message')
    }
  }
  return {
    ...systemParts.length === 0 ? {} : { systemInstruction: { parts: systemParts } },
    contents,
  }
}

function pushContent(contents: GeminiContent[], role: GeminiContent['role'], parts: Record<string, unknown>[]): void {
  if (parts.length === 0) return
  const last = contents.at(-1)
  if (last !== undefined && last.role === role) {
    last.parts.push(...parts)
    return
  }
  contents.push({ role, parts })
}

function textParts(text: string): Record<string, unknown>[] {
  return text.length === 0 ? [] : [{ text }]
}

function serializeAssistantParts(
  content: readonly ContentBlock[],
  toolNames: Map<string, string>,
): Record<string, unknown>[] {
  const parts: Record<string, unknown>[] = []
  for (const block of content) {
    switch (block.type) {
      case 'text':
        if (block.text.length > 0) parts.push({ text: block.text })
        break
      case 'reasoning':
        break
      case 'tool-call':
        toolNames.set(block.id, block.name)
        parts.push({
          functionCall: {
            id: block.id,
            name: block.name,
            args: jsonObject(block.arguments),
          },
        })
        break
      case 'image':
      case 'file':
        throw new LlmError('llm-antigravity: image and file blocks are not supported on Antigravity requests', 'UNSUPPORTED_CONTENT')
      case 'tool-addition':
      case 'tool-removal':
        break
      /* v8 ignore next 2 -- ContentBlock is a closed union; the default is for exhaustiveness. */
      default:
        throw new LlmError('llm-antigravity: unsupported request content block', 'UNSUPPORTED_CONTENT')
    }
  }
  return parts
}

function serializeFunctionResponse(
  toolCallId: string,
  text: string,
  toolNames: Map<string, string>,
): Record<string, unknown> {
  return {
    functionResponse: {
      id: toolCallId,
      name: toolNames.get(toolCallId) ?? toolCallId,
      response: responsePayload(text),
    },
  }
}

function jsonObject(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { return { value: raw } }
    return jsonObject(parsed)
  }
  return asObject(raw) ?? (raw === undefined ? {} : { value: raw })
}

function responsePayload(text: string): Record<string, unknown> {
  if (text.length === 0) return { output: '' }
  try {
    const parsed: unknown = JSON.parse(text)
    return asObject(parsed) ?? { output: parsed }
  } catch {
    return { output: text }
  }
}

function textOf(content: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of content) {
    switch (block.type) {
      case 'text':
        parts.push(block.text)
        break
      case 'reasoning':
        break
      case 'image':
      case 'file':
        throw new LlmError('llm-antigravity: image and file blocks are not supported on Antigravity requests', 'UNSUPPORTED_CONTENT')
      case 'tool-call':
      case 'tool-addition':
      case 'tool-removal':
        break
      /* v8 ignore next 2 -- ContentBlock is a closed union; the default is for exhaustiveness. */
      default:
        throw new LlmError('llm-antigravity: unsupported request content block', 'UNSUPPORTED_CONTENT')
    }
  }
  return parts.join('')
}

/**
 * Translate Cloud Code SSE into harness chunks.
 * @param body - response bytes.
 * @param activity - idle-watchdog pulse.
 * @returns translated model response chunks.
 */
export async function* translateSse(
  body: ReadableStream<BufferSource>,
  activity: () => void,
): AsyncGenerator<StreamChunk> {
  const events = body.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream({ onComment: activity }))
  const blocks = new Map<number, OpenBlock>()
  const toolKeys = new Map<string, number>()
  let nextIndex = 0
  let textIndex: number | undefined
  let reasoningIndex: number | undefined
  let nextTool = 0
  let finish: FinishReason | undefined
  let usage: TokenUsage | undefined
  for await (const frame of events) {
    activity()
    if (frame.data === '[DONE]') break
    if (frame.data.length === 0) continue
    let raw: unknown
    try { raw = JSON.parse(frame.data) } catch {
      throw new LlmError('Antigravity Cloud Code SSE contains invalid JSON', 'PROTOCOL')
    }
    const event = asObject(raw)
    if (event === undefined) throw new LlmError('Antigravity Cloud Code SSE event is not an object', 'PROTOCOL')
    if (event.error !== undefined) throw providerHttpError(400, event, frame.data)
    const response = asObject(event.response) ?? event
    const metadata = asObject(response.usageMetadata)
    if (metadata !== undefined) usage = mapUsage(metadata)
    const candidate = firstCandidate(response)
    if (candidate === undefined) continue
    const content = asObject(candidate.content)
    const parts = content === undefined ? [] : content.parts
    if (Array.isArray(parts)) {
      for (const part of parts) {
        const wire = asObject(part)
        if (wire === undefined) continue
        if (wire.thought === true) {
          const reasoning = stringField(wire.text)
          if (reasoning !== undefined && reasoning.length > 0) {
            reasoningIndex ??= nextIndex++
            yield* appendText(blocks, reasoningIndex, 'reasoning', reasoning)
          }
          continue
        }
        const call = asObject(wire.functionCall)
        if (call !== undefined) {
          const allocated = appendFunctionCall(blocks, toolKeys, nextIndex, nextTool, call)
          yield* allocated.chunks
          if (allocated.started && allocated.index === nextIndex) {
            nextIndex += 1
            nextTool += 1
          }
          continue
        }
        const text = stringField(wire.text)
        if (text !== undefined && text.length > 0) {
          textIndex ??= nextIndex++
          yield* appendText(blocks, textIndex, 'text', text)
        }
      }
    }
    if (typeof candidate.finishReason === 'string' && candidate.finishReason.length > 0) {
      finish = mapFinishReason(candidate.finishReason, hasToolCalls(blocks))
    }
  }
  for (const block of [...blocks.values()].sort((left, right) => left.index - right.index)) {
    if (!block.started) {
      throw new LlmError('Antigravity Cloud Code tool call omitted name', 'PROTOCOL')
    }
    yield { type: 'block-end', index: block.index, block: closeBlock(block) }
  }
  finish ??= hasToolCalls(blocks) ? { kind: 'tool-calls' } : { kind: 'stop' }
  if (blocks.size === 0 && finish.kind === 'stop') {
    throw new LlmError('Antigravity Cloud Code returned no content', 'EMPTY_RESPONSE')
  }
  if (usage !== undefined) yield { type: 'usage', usage }
  yield { type: 'finish', reason: finish }
}

function firstCandidate(response: Record<string, unknown>): Record<string, unknown> | undefined {
  const candidates = response.candidates
  if (!Array.isArray(candidates) || candidates.length === 0) return undefined
  return asObject(candidates[0])
}

function hasToolCalls(blocks: Map<number, OpenBlock>): boolean {
  for (const block of blocks.values()) {
    if (block.type === 'tool-call' && block.started) return true
  }
  return false
}

function mapFinishReason(reason: string, tools: boolean): FinishReason {
  switch (reason) {
    case 'STOP':
      return { kind: 'stop' }
    case 'MAX_TOKENS':
      return { kind: 'max-tokens' }
    case 'OTHER':
      return tools ? { kind: 'tool-calls' } : { kind: 'stop' }
    default:
      return { kind: 'error', failure: { message: `Antigravity finishReason ${reason}`, code: 'PROTOCOL' } }
  }
}

function mapUsage(raw: Record<string, unknown>): TokenUsage {
  const prompt = numberField(raw.promptTokenCount) ?? 0
  const completion = numberField(raw.candidatesTokenCount) ?? 0
  const cached = numberField(raw.cachedContentTokenCount)
  const reasoning = numberField(raw.thoughtsTokenCount)
  const toolPrompt = numberField(raw.toolUsePromptTokenCount) ?? 0
  const inputTokens = (cached === undefined ? prompt : Math.max(0, prompt - cached)) + toolPrompt
  const usage: TokenUsage = { inputTokens, outputTokens: completion + (reasoning ?? 0) }
  const total = numberField(raw.totalTokenCount)
  if (total !== undefined) usage.totalTokens = total
  else usage.totalTokens = prompt + usage.outputTokens + (numberField(raw.toolUsePromptTokenCount) ?? 0)
  if (cached !== undefined) usage.cacheReadTokens = cached
  if (reasoning !== undefined) usage.reasoningTokens = reasoning
  return usage
}

function* appendText(
  blocks: Map<number, OpenBlock>,
  index: number,
  type: 'text' | 'reasoning',
  text: string,
): Generator<StreamChunk> {
  let block = blocks.get(index)
  if (block === undefined) {
    block = { index, type, text: '', arguments: '', started: false }
    blocks.set(index, block)
  }
  if (!block.started) {
    block.started = true
    yield { type: 'block-start', index, blockType: type }
  }
  block.text += text
  yield type === 'text'
    ? { type: 'text-delta', index, text }
    : { type: 'reasoning-delta', index, text }
}

function appendFunctionCall(
  blocks: Map<number, OpenBlock>,
  toolKeys: Map<string, number>,
  nextIndex: number,
  toolOrdinal: number,
  call: Record<string, unknown>,
): { chunks: StreamChunk[]; started: boolean; index: number } {
  const name = stringField(call.name)
  if (name === undefined || name.length === 0) {
    if (!blocks.has(nextIndex)) {
      blocks.set(nextIndex, { index: nextIndex, type: 'tool-call', text: '', arguments: '', started: false })
    }
    return { chunks: [], started: false, index: nextIndex }
  }
  const key = stringField(call.id) ?? name
  const index = toolKeys.get(key) ?? nextIndex
  toolKeys.set(key, index)
  const args = JSON.stringify(jsonObject(call.args))
  const id = ToolCallId(stringField(call.id) ?? `call_${String(toolOrdinal)}`)
  let block = blocks.get(index)
  if (block === undefined || block.type !== 'tool-call') {
    block = { index, type: 'tool-call', text: '', arguments: '', started: false }
    blocks.set(index, block)
  }
  const chunks: StreamChunk[] = []
  block.id = id
  block.name = name
  if (!block.started) {
    block.started = true
    chunks.push({ type: 'block-start', index, blockType: 'tool-call' })
    chunks.push({ type: 'tool-call-delta', index, id, name, argumentsDelta: args })
    block.arguments = args
  }
  return { chunks, started: true, index }
}

function closeBlock(block: OpenBlock): ContentBlock {
  if (block.type === 'text') return { type: 'text', text: block.text }
  if (block.type === 'reasoning') return { type: 'reasoning', text: block.text }
  /* v8 ignore next 3 -- appendFunctionCall starts a tool-call block only after name arrives. */
  if (block.id === undefined || block.name === undefined) {
    throw new LlmError('Antigravity Cloud Code tool call omitted name', 'PROTOCOL')
  }
  return { type: 'tool-call', id: block.id, name: block.name, arguments: block.arguments }
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/* v8 ignore next 3 -- closed-union exhaustiveness; serializeMessage's default is ignored. */
function assertNever(_value: never, detail: string): never {
  throw new LlmError(`llm-antigravity: ${detail}`, 'PROTOCOL')
}
