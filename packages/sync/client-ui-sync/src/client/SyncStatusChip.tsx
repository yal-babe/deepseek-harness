import type { SyncStatus } from '@deepseek-ai/dsh-sync-protocol'
import { StateDot, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './SyncStatusChip.module.css'

/** Aggregated outbox counts shown in the session header. */
export interface SyncStatusSnapshot {
  /** Derived overall status. */
  readonly status: SyncStatus
  /** Rows waiting for a delivery attempt. */
  readonly pendingCount: number
  /** Rows that exhausted the delivery budget. */
  readonly failedCount: number
}

/** Registration-side business face for the sync status chip. */
export interface SyncStatusInjected {
  hooks: {
    /** Snapshot store bound by the renderer as `useSyncStatus`. */
    syncStatus: {
      getSnapshot(): SyncStatusSnapshot
      subscribe(listener: () => void): () => void
    }
  }
}

/** Full props for the session-header sync status chip. */
export type SyncStatusChipProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<typeof NS>
  & InjectFace<SyncStatusInjected>

const DOT: Record<SyncStatus, StateDotState> = {
  pending: 'idle',
  syncing: 'ongoing',
  synced: 'done',
  failed: 'error',
}

/**
 * Compact session-header chip for local outbox status.
 * @param props - locale, session runtime, and the injected snapshot hook.
 * @returns the status chip.
 */
export function SyncStatusChip(props: SyncStatusChipProps): React.JSX.Element {
  const snapshot = props.useSyncStatus(value => value)
  const label = labelOf(snapshot, props.t)
  return (
    <span className={css.chip} data-status={snapshot.status} aria-label={props.t('chip.aria')}>
      <StateDot state={DOT[snapshot.status]} />
      {label}
    </span>
  )
}

function labelOf(snapshot: SyncStatusSnapshot, t: SyncStatusChipProps['t']): string {
  switch (snapshot.status) {
    case 'pending':
      return t('status.pending', { count: snapshot.pendingCount })
    case 'syncing':
      return t('status.syncing')
    case 'synced':
      return t('status.synced')
    case 'failed':
      return t('status.failed', { count: snapshot.failedCount })
  }
}
