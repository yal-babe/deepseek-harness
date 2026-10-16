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

<a id="ctxstudiocloud--studiocloud"></a>

### `ctx.studioCloud` — `StudioCloud`

Host owner for Studio device login; signing out retains all local Session and provider data.

```ts cordis-catalog
/**
 * Observe account and synchronization status without exposing credentials.
 * @param signal - subscriber lifetime; disconnecting does not sign the account out.
 * @returns complete safe snapshots, including the initial state.
 */
@Remote({ mode: 'stream' }) async *watch(signal: AbortSignal): AsyncIterable<StudioState>

/**
 * Register an owner-declared allowlist and importer; undeclared plugin data is never exported.
 * @param contribution - versioned contribution owned by the registering plugin.
 * @returns disposer; callers register it through their Cordis effect.
 */
register(contribution: SyncContribution): () => void

/**
 * Read restored project metadata and its per-device binding requirements.
 * @returns cloud project titles and local registry IDs, without directory paths.
 */
@Remote projectsToBind(): Promise<{ id: string; title: string; localId: string | null }[]>

/**
 * Bind one restored cloud project to an existing directory-backed local workspace.
 * @param id - selected cloud project ID.
 * @param localId - workspace selected on this device.
 * @returns after the mapping is stored; no cloud request contains the local path.
 */
@Remote({ resources: { workspace: (_id: string, localId: WorkspaceId) => localId } }) bindProject(id: string, localId: WorkspaceId): Promise<void>

/**
 * Remove binding between a cloud project and a local workspace.
 * @param id - selected cloud project ID.
 * @returns after the mapping is cleared.
 */
@Remote unbindProject(id: string): Promise<void>

/**
 * List explicitly downloaded histories without contacting the server or creating Agents.
 * @returns account-isolated history metadata and missing attachment requirements.
 */
@Remote historiesList():Promise<StudioHistoryItem[]>

/**
 * Read a downloaded immutable history, including its canonical projected model messages.
 * @param id - history chosen from this account's downloaded list.
 * @returns read-only messages and required local restoration actions.
 */
@Remote readHistory(id:string):Promise<StudioHistoryView>

/**
 * Fork an immutable downloaded history into a new local branch session within a selected workspace.
 * @param id - cloud history object ID.
 * @param workspaceId - existing local workspace ID.
 * @param preset - optional agent preset ID.
 * @param requestId - optional idempotent request UUID.
 * @returns newly created child Session ID.
 */
@Remote({ resources: { workspace: (_id: string, workspaceId: WorkspaceId) => workspaceId } }) forkHistory( id: string, workspaceId: WorkspaceId, preset?: string, requestId?: string, ): Promise<StudioContinuationResult>

/**
 * Read aggregate deduplicated token usage across synchronized sessions.
 * @returns token metrics and turn counts.
 */
@Remote tokenActivity(): Promise<StudioTokenActivity>

/**
 * Update the account display name and trigger synchronization.
 * @param displayName - new display name.
 * @returns after updating local credentials and queueing sync.
 */
@Remote updateProfile(displayName: string): Promise<void>

/**
 * Read restored plugins recorded from cloud sync for user review.
 * @returns restored plugin list compared with current local inventory.
 */
@Remote restoredPlugins(): Promise<StudioRestoredPlugin[]>

/**
 * Preview local allowlisted data and the current cloud snapshot without uploading.
 * @returns local/cloud values and supported-version markers for explicit selection.
 */
@Remote preview(): Promise<StudioPreviewRow[]>

/**
 * Confirm the selected data and enable future sync for those objects only.
 * @param choices - preview object IDs, expected cloud versions, and chosen local or cloud source.
 * @returns after selected imports and uploads; conflicts retain both values.
 */
@Remote select(choices: { id: string; source: 'local' | 'cloud'; version: number }[]): Promise<void>

/**
 * Retry queued immutable requests and synchronize opted-in objects.
 * @returns after the selected objects settle; failures remain visible in account status.
 */
@Remote synchronize(): Promise<void>

/**
 * Pause or resume future syncing without deleting local or cloud data.
 * @param paused - whether syncing is stopped.
 * @returns after the choice is persisted for this account.
 */
@Remote pause(paused: boolean): Promise<void>

/**
 * Read safe connection status; no local data is uploaded by this method.
 * @returns signed-out, preview-required, unsupported, or reauthentication state.
 */
@Remote getState(): Promise<StudioState>

/**
 * Sign in to an explicitly selected server; this never enables synchronization.
 * @param origin - root service URL.
 * @param login - username or verified email.
 * @param password - transient password, never persisted.
 * @param deviceName - name displayed in device management.
 * @param allowHttp - explicit acceptance of an unencrypted deployment connection.
 * @returns safe account identity; temporary accounts must change their password first.
 */
@Remote signIn( origin: string, login: string, password: string, deviceName: string, allowHttp: boolean, ): Promise<StudioIdentity>

/**
 * Stop outstanding account operations and remove the local grant before attempting remote revocation.
 * @returns whether server revocation was confirmed; false requires revoking this device from another login.
 */
@Remote signOut(): Promise<{ revoked: boolean }>

/**
 * Read authorized devices, including the current device marker.
 * @returns safe device records.
 */
@Remote devices(): Promise<{ id: string; deviceName: string; current: boolean; lastSeen: string }[]>

/**
 * Revoke one device; revoking this device also clears its local grant.
 * @param id - server-issued device ID selected from devices.
 * @returns after revocation is confirmed.
 */
@Remote revokeDevice(id: string): Promise<void>

/**
 * Accept an invitation without signing in or enabling sync.
 * @param origin - explicitly selected service URL.
 * @param token - single-use invitation token.
 * @param username - requested account name.
 * @param password - initial transient password.
 * @param allowHttp - explicit HTTP consent.
 * @returns after server acceptance.
 */
@Remote acceptInvite(origin: string, token: string, username: string, password: string, allowHttp: boolean): Promise<void>

/**
 * Request a reset mail; the server deliberately does not reveal account existence.
 * @param origin - selected service URL.
 * @param email - verified address.
 * @param allowHttp - explicit HTTP consent.
 * @returns after the request is accepted.
 */
@Remote forgotPassword(origin: string, email: string, allowHttp: boolean): Promise<void>

/**
 * Consume a password-reset token; existing sessions are revoked by the server.
 * @param origin - selected service URL.
 * @param token - one-time mail token.
 * @param password - replacement transient password.
 * @param allowHttp - explicit HTTP consent.
 * @returns after password reset is confirmed.
 */
@Remote resetPassword(origin: string, token: string, password: string, allowHttp: boolean): Promise<void>

/**
 * Verify a one-time email token at its explicitly selected issuer.
 * @param origin - selected service URL.
 * @param token - email verification token.
 * @param allowHttp - explicit HTTP consent.
 * @returns after email verification is confirmed.
 */
@Remote verifyEmail(origin: string, token: string, allowHttp: boolean): Promise<void>

/**
 * Request verification before changing the signed-in account email.
 * @param email - proposed address.
 * @param password - current transient password.
 * @returns after the verification request is accepted.
 */
@Remote bindEmail(email: string, password: string): Promise<void>

/**
 * Change an initial or current password. Server success invalidates all device grants.
 * @param currentPassword - current transient password.
 * @param newPassword - replacement transient password.
 * @returns after local credentials are cleared; a lost response requires signing in again.
 */
@Remote changePassword(currentPassword: string, newPassword: string): Promise<void>
```

Types: [WorkspaceId](workspace.zh.md)

Source: [`packages/sync/studio-cloud/src/index.ts`](../../packages/sync/studio-cloud/src/index.ts)

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
