/**
 * Studio Pet browser plugin. On Web it adds the character to `shell.overlay`;
 * inside the Desktop pet window (`?dsh-pet-window=1`) it shadows `root` so the
 * whole document is the pet. Both surfaces read the Host `pet` Remote and
 * answer approvals through ui-approval's pending interactions. Every document
 * except the pet window also registers the pet settings page while ui-settings
 * and the Host `pet` entry are present. The character waits for the
 * `remote.pet` and `remote.session` Remotes as optional services, so a Host
 * without the pet entry still boots and only lacks the character.
 */
import type {} from './metrics-slot.ts'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-approval/client'
import type {} from '@deepseek-ai/dsh-client-file-upload/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { PetController } from './controller.ts'
import { BUILTIN_FRAME_SET, offeredFrameSet, type PetFrameSet } from './frames.ts'
import { browserNotifications, setDeviceNotify, watchNotices, type NotificationSink } from './notifier.ts'
import { PetSettingsSection, type PetSettingsInjected } from './PetSettingsSection.tsx'
import { PET_SETTINGS_NAMESPACE, PetSettingsEditor, type PetSettingsFields } from './settings.ts'
import { PetPreferenceStore, type PreferenceStorage } from './preferences.ts'
import { en, zh, type PetLocaleKey } from './locales.ts'
import { PetOverlay, PetWindowRoot, type PetInjected } from './Pet.tsx'
import type { QuickAskDeps } from './quick-ask.ts'
import { isPetVisible, PetStore } from './store.ts'
import { desktopPetBridge, detectPetSurface, type DesktopPetBridge, type PetSurface } from './surface.ts'

export type { AnswerableApproval, PetDecisionResult } from './approvals.ts'
export { collectApprovals, matchApproval, PetApprovalBridge } from './approvals.ts'
export type { AnswerableQuestion, PetAnswerResult, PetQuestionAnswer, PetQuestionItem, PetQuestionOption } from './questions.ts'
export { collectQuestions, petAnswerable, PetQuestionBridge } from './questions.ts'
export type { PetControllerDeps, QuickAskChoice } from './controller.ts'
export type { NoticeWatch, NotificationSink, NotifyPreferenceWriter, PetNotice } from './notifier.ts'
export { browserNotifications, diffNotices, mayNotify, setDeviceNotify, watchNotices } from './notifier.ts'
export type { PetPreferences, PreferenceEventSource, PreferenceStorage, PreferenceStorageEvent } from './preferences.ts'
export type { PetSettingsInjected, PetSettingsProps } from './PetSettingsSection.tsx'
export { PetSettingsSection } from './PetSettingsSection.tsx'
export type { PetSettingsFields, PetSettingsSwitch, PetSettingsWriteState } from './settings.ts'
export { addRestrictedTool, PET_SETTINGS_NAMESPACE, PetSettingsEditor, removeRestrictedTool } from './settings.ts'
export { isSnoozed, parsePreferences, PET_PREFERENCES_KEY, PET_SNOOZE_MS, PetPreferenceStore } from './preferences.ts'
export { PetController } from './controller.ts'
export type { PetMetricsOwnerProps } from './metrics-slot.ts'
export type { PetLocaleKey } from './locales.ts'
export type { PetInjected, PetMenuAction, PetProps } from './Pet.tsx'
export type { QuickAskDeps, QuickAskOutcome, QuickAskRequest, QuickAskTarget } from './quick-ask.ts'
export { sendQuickAsk } from './quick-ask.ts'
export type { PetViewState } from './store.ts'
export { displayedState, isPetVisible, PetStore } from './store.ts'
export type { DesktopPetBridge, PetSurface } from './surface.ts'
export { detectPetSurface, PET_WINDOW_QUERY } from './surface.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Studio Pet copy. */
    pet: PetLocaleKey
  }
}

/** Required services: Remote, Session status, file upload, Slots, and copy. */
export const inject = ['remote', 'uiSession', 'fileUpload', 'slots', 'locale']

