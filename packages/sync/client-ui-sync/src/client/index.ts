/**
 * Cloud-sync status plugin, browser half: contributes one session-header
 * utility chip. Live Host transport is injected; tests and the default
 * snapshot report `synced` until a Host remote exists.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { SyncStatusChip } from './SyncStatusChip.tsx'
import type { SyncStatusInjected, SyncStatusSnapshot } from './SyncStatusChip.tsx'
import { en, NS, zh, type SyncStatusKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Cloud-sync status copy. */
    'sync-status': SyncStatusKey
  }
}

export type { SyncStatusChipProps, SyncStatusInjected, SyncStatusSnapshot } from './SyncStatusChip.tsx'

/** Empty outbox: nothing pending, nothing failed. */
export const EMPTY_SYNC_STATUS: SyncStatusSnapshot = {
  status: 'synced',
  pendingCount: 0,
  failedCount: 0,
}

/** Required services: the slot registry and dictionaries. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the dictionaries and the header chip.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const store = createSnapshotStore<SyncStatusSnapshot>(EMPTY_SYNC_STATUS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sync: dictionaries')
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'sync-status',
    order: 30,
    locale: NS,
    inject: (): SyncStatusInjected => ({
      hooks: { syncStatus: store },
    }),
  }, SyncStatusChip))
}
