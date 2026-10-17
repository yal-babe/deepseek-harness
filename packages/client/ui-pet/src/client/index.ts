/**
 * Studio Pet browser plugin. On Web it adds the character to `shell.overlay`;
 * inside the Desktop pet window (`?dsh-pet-window=1`) it shadows `root` so the
 * whole document is the pet. Both surfaces read the Host `pet` Remote and
 * answer approvals through ui-approval's pending interactions. Every document
 * except the pet window also registers the pet settings page while ui-settings
 * and the Host `pet` entry are present.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-approval/client'
import type {} from '@deepseek-ai/dsh-client-file-upload/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { PetController } from './controller.ts'
import { browserNotifications, setDeviceNotify, watchNotices, type NotificationSink } from './notifier.ts'
import { PetSettingsSection, type PetSettingsInjected } from './PetSettingsSection.tsx'
import { PET_SETTINGS_NAMESPACE, PetSettingsEditor, type PetSettingsFields } from './settings.ts'
import { PetPreferenceStore, type PreferenceStorage } from './preferences.ts'
import { en, zh, type PetLocaleKey } from './locales.ts'
import { PetOverlay, PetWindowRoot, type PetInjected } from './Pet.tsx'
import type { QuickAskDeps } from './quick-ask.ts'
import { isPetVisible, PetStore } from './store.ts'
import { desktopPetBridge, detectPetSurface, type DesktopPetBridge } from './surface.ts'

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
  if (surface === 'none') return
  const pet = new PetStore(ctx.remote, signal => ctx.remote.pet.watch(signal))
  ctx.effect(() => {
    void pet.run()
    return () => pet.dispose()
  }, 'ui-pet: snapshot stream')
  const now = (): number => Date.now()
  const controller = new PetController({
    view: pet.store,
    sessionStatus: ctx.uiSession.sessionStatus,
    quickAsk: quickAskDeps(ctx),
    setVisible: async (visible) => { await ctx.remote.pet.setVisible(visible) },
    acknowledge: async (sessionId: SessionId) => { await ctx.remote.pet.acknowledge(sessionId) },
    bridge,
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
      open: () => {
        controller.openMain()
        window.focus()
      },
    }), 'ui-pet: system notifications')
  }
  const injected = (): PetInjected => ({
    controller,
    hooks: {
      view: pet.store, approvals: controller.approvals, questions: controller.questions, preferences: preferences.snapshot,
    },
  })
  if (surface === 'window') {
    ctx.effect(makeTransparent, 'ui-pet: transparent pet window')
    if (bridge !== undefined) {
      ctx.effect(() => pet.store.subscribe(() => {
        bridge.setVisible(isPetVisible(pet.store.getSnapshot()))
      }), 'ui-pet: Desktop window visibility')
    }
    const onQuickAsk = (listener: () => void): (() => void) => bridge?.onQuickAsk(listener) ?? (() => {})
    // Lower priority than ui-layout's AppFrame (0): this document renders only the pet.
    ctx.slots.inject('root', () => ctx.slots.register({
      name: 'root', priority: -1, locale: NS, inject: () => ({ ...injected(), onQuickAsk }),
    }, PetWindowRoot))
    return
  }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'pet.character', locale: NS, inject: injected,
  }, PetOverlay))
}