/**
 * Remote sub-services the character reads. Cordis refuses `ctx.remote.<name>`
 * unless `remote.<name>` is injected; they are optional so a Host without the
 * pet entry cannot hold back or fail web boot.
 */
export const SURFACE_INJECT = ['remote.pet', 'remote.session'] as const

const NS = 'pet'

function quickAskDeps(ctx: ClientContext): QuickAskDeps {
  return {
    createSession: cwd => ctx.remote.session.create(cwd === undefined ? {} : { cwd }),
    upload: async (sessionId, file, name, signal) => {
      const uploaded = await ctx.fileUpload.upload(sessionId, file, name, signal)
      return uploaded.ok ? { ok: true, value: { receiptId: uploaded.value.receiptId } } : uploaded
    },
    prompt: (request, signal) => ctx.remote.session.prompt(request, signal),
    requestId: () => randomUUID() as SessionRequestId,
  }
}

function storageOf(scope: { readonly localStorage?: PreferenceStorage }): PreferenceStorage | undefined {
  try {
    return scope.localStorage
  } catch {
    // Reading localStorage throws when the profile blocks storage.
    return undefined
  }
}

function makeTransparent(): () => void {
  const targets = [document.documentElement, document.body]
  for (const element of targets) element.style.setProperty('background', 'transparent', 'important')
  return () => { for (const element of targets) element.style.removeProperty('background') }
}

/** Show one Session through ui-workspace navigation when this document has it. */
function openSessionIn(ctx: ClientContext, sessionId: SessionId): void {
  ctx.get('uiWorkspace')?.openSession(sessionId)
}

function registerSettings(ctx: ClientContext, deps: {
  readonly desktop: boolean
  readonly preferences: PetPreferenceStore
  readonly notifications: NotificationSink | undefined
}): void {
  // Optional: a composition without ui-settings keeps the pet and has no settings page.
  ctx.inject(['configForms'], (scope: ClientContext) => {
    const form = scope.configForms.get<PetSettingsFields>(PET_SETTINGS_NAMESPACE)
    const editor = new PetSettingsEditor(form)
    const t = scope.locale.bind(NS)
    const injected = (): PetSettingsInjected => ({
      hooks: { form, write: editor.state, preferences: deps.preferences.snapshot },
      desktop: deps.desktop,
      canNotify: deps.notifications !== undefined,
      setSwitch: (field, value) => editor.setSwitch(field, value),
      setRestrictedTools: tools => editor.setRestrictedTools(tools),
      setDeviceNotify: on => setDeviceNotify(deps.notifications, deps.preferences, on),
      setPreferences: patch => deps.preferences.update(patch),
    })
    scope.effect(() => scope.configForms.whileServed([PET_SETTINGS_NAMESPACE], () => scope.slots.inject('settings.section', () =>
      scope.slots.register({
        name: 'settings.section', id: 'pet', order: 30, label: () => t('settings.nav'), locale: NS, inject: injected,
      }, PetSettingsSection))), 'ui-pet: settings page')
  })
}

/**
 * Install pet copy, the snapshot stream, the surface registration, and the settings page.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  const bridge: DesktopPetBridge | undefined = desktopPetBridge(globalThis)
  const surface = detectPetSurface(window.location.search, bridge)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-pet: dictionaries')
  const preferences = new PetPreferenceStore(storageOf(globalThis))
  ctx.effect(() => preferences.follow(window), 'ui-pet: preferences of other documents')
  const notifications = browserNotifications(globalThis)
  if (surface !== 'window') registerSettings(ctx, { desktop: bridge !== undefined, preferences, notifications })
  if (bridge?.role === 'main') {
    // Desktop main window: the pet window and `dsh://session/<id>` links ask it to show a Session.
    ctx.effect(() => bridge.onOpenSession((sessionId) => { openSessionIn(ctx, SessionId(sessionId)) }), 'ui-pet: open Session requests')
  }
  if (surface === 'none') return
  ctx.inject([...SURFACE_INJECT], (scope: ClientContext) => {
    mountSurface(scope, { surface, bridge, preferences, notifications })
  })
}

/**
 * Mount the character once the pet and Session Remotes are served: the snapshot
 * stream, the character pack, notifications, and the overlay or pet-window root.
 * @param ctx - scope that injects {@link SURFACE_INJECT}; every Remote read goes through it.
 * @param deps - detected surface, Desktop bridge, preferences, and notification sink.
 */
