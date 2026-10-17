/**
 * Personal Center, browser half: sidebar entry under Plugins and the main
 * panel of local usage plus Codex/Antigravity quota.
 */

import type {} from '@deepseek-ai/dsh-client-product-analytics/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-pet/client'
import { PetUsageSummary } from './PetUsageSummary.tsx'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-token-meter/src/projection.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/src/projection.ts'
import { PersonalCenterPage, type PersonalCenterInjected } from './PersonalCenterPage.tsx'
import { PersonalCenterIcon } from './PersonalCenterIcon.tsx'
import { PersonalCenterStore } from './store.ts'
import { en, zh, type PersonalCenterKey } from './locales.ts'

export type { PersonalCenterKey } from './locales.ts'
export type { PersonalCenterInjected, PersonalCenterPageProps } from './PersonalCenterPage.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Personal Center copy. */
    'personalCenter': PersonalCenterKey
  }
}

/** Dictionary namespace. */
export const NS = 'personalCenter'

/** Sidebar entry and main panel id. */
export const PANEL_ID = 'personal-center' as MainPanelId

/** Required services. */
export const inject = ['slots', 'locale', 'remote', 'remote.usageStats', 'remote.providerQuota', 'remote.account', 'layout', 'sessions']

/**
 * Contribute the Personal Center sidebar entry and main panel.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-personal-center: dictionaries')
  const t = ctx.locale.bind(NS)
  const controller = new PersonalCenterStore(ctx)
  ctx.effect(() => () => { controller.dispose() }, 'ui-personal-center: store')
  ctx.effect(() => {
    // A page never rendered holds no snapshot to refresh.
    const refresh = (): void => {
      if (controller.store.getSnapshot().status !== 'idle') void controller.load()
    }
    const off = ctx.on('connection/reset', refresh)
    return () => { off() }
  }, 'ui-personal-center: reconnect')
  ctx.effect(() => {
    const unsubscribers: Array<() => void> = []
    const watch = (): void => {
      for (const stop of unsubscribers.splice(0)) stop()
      const list = ctx.sessions.list.getSnapshot()
      for (const id of list.ids) {
        const session = ctx.sessions.binding(id)?.session
        if (session === undefined) continue
        const face = session.projections.faceOf('tokenUsage')
        unsubscribers.push(face.subscribe(() => {
          const value = face.getSnapshot() as TokenUsageProjection | undefined | null
          if (value === undefined || value === null) return
          controller.mergeSession(id, {
            uncachedInputTokens: value.uncachedInputTokens,
            cacheReadTokens: value.cacheReadTokens,
            cacheWriteTokens: value.cacheWriteTokens,
            outputTokens: value.outputTokens,
          })
        }))
      }
    }
    watch()
    const stopList = ctx.sessions.list.subscribe(watch)
    return () => { stopList(); for (const stop of unsubscribers) stop() }
  }, 'ui-personal-center: live tokenUsage')

  const injected = (): PersonalCenterInjected => ({
    controller,
    hooks: { snapshot: controller.store },
    openSession: (sessionId: SessionId) => {
      ctx.layout.selectPanel(null)
      ctx.get('uiWorkspace')?.openSession(sessionId)
    },
  })

  ctx.slots.inject('pet.panel.metrics', () => ctx.slots.register({
    name: 'pet.panel.metrics', id: 'personal-center', locale: NS, inject: injected,
  }, PetUsageSummary))

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: injected,
  }, PersonalCenterPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 5,
    label: () => t('panel'),
    locale: NS,
  }, PersonalCenterIcon))
}
