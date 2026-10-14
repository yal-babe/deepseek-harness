/**
 * Local durable cloud-sync queue. Callers enqueue redacted batches; the
 * service retries HTTP delivery and exposes pending/syncing/synced/failed
 * counts. Session-log capture is optional and requires `projectId`/`deviceId`.
 * @module @deepseek-ai/dsh-sync-outbox
 */

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import {
  DEFAULT_MAX_BATCH_EVENTS,
  DeviceId,
  redactJsonValue,
  StudioProjectId,
  SyncBatchId,
  validateBatch,
  type SyncBatch,
  type SyncEventEnvelope,
  type SyncStatus,
} from '@deepseek-ai/dsh-sync-protocol'
import { loadQueue, saveQueue, type OutboxDocument, type OutboxItem } from './queue.ts'

export type { OutboxDocument, OutboxItem } from './queue.ts'

/** Maximum delivery attempts before a row stays `failed` until {@link SyncOutbox.retryFailed}. */
export const MAX_DELIVERY_ATTEMPTS = 8

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Local durable cloud-sync queue. */
    syncOutbox: SyncOutbox
  }
}

/** Deployment choices for the local outbox. Invalid values fail plugin load. */
export interface Config {
  /** Sync server origin, for example `https://sync.example`. Empty queues locally without HTTP. */
  serverUrl?: string
  /** Environment variable holding the device bearer credential. */
  deviceCredentialEnv?: string
  /** Inclusive envelope cap per batch. */
  maxBatchEvents?: number
  /** Base backoff in milliseconds; doubled after each failed attempt. */
  retryBaseMs?: number
  /** JSON queue path; omission uses `$DSH_HOME/sync-outbox.json`. */
  queuePath?: string
  /** Cloud project used when capturing session events. */
  projectId?: string
  /** Device used when capturing session events. */
  deviceId?: string
}

/** Aggregated queue counts and the derived overall status. */
export interface SyncOutboxSnapshot {
  /** Derived from counts: failed, else syncing, else pending, else synced. */
  readonly status: SyncStatus
  /** Rows waiting for a delivery attempt. */
  readonly pendingCount: number
  /** Rows whose HTTP request is in flight. */
  readonly syncingCount: number
  /** Rows acknowledged by the server. */
  readonly syncedCount: number
  /** Rows that exhausted {@link MAX_DELIVERY_ATTEMPTS}. */
  readonly failedCount: number
}

/**
 * Enqueue request: a complete batch, or events that the service wraps using
 * the configured project and device.
 */
export interface EnqueueRequest {
  /** Optional caller-assigned batch id; omission mints a UUID. */
  readonly id?: string
  /** Cloud project; required when Config omitted `projectId`. */
  readonly projectId?: string
  /** Device; required when Config omitted `deviceId`. */
  readonly deviceId?: string
  /** Envelopes to redact, validate, and store. */
  readonly events: readonly SyncEventEnvelope[]
}

/** Local durable cloud-sync queue (`ctx.syncOutbox`). */
export class SyncOutbox extends Service {
  static inject: string[] = []

  static Config: z<Config> = z.object({
    serverUrl: z.string().default(''),
    deviceCredentialEnv: z.string().default('STUDIO_DEVICE_CREDENTIAL'),
    maxBatchEvents: z.number().default(DEFAULT_MAX_BATCH_EVENTS),
    retryBaseMs: z.number().default(1_000),
    queuePath: z.string().default(''),
    projectId: z.string().default(''),
    deviceId: z.string().default(''),
  })

  private readonly serverUrl: string
  private readonly deviceCredentialEnv: string
  private readonly maxBatchEvents: number
  private readonly retryBaseMs: number
  private readonly queuePath: string
  private readonly projectId: StudioProjectId | undefined
  private readonly deviceId: DeviceId | undefined
  private readonly ready: Promise<void>
  private chain: Promise<unknown> = Promise.resolve()
  private document: OutboxDocument = { version: 1, items: [] }
  private draining = false
  private disposed = false
  private timer: ReturnType<typeof setTimeout> | undefined

