import { describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { browserNotifications, diffNotices, mayNotify, watchNotices, type NotificationSink } from '../src/client/notifier.ts'
import type { PetPreferences } from '../src/client/preferences.ts'
import type { PetViewState } from '../src/client/store.ts'
import { hostPending, S1, S2, sessionView, snapshot } from './fixtures.ts'

describe('diffNotices', () => {
  it('reports new approvals and fresh results, never on the first frame', () => {
    const before = snapshot({ sessions: [sessionView(S1, { state: 'WORKING', title: 'Fix CI' }), sessionView(S2, { state: 'ERROR' })] })
    expect(diffNotices(undefined, before)).toEqual([])
    const after = snapshot({
      pending: [hostPending('r1', S1, 'bash')],
      sessions: [
        sessionView(S1, { state: 'SUCCESS', title: 'Fix CI' }),
        sessionView(S2, { state: 'ERROR' }),
        sessionView(S2, { state: 'ERROR', subagent: true }),
      ],
    })
    expect(diffNotices(before, after)).toEqual([
      { kind: 'waiting', sessionId: S1, title: 'Fix CI', toolName: 'bash', tag: 'pet-approval-r1' },
      { kind: 'success', sessionId: S1, title: 'Fix CI', tag: `pet-success-${S1}` },
    ])
    const failed = snapshot({ pending: after.pending, sessions: [sessionView(S1, { state: 'ERROR' }), sessionView(S2, { state: 'IDLE' })] })
    expect(diffNotices(after, failed)).toEqual([{ kind: 'error', sessionId: S1, title: undefined, tag: `pet-error-${S1}` }])
  })
})

describe('mayNotify', () => {
  it('needs opt-in, no snooze, and an unfocused document', () => {
    const on: PetPreferences = { notify: true, snoozeUntil: undefined }
    expect(mayNotify(on, 0, false)).toBe(true)
    expect(mayNotify(on, 0, true)).toBe(false)
    expect(mayNotify({ notify: false, snoozeUntil: undefined }, 0, false)).toBe(false)
    expect(mayNotify({ notify: true, snoozeUntil: 10 }, 0, false)).toBe(false)
  })
})

describe('browserNotifications', () => {
  it('binds the Web Notification API when present', async () => {
    expect(browserNotifications({})).toBeUndefined()
    const created: { title: string; options: { body: string; tag: string }; onclick: ((event: Event) => unknown) | null }[] = []
    class FakeNotification {
      static permission = 'granted' as const
      static requestPermission = vi.fn(async () => 'denied' as const)
      onclick: ((event: Event) => unknown) | null = null
      constructor(readonly title: string, readonly options: { body: string; tag: string }) { created.push(this) }
    }
    const sink = browserNotifications({ Notification: FakeNotification })!
    expect(sink.permission()).toBe('granted')
    expect(await sink.request()).toBe('denied')
    const onClick = vi.fn()
    sink.show('t', 'b', 'tag', onClick)
    expect(created[0]).toMatchObject({ title: 't', options: { body: 'b', tag: 'tag' } })
    created[0]!.onclick?.(new Event('click'))
    expect(onClick).toHaveBeenCalled()
  })
})

describe('watchNotices', () => {
  it('shows notices for allowed changes and opens the app on click', () => {
    const view = createSnapshotStore<PetViewState>({ connected: true, snapshot: undefined }, { flush: 'sync' })
    const preferences = createSnapshotStore<PetPreferences>({ notify: true, snoozeUntil: undefined }, { flush: 'sync' })
    let permission: 'default' | 'granted' | 'denied' = 'granted'
    let focused = false
    const clicks: (() => void)[] = []
    const show = vi.fn((_title: string, _body: string, _tag: string, onClick: () => void) => { clicks.push(onClick) })
    const sink: NotificationSink = { permission: () => permission, request: async () => permission, show }
    const open = vi.fn()
    const stop = watchNotices({
      view, preferences, sink, open, focused: () => focused, now: () => 0,
      text: notice => ({ title: notice.kind, body: notice.title ?? '-' }),
    })
    const base = snapshot({ sessions: [sessionView(S1, { state: 'WORKING' })] })
    view.set({ connected: true, snapshot: base })
    view.set({ connected: false, snapshot: base })
    view.set({ connected: true, snapshot: snapshot({ sessions: [sessionView(S1, { state: 'WORKING', title: 'x' })] }) })
    expect(show).not.toHaveBeenCalled()
    view.set({ connected: true, snapshot: snapshot({ sessions: [sessionView(S1, { state: 'SUCCESS', title: 'x' })] }) })
    expect(show).toHaveBeenCalledWith('success', 'x', `pet-success-${S1}`, expect.any(Function))
    clicks[0]!()
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }))
    focused = true
    view.set({ connected: true, snapshot: snapshot({ sessions: [sessionView(S1, { state: 'ERROR' })] }) })
    permission = 'denied'
    focused = false
    view.set({ connected: true, snapshot: snapshot({ sessions: [sessionView(S1, { state: 'SUCCESS' })] }) })
    expect(show).toHaveBeenCalledOnce()
    view.set({ connected: true, snapshot: undefined })
    stop()
  })
})