function mountSurface(ctx: ClientContext, deps: {
  readonly surface: Exclude<PetSurface, 'none'>
  readonly bridge: DesktopPetBridge | undefined
  readonly preferences: PetPreferenceStore
  readonly notifications: NotificationSink | undefined
}): void {
  const { surface, bridge, preferences, notifications } = deps
  const pet = new PetStore(ctx.remote, signal => ctx.remote.pet.watch(signal))
  ctx.effect(() => {
    void pet.run()
    return () => pet.dispose()
  }, 'ui-pet: snapshot stream')
  const pack = createSnapshotStore<PetFrameSet>(BUILTIN_FRAME_SET, { flush: 'sync' })
  ctx.effect(() => {
    let live = true
    void ctx.remote.pet.pack().then((result) => {
      const offered = result.ok ? offeredFrameSet(result.value) : undefined
      if (live && offered !== undefined) pack.set(offered)
    }, () => {})
    return () => { live = false }
  }, 'ui-pet: character pack')
  const now = (): number => Date.now()
  const controller = new PetController({
    view: pet.store,
    sessionStatus: ctx.uiSession.sessionStatus,
    quickAsk: quickAskDeps(ctx),
    setVisible: async (visible) => { await ctx.remote.pet.setVisible(visible) },
    acknowledge: async (sessionId: SessionId) => { await ctx.remote.pet.acknowledge(sessionId) },
    bridge,
    openSession: (sessionId) => { openSessionIn(ctx, sessionId) },
    preferences,
    notifications,
    now,
  })
  if (notifications !== undefined) {
    const t = ctx.locale.bind(NS)
    ctx.effect(() => watchNotices({
      view: pet.store,
      preferences: preferences.snapshot,
      sink: notifications,
      focused: () => !document.hidden && document.hasFocus(),
      now,
      text: notice => ({
        title: t(`notify.${notice.kind}`, { toolName: notice.toolName ?? '' }),
        body: notice.title ?? t('notify.untitled'),
      }),
      open: (notice) => {
        controller.openMain(notice.sessionId)
        window.focus()
      },
    }), 'ui-pet: system notifications')
  }
  const injected = (): PetInjected => ({
    controller,
    hooks: {
      view: pet.store, approvals: controller.approvals, questions: controller.questions, preferences: preferences.snapshot, pack,
    },
  })
  if (surface === 'window') {
    ctx.effect(makeTransparent, 'ui-pet: transparent pet window')
    if (bridge !== undefined) {
      ctx.effect(() => pet.store.subscribe(() => {
        bridge.setVisible(isPetVisible(pet.store.getSnapshot()))
      }), 'ui-pet: Desktop window visibility')
      ctx.effect(() => bridge.onVisibleRequest((visible) => {
        // A failed write keeps the old Host value; the window and the tray label keep following it.
        void (visible ? controller.show() : controller.hide()).catch(() => {})
      }), 'ui-pet: Desktop tray visibility requests')
    }
    const onQuickAsk = (listener: () => void): (() => void) => bridge?.onQuickAsk(listener) ?? (() => {})
    const onMovement = (listener: (value: { moving: boolean; direction: 'left' | 'right' }) => void): (() => void) => bridge?.onMovement?.(listener) ?? (() => {})
    // Lower priority than ui-layout's AppFrame (0): this document renders only the pet.
    ctx.slots.inject('root', () => ctx.slots.register({
      name: 'root', priority: -1, children: { 'pet.panel.metrics': { kind: 'list', scope: 'root' } }, locale: NS, inject: () => ({ ...injected(), onQuickAsk, onMovement }),
    }, PetWindowRoot))
    return
  }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'pet.character', children: { 'pet.panel.metrics': { kind: 'list', scope: 'root' } }, locale: NS, inject: injected,
  }, PetOverlay))
}