  /**
   * @param ctx - plugin context; disposal stops retries and waits for in-flight work.
   * @param config - validated queue, server, and retry configuration.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'syncOutbox')
    this.serverUrl = trimOrigin(orDefault(config.serverUrl, ''))
    this.deviceCredentialEnv = orDefault(config.deviceCredentialEnv, 'STUDIO_DEVICE_CREDENTIAL')
    this.maxBatchEvents = orDefault(config.maxBatchEvents, DEFAULT_MAX_BATCH_EVENTS)
    this.retryBaseMs = orDefault(config.retryBaseMs, 1_000)
    if (!Number.isSafeInteger(this.maxBatchEvents) || this.maxBatchEvents < 1) {
      throw new TypeError(`sync-outbox: maxBatchEvents must be a positive safe integer, got ${String(this.maxBatchEvents)}`)
    }
    if (!Number.isSafeInteger(this.retryBaseMs) || this.retryBaseMs < 1) {
      throw new TypeError(`sync-outbox: retryBaseMs must be a positive safe integer, got ${String(this.retryBaseMs)}`)
    }
    if (this.deviceCredentialEnv.trim().length === 0) {
      throw new TypeError('sync-outbox: deviceCredentialEnv must be a non-empty environment variable name')
    }
    this.queuePath = nonempty(config.queuePath) ?? join(resolveDshHome(), 'sync-outbox.json')
    this.projectId = optionalId(config.projectId, StudioProjectId)
    this.deviceId = optionalId(config.deviceId, DeviceId)
    let markReady!: () => void
    this.ready = new Promise<void>((resolve) => {
      markReady = resolve
    })
    ctx.effect(async () => {
      this.document = await loadQueue(this.queuePath)
      markReady()
      this.scheduleDrain(0)
      return () => {
        this.disposed = true
        if (this.timer !== undefined) clearTimeout(this.timer)
        this.timer = undefined
        return this.chain.then(() => undefined)
      }
    })
    ctx.inject(['sessions'], (child) => {
      child.on('session/event', (session: Session, event: SessionEvent) => {
        if (this.projectId === undefined || this.deviceId === undefined) return
        void this.enqueue({
          events: [{
            id: `${session.id}:${String(event.seq)}`,
            seq: event.seq,
            type: event.type,
            time: event.time,
            data: event.data,
            sessionId: session.id,
          }],
        })
      })
    })
  }

  /**
   * Redact, validate, and append one batch. Duplicate batch ids return the
   * existing row without changing its status.
   * @param request - events plus optional ids.
   * @returns the stored batch after redaction.
   */
  async enqueue(request: EnqueueRequest): Promise<SyncBatch> {
    await this.ready
    return this.serialize(async () => {
      const projectId = this.projectId ?? StudioProjectId(requireField(request.projectId, 'projectId'))
      const deviceId = this.deviceId ?? DeviceId(requireField(request.deviceId, 'deviceId'))
      const events = request.events.map(redactEnvelope)
      const batch: SyncBatch = {
        id: SyncBatchId(request.id ?? randomUUID()),
        projectId,
        deviceId,
        baseSeq: events[0]?.seq ?? 0,
        events,
      }
      const checked = validateBatch(batch, this.maxBatchEvents)
      if (!checked.ok) {
        throw new Error(`sync-outbox: ${checked.failure.message}`)
      }
      const existing = this.document.items.find(item => item.batch.id === batch.id)
      if (existing !== undefined) return existing.batch
      const item: OutboxItem = {
        batch,
        status: 'pending',
        attempts: 0,
        updatedAt: Date.now(),
      }
      this.document = { version: 1, items: [...this.document.items, item] }
      await this.persist()
      this.scheduleDrain(0)
      return batch
    })
  }

  /**
   * Read aggregated queue counts. Empty queues report `synced`.
   * @returns a detached snapshot.
   */
  status(): SyncOutboxSnapshot {
    return snapshotOf(this.document.items)
  }

  /**
   * Requeue every `failed` row as `pending` and start delivery.
   * @returns after the document is saved.
   */
  async retryFailed(): Promise<void> {
    await this.ready
    await this.serialize(async () => {
      this.document = {
        version: 1,
        items: this.document.items.map(item => item.status === 'failed'
          ? { batch: item.batch, status: 'pending', attempts: 0, updatedAt: Date.now() }
          : item),
      }
      await this.persist()
      this.scheduleDrain(0)
    })
  }

  /**
   * Run delivery until the queue has no pending rows or the service is disposed.
   * @returns after the current drain finishes.
   */
  async drain(): Promise<void> {
    await this.ready
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    await this.serialize(() => this.drainOnce())
  }

