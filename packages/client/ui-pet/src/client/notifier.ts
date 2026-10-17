/**
 * System notifications for moments that need the user: a new approval, or a
 * Session finishing or failing. Only state changes between two Host frames
 * notify; the first frame after connecting never does. Each category follows
 * the Host pet settings (`snapshot.settings.notify`); the device-local switch
 * and snooze gate all of them.
 */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { PetNoticeKind, PetSnapshot } from '@deepseek-ai/dsh-pet/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { isSnoozed, type PetPreferences } from './preferences.ts'
import type { PetViewState } from './store.ts'

/** One notification-worthy change. */
export interface PetNotice {
  /** What happened. */
  readonly kind: PetNoticeKind
  /** Session it concerns. */
  readonly sessionId: SessionId
  /** Session title, when known. */
  readonly title: string | undefined
  /** Tool waiting for approval, for `waiting`. */
  readonly toolName?: string | undefined
  /** De-duplication tag. */
  readonly tag: string
}

/**
 * Compute notices between two snapshots.
 * @param previous - last frame, or `undefined` before the first one.
 * @param next - new frame.
 * @returns notices in a stable order: approvals first, then results; categories turned off in `next.settings` are left out.
 */
export function diffNotices(previous: PetSnapshot | undefined, next: PetSnapshot): PetNotice[] {
  if (previous === undefined) return []
  const titles = new Map(next.sessions.map(view => [view.sessionId, view.title]))
  const known = new Set(previous.pending.map(entry => entry.id))
  const notices: PetNotice[] = []
  for (const entry of next.pending) {
    if (known.has(entry.id)) continue
    notices.push({
      kind: 'waiting', sessionId: entry.sessionId, title: titles.get(entry.sessionId), toolName: entry.toolName, tag: `pet-approval-${entry.id}`,
    })
  }
  const before = new Map(previous.sessions.map(view => [view.sessionId, view.state]))
  for (const view of next.sessions) {
    if (view.subagent || (view.state !== 'SUCCESS' && view.state !== 'ERROR') || before.get(view.sessionId) === view.state) continue
    const kind = view.state === 'SUCCESS' ? 'success' : 'error'
    notices.push({ kind, sessionId: view.sessionId, title: view.title, tag: `pet-${kind}-${view.sessionId}` })
  }
  return notices.filter(notice => next.settings.notify[notice.kind])
}

/**
 * Whether a notice may be shown now.
 * @param preferences - device preferences.
 * @param now - current epoch milliseconds.
 * @param focused - whether the user is looking at this document.
 * @returns whether to notify.
 */
export function mayNotify(preferences: PetPreferences, now: number, focused: boolean): boolean {
  return preferences.notify && !isSnoozed(preferences, now) && !focused
}

/** Platform notification face. */
export interface NotificationSink {
  /** Current permission. */
  readonly permission: () => 'default' | 'granted' | 'denied'
  /** Ask for permission; call from a user gesture. */
  readonly request: () => Promise<'default' | 'granted' | 'denied'>
  /**
   * Show one notification.
   * @param title - heading.
   * @param body - text.
   * @param tag - de-duplication tag.
   * @param onClick - called when the user clicks it.
   */
  readonly show: (title: string, body: string, tag: string, onClick: () => void) => void
}

/** Writable device preference consumed by {@link setDeviceNotify}. */
export interface NotifyPreferenceWriter {
  /**
   * Merge a preference change.
   * @param patch - changed fields.
   */
  readonly update: (patch: { notify: boolean }) => void
}

/**
 * Turn the device-local notification switch on or off. Turning it on asks for
 * permission first (call from a user gesture) and stays off when it is refused.
 * @param sink - platform notifications, or `undefined` without support.
 * @param preferences - device preference writer.
 * @param on - requested value.
 * @returns the resulting value.
 */
export async function setDeviceNotify(
  sink: NotificationSink | undefined, preferences: NotifyPreferenceWriter, on: boolean,
): Promise<boolean> {
  if (on && sink !== undefined && sink.permission() !== 'granted' && await sink.request() !== 'granted') return false
  const value = on && sink !== undefined
  preferences.update({ notify: value })
  return value
}

/** Constructor face of the Web Notification API. */
interface NotificationApi {
  readonly permission: 'default' | 'granted' | 'denied'
  requestPermission(): Promise<'default' | 'granted' | 'denied'>
  new (title: string, options: { body: string; tag: string }): { onclick: ((event: Event) => unknown) | null }
}

/**
 * Bind the Web Notification API when the platform has it.
 * @param scope - global object.
 * @returns a sink, or `undefined` without notification support.
 */
export function browserNotifications(scope: { readonly Notification?: NotificationApi }): NotificationSink | undefined {
  const api = scope.Notification
  if (api === undefined) return undefined
  return {
    permission: () => api.permission,
    request: () => api.requestPermission(),
    show: (title, body, tag, onClick) => {
      const notification = new api(title, { body, tag })
      notification.onclick = onClick
    },
  }
}

/** Collaborators of {@link watchNotices}. */
export interface NoticeWatch {
  /** Host snapshot source. */
  readonly view: ObservableSnapshot<PetViewState>
  /** Device preferences. */
  readonly preferences: ObservableSnapshot<PetPreferences>
  /** Platform sink. */
  readonly sink: NotificationSink
  /** Whether the user is looking at this document. */
  readonly focused: () => boolean
  /** Current epoch milliseconds. */
  readonly now: () => number
  /**
   * Notification copy.
   * @param notice - change to describe.
   * @returns heading and text.
   */
  readonly text: (notice: PetNotice) => { readonly title: string; readonly body: string }
  /**
   * Handle a click on a notification.
   * @param notice - clicked change.
   */
  readonly open: (notice: PetNotice) => void
}

/**
 * Show a system notification for each notice-worthy change of the Host snapshot.
 * @param watch - collaborators.
 * @returns stops watching.
 */
export function watchNotices(watch: NoticeWatch): () => void {
  let previous = watch.view.getSnapshot().snapshot
  return watch.view.subscribe(() => {
    const next = watch.view.getSnapshot().snapshot
    if (next === undefined || next === previous) return
    const notices = diffNotices(previous, next)
    previous = next
    if (notices.length === 0 || watch.sink.permission() !== 'granted') return
    if (!mayNotify(watch.preferences.getSnapshot(), watch.now(), watch.focused())) return
    for (const notice of notices) {
      const { title, body } = watch.text(notice)
      watch.sink.show(title, body, notice.tag, () => { watch.open(notice) })
    }
  })
}
