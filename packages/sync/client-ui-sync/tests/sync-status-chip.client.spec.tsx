// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SyncStatusChip, type SyncStatusChipProps, type SyncStatusSnapshot } from '../src/client/SyncStatusChip.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
})

const SESSION = 'session' as SessionId
const t: SyncStatusChipProps['t'] = makeTranslate(zh)

function props(snapshot: SyncStatusSnapshot): SyncStatusChipProps {
  return {
    sessionId: SESSION,
    useSyncStatus: <T,>(select: (value: SyncStatusSnapshot) => T): T => select(snapshot),
    t,
  } as SyncStatusChipProps
}

describe('SyncStatusChip', () => {
  it('renders synced, pending, syncing, and failed labels', () => {
    const { rerender } = render(<SyncStatusChip {...props({ status: 'synced', pendingCount: 0, failedCount: 0 })} />)
    expect(screen.getByLabelText('云同步状态').textContent).toContain('已同步')

    rerender(<SyncStatusChip {...props({ status: 'pending', pendingCount: 3, failedCount: 0 })} />)
    expect(screen.getByLabelText('云同步状态').textContent).toContain('待同步 3')

    rerender(<SyncStatusChip {...props({ status: 'syncing', pendingCount: 1, failedCount: 0 })} />)
    expect(screen.getByLabelText('云同步状态').textContent).toContain('正在同步')

    rerender(<SyncStatusChip {...props({ status: 'failed', pendingCount: 0, failedCount: 2 })} />)
    expect(screen.getByLabelText('云同步状态').textContent).toContain('同步失败 2')
    expect(screen.getByLabelText('云同步状态').getAttribute('data-status')).toBe('failed')
  })
})