  private scheduleDrain(delayMs: number): void {
    if (this.disposed || this.serverUrl.length === 0) return
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.drain()
    }, delayMs)
  }

  private async drainOnce(): Promise<void> {
    if (this.disposed || this.draining || this.serverUrl.length === 0) return
    this.draining = true
    try {
      for (;;) {
        const index = this.document.items.findIndex(item => item.status === 'pending')
        if (index < 0) return
        const current = this.document.items[index]
        /* v8 ignore next -- findIndex guarantees a defined row */
        if (current === undefined) return
        this.document = replaceItem(this.document, index, {
          batch: current.batch,
          status: 'syncing',
          attempts: current.attempts + 1,
          updatedAt: Date.now(),
        })
        /* v8 ignore next -- dispose during the syncing assignment is a drain race */
        if (this.disposed) return
        await this.persist()
        const result = await this.postBatch(current.batch)
        if (this.disposed) return
        const next: OutboxItem = result.ok
          ? { batch: current.batch, status: 'synced', attempts: current.attempts + 1, updatedAt: Date.now() }
          : nextFailure(current, result.message)
        this.document = replaceItem(this.document, index, next)
        await this.persist()
        if (!result.ok && next.status === 'pending') {
          this.scheduleDrain(this.retryBaseMs * (2 ** Math.min(current.attempts, 5)))
          return
        }
      }
    } finally {
      this.draining = false
    }
  }

  private async postBatch(batch: SyncBatch): Promise<{ ok: true } | { ok: false; message: string }> {
    const credential = process.env[this.deviceCredentialEnv]
    if (credential === undefined || credential.length === 0) {
      return { ok: false, message: `missing environment variable ${this.deviceCredentialEnv}` }
    }
    try {
      const response = await fetch(`${this.serverUrl}/v1/batches`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${credential}`,
        },
        body: JSON.stringify(batch),
      })
      if (response.ok || response.status === 409) return { ok: true }
      const body = await response.text()
      return { ok: false, message: `HTTP ${String(response.status)} ${body}`.trim() }
    } catch (error: unknown) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  private async persist(): Promise<void> {
    if (this.disposed) return
    try {
      await saveQueue(this.queuePath, this.document)
    } catch (error: unknown) {
      /* v8 ignore start -- dispose can remove the queue directory while saveQueue is in flight */
      if (this.disposed) return
      throw error
      /* v8 ignore stop */
    }
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const run = this.chain.then(work, work)
    this.chain = run.then(() => undefined, () => undefined)
    return run
  }
}

export default SyncOutbox

function snapshotOf(items: readonly OutboxItem[]): SyncOutboxSnapshot {
  let pendingCount = 0
  let syncingCount = 0
  let syncedCount = 0
  let failedCount = 0
  for (const item of items) {
    switch (item.status) {
      case 'pending': pendingCount += 1; break
      case 'syncing': syncingCount += 1; break
      case 'synced': syncedCount += 1; break
      case 'failed': failedCount += 1; break
    }
  }
  const status: SyncStatus = failedCount > 0
    ? 'failed'
    : syncingCount > 0
      ? 'syncing'
      : pendingCount > 0
        ? 'pending'
        : 'synced'
  return { status, pendingCount, syncingCount, syncedCount, failedCount }
}

function replaceItem(document: OutboxDocument, index: number, item: OutboxItem): OutboxDocument {
  const items = document.items.slice()
  items[index] = item
  return { version: 1, items }
}

function nextFailure(current: OutboxItem, message: string): OutboxItem {
  const attempts = current.attempts + 1
  const status: SyncStatus = attempts >= MAX_DELIVERY_ATTEMPTS ? 'failed' : 'pending'
  return { batch: current.batch, status, attempts, lastError: message, updatedAt: Date.now() }
}

function redactEnvelope(envelope: SyncEventEnvelope): SyncEventEnvelope {
  const data = redactJsonValue(envelope.data)
  const sessionId = envelope.sessionId
  return sessionId === undefined
    ? { id: envelope.id, seq: envelope.seq, type: envelope.type, time: envelope.time, data }
    : { id: envelope.id, seq: envelope.seq, type: envelope.type, time: envelope.time, data, sessionId }
}

function trimOrigin(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  if (trimmed.length === 0) return ''
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new TypeError(`sync-outbox: serverUrl must be http(s), got ${JSON.stringify(parsed.protocol)}`)
    }
    return trimmed
  } catch (error: unknown) {
    if (error instanceof TypeError && String(error.message).startsWith('sync-outbox:')) throw error
    throw new TypeError(`sync-outbox: invalid serverUrl ${JSON.stringify(url)}`)
  }
}

function requireField(value: string | undefined, name: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`sync-outbox: ${name} is required`)
  }
  return value
}

function optionalId<T>(value: string | undefined, brand: (value: string) => T): T | undefined {
  const text = nonempty(value)
  return text === undefined ? undefined : brand(text)
}

function nonempty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

function orDefault<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value
}
