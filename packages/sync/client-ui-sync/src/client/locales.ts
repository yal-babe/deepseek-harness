/** `sync-status` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'sync-status'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'status.pending': '待同步 {count}',
  'status.syncing': '正在同步',
  'status.synced': '已同步',
  'status.failed': '同步失败 {count}',
  'chip.aria': '云同步状态',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<SyncStatusKey, string> = {
  'status.pending': '{count} pending',
  'status.syncing': 'Syncing',
  'status.synced': 'Synced',
  'status.failed': '{count} failed',
  'chip.aria': 'Cloud sync status',
}

/** Key domain of the `sync-status` namespace (zh is the source of truth). */
export type SyncStatusKey = keyof typeof zh
