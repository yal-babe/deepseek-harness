/**
 * Plugin marketplace settings section, browser half: Hub-style catalog
 * (categories, sort, installed, custom install) plus a Codex source.
 */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import {
  MarketplaceSection,
  MarketplaceNotice,
  type MarketplaceSectionInjected,
} from './MarketplaceSection.tsx'
import { MarketplaceStore } from './store.ts'
import { en, zh, type MarketplaceLocaleKey } from './locales.ts'

export type {
  MarketplaceSectionInjected,
  MarketplaceSectionProps,
} from './MarketplaceSection.tsx'
export type { MarketplaceLocaleKey } from './locales.ts'
export { MarketplaceStore } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Plugin marketplace settings copy. */
    'settings.marketplace': MarketplaceLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.marketplace'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginCatalog', 'remote.pluginManager']

/**
 * Mount the plugin marketplace settings section.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-plugin-marketplace: section dictionaries')

  const controller = new MarketplaceStore(ctx)
  ctx.effect(() => {
    const offChanged = ctx.remote.$on('plugin-manager/changed', () => { controller.refresh() })
    const offReset = ctx.on('connection/reset', () => { controller.refresh() })
    return () => { offChanged(); offReset() }
  }, 'ui-settings-plugin-marketplace: inventory changes')
  const sectionInjected = (): MarketplaceSectionInjected => ({
    controller,
    hooks: { snapshot: controller.store },
  })

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'marketplace.notice', locale: NS, inject: sectionInjected,
  }, MarketplaceNotice))

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'marketplace',
    order: 16,
    label: () => t('nav'),
    locale: NS,
    inject: sectionInjected,
  }, MarketplaceSection))
}
