/** Parallel Codex / Antigravity quota reads for Account settings and Personal Center. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  AntigravityQuotaView, CodexQuotaView, ConsumeCodexResetResult, ProviderQuotaView, QuotaProviderId,
} from '@deepseek-ai/dsh-api-provider-quota/types'

/** Client Remote slice this store calls. */
export interface QuotaRemote {
  providerQuota: {
    get(provider: QuotaProviderId): Promise<RemoteResult<ProviderQuotaView>>
    consumeCodexReset(): Promise<RemoteResult<ConsumeCodexResetResult>>
  }
}

/** Combined quota card state. */
export interface QuotaSnapshot {
  status: 'idle' | 'loading' | 'ready' | 'failed'
  codex: CodexQuotaView | null
  antigravity: AntigravityQuotaView | null
  consumeBusy: boolean
  notice: { kind: 'ok' | 'error'; textKey: 'resetOk' | 'resetFailed' } | null
}

const unsignedCodex = (): CodexQuotaView => ({
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
})

const unsignedAntigravity = (): AntigravityQuotaView => ({
  provider: 'antigravity',
  status: 'unsigned',
  plan: null,
  tierId: null,
  groups: [],
})

const initial = (): QuotaSnapshot => ({
  status: 'idle',
  codex: null,
  antigravity: null,
  consumeBusy: false,
  notice: null,
})

/** Loads both provider cards in parallel and keeps a failed card retryable. */
export class QuotaStore {
  /** Snapshot store holding the latest provider quota state. */
  readonly store: SnapshotStore<QuotaSnapshot>
  private generation = 0

  /**
   * @param remote - Client Remote carrying `providerQuota`.
   */
  constructor(private readonly remote: QuotaRemote) {
    this.store = createSnapshotStore(initial())
  }

  /** Dispose the snapshot store. */
  dispose(): void {
    this.generation += 1
  }

  /**
   * Refresh both providers. A single-provider failure still publishes the other card.
   */
  async refresh(): Promise<void> {
    const generation = ++this.generation
    const previous = this.store.getSnapshot()
    this.store.set({
      ...previous,
      status: previous.codex === null && previous.antigravity === null ? 'loading' : previous.status,
      notice: null,
    })
    const [codex, antigravity] = await Promise.all([
      this.remote.providerQuota.get('codex').then((value) => {
        if (!value.ok || value.value.provider !== 'codex') {
          return { ...unsignedCodex(), status: 'failed' as const, error: 'failed' }
        }
        return value.value
      }).catch((): CodexQuotaView => ({ ...unsignedCodex(), status: 'failed', error: 'failed' })),
      this.remote.providerQuota.get('antigravity').then((value) => {
        if (!value.ok || value.value.provider !== 'antigravity') {
          return { ...unsignedAntigravity(), status: 'failed' as const, error: 'failed' }
        }
        return value.value
      }).catch((): AntigravityQuotaView => ({ ...unsignedAntigravity(), status: 'failed', error: 'failed' })),
    ])
    if (generation !== this.generation) return
    const failed = codex.status === 'failed' && antigravity.status === 'failed'
    this.store.set({
      status: failed ? 'failed' : 'ready',
      codex,
      antigravity,
      consumeBusy: false,
      notice: null,
    })
  }

  /**
   * Redeem one Codex reset credit. On failure the existing card is kept.
   */
  async consumeReset(): Promise<void> {
    const current = this.store.getSnapshot()
    if (current.consumeBusy) return
    this.store.set({ ...current, consumeBusy: true, notice: null })
    try {
      const result = await this.remote.providerQuota.consumeCodexReset()
      const snapshot = this.store.getSnapshot()
      if (!result.ok) {
        this.store.set({ ...snapshot, consumeBusy: false, notice: { kind: 'error', textKey: 'resetFailed' } })
        return
      }
      this.store.set({
        ...snapshot,
        consumeBusy: false,
        status: 'ready',
        codex: result.value.quota.status === 'unsigned' ? snapshot.codex : result.value.quota,
        notice: { kind: result.value.ok ? 'ok' : 'error', textKey: result.value.ok ? 'resetOk' : 'resetFailed' },
      })
    } catch {
      const snapshot = this.store.getSnapshot()
      this.store.set({ ...snapshot, consumeBusy: false, notice: { kind: 'error', textKey: 'resetFailed' } })
    }
  }

  /** Drop the last toast. */
  dismissNotice(): void {
    const snapshot = this.store.getSnapshot()
    if (snapshot.notice === null) return
    this.store.set({ ...snapshot, notice: null })
  }
}
