# 云同步

[English](sync.md) | 中文

Studio 项目事件批次、独占设备租约与项目记忆的类型。[sync 组地图](../../packages/sync/README.zh.md)列出协议库、本地 outbox、HTTP 服务器、记忆插件与标题栏芯片。本页记录 [`packages/sync/sync-protocol/src/types.ts`](../../packages/sync/sync-protocol/src/types.ts) 中的精确字段。

## 标识与状态

`StudioProjectId`、`DeviceId`、`SyncBatchId` 与 `MemoryId` 是匹配 `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$` 的品牌化字符串。`SyncStatus` 为 `'pending' | 'syncing' | 'synced' | 'failed'`。`MemoryKind` 为 `'goal' | 'constraint' | 'decision' | 'fact' | 'progress' | 'blocker'`。

## 批次

```ts type-equiv
/**
 * One durable session or memory event carried in a sync batch. `id` is the
 * producer-assigned stable identity used for idempotent commit.
 */
interface SyncEventEnvelope {
  /** Producer-assigned stable event identity. */
  readonly id: string
  /** Monotonic sequence in the producing stream; batches must be nondecreasing. */
  readonly seq: number
  /** Event type string copied from the producing log. */
  readonly type: string
  /** Unix epoch milliseconds when the producer committed the event. */
  readonly time: number
  /** JSON-compatible payload after secret redaction. */
  readonly data: unknown
  /** Owning session when the event came from a session log. */
  readonly sessionId?: string
}
```

```ts type-equiv
/** One idempotent batch of redacted events for a single project and device. */
interface SyncBatch {
  /** Stable batch identity; a repeated POST with the same id is a no-op commit. */
  readonly id: SyncBatchId
  /** Cloud project that owns the events. */
  readonly projectId: StudioProjectId
  /** Device that produced the batch. */
  readonly deviceId: DeviceId
  /** Inclusive sequence of the first event in this batch. */
  readonly baseSeq: number
  /** Redacted envelopes in nondecreasing `seq` order. */
  readonly events: readonly SyncEventEnvelope[]
}
```

`validateBatch` 拒绝空批次、超过配置上限（默认 100）的批次、无效标识、非有限 `seq` 以及递减的 `seq`。连续相等的 `seq` 是允许的。

## 租约

```ts type-equiv
/** Exclusive execution lease for one cloud project. */
interface DeviceLease {
  /** Project the lease covers. */
  readonly projectId: StudioProjectId
  /** Device currently holding exclusive execution, if any. */
  readonly deviceId: DeviceId | null
  /** Unix epoch milliseconds when the lease expires; null when free. */
  readonly holderUntil: number | null
  /** Monotonic generation; takeover must present the current value. */
  readonly generation: number
}
```

## 记忆

```ts type-equiv
/** One project-memory record stored locally or on the sync server. */
interface MemoryRecord {
  /** Stable memory identity. */
  readonly id: MemoryId
  /** Cloud project that owns the record. */
  readonly projectId: StudioProjectId
  /** Structured kind used for retrieval filters. */
  readonly kind: MemoryKind
  /** Redacted body shown to the model after a logged injection. */
  readonly text: string
  /** Human- or agent-visible origin of the record. */
  readonly source: string
  /** Unix epoch milliseconds of first commit. */
  readonly createdAt: number
  /** Unix epoch milliseconds of the latest revision. */
  readonly updatedAt: number
  /** Replacement record id when this row is superseded. */
  readonly supersededBy?: MemoryId
  /** Optional git revision associated with the recorded fact. */
  readonly gitRev?: string
}
```

匹配的本地记录只作为 source kind 为 `sync-memory` 的已记录 `user/message` 事件进入模型。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsyncmemory--syncmemory"></a>

### `ctx.syncMemory` — `SyncMemory`

Project memory store (`ctx.syncMemory`) with logged model injection.

```ts cordis-catalog
/**
 * Create a redacted memory record.
 * @param request - kind, text, and optional source.
 * @returns the stored record.
 */
async create(request: CreateMemoryRequest): Promise<MemoryRecord>

/**
 * Replace a live record by writing a successor and pointing the predecessor at it.
 * @param id - live record to supersede.
 * @param request - successor fields.
 * @returns the successor.
 */
async revise(id: MemoryId, request: CreateMemoryRequest): Promise<MemoryRecord>

/**
 * Search live records. An empty query lists the most recently updated rows.
 * @param query - FTS query.
 * @returns matching live records, newest first, capped by `maxInjectRecords`.
 */
async search(query: string): Promise<MemoryRecord[]>

/**
 * Delete one record and its FTS document.
 * @param id - stored record.
 * @returns after the row is gone.
 */
async remove(id: MemoryId): Promise<void>
```

Source: [`packages/sync/sync-memory/src/index.ts`](../../packages/sync/sync-memory/src/index.ts)

<a id="ctxsyncoutbox--syncoutbox"></a>

### `ctx.syncOutbox` — `SyncOutbox`

Local durable cloud-sync queue (`ctx.syncOutbox`).

```ts cordis-catalog
/**
 * Redact, validate, and append one batch. Duplicate batch ids return the
 * existing row without changing its status.
 * @param request - events plus optional ids.
 * @returns the stored batch after redaction.
 */
async enqueue(request: EnqueueRequest): Promise<SyncBatch>

/**
 * Read aggregated queue counts. Empty queues report `synced`.
 * @returns a detached snapshot.
 */
status(): SyncOutboxSnapshot

/**
 * Requeue every `failed` row as `pending` and start delivery.
 * @returns after the document is saved.
 */
async retryFailed(): Promise<void>

/**
 * Run delivery until the queue has no pending rows or the service is disposed.
 * @returns after the current drain finishes.
 */
async drain(): Promise<void>
```

Source: [`packages/sync/sync-outbox/src/index.ts`](../../packages/sync/sync-outbox/src/index.ts)
<!-- END GENERATED cordis-surface -->
