/** What the browser half registers, and that it all leaves with the fiber. */

import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { MarketplaceStore } from '../src/client/store.ts'
import type { BundleInfo, CatalogEntry, CatalogInstallResult } from '@deepseek-ai/dsh-api-remotes/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

async function bench() {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const offChanged = vi.fn()
  class RemoteService extends Service {
    $on = vi.fn((_event: string, _listener: () => void) => offChanged)
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  const remote = new RemoteService(ctx)
  const pluginCatalog = {
    search: vi.fn(async () => ({ ok: true, value: { entries: [] as CatalogEntry[], total: 0, page: 1, pageSize: 24 } })),
    get: vi.fn(),
    installEntry: vi.fn(),
    uninstall: vi.fn(),
    setEnabled: vi.fn(),
  }
  ctx.provide('remote.pluginCatalog', pluginCatalog)
  const pluginManager = {
    listBundles: vi.fn(async () => ({ ok: true, value: [] as BundleInfo[] })),
    setBundleEnabled: vi.fn(),
  }
  ctx.provide('remote.pluginManager', pluginManager)
  return { ctx, pluginCatalog, pluginManager, remote, offChanged, slots: ctx.get('slots') as SlotRegistry }
}

function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' }, 'shell.overlay': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-plugin-marketplace apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.pluginCatalog', 'remote.pluginManager'])
  })

  it('registers one Plugin marketplace section', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)

    await ctx.plugin({ inject: [...inject], apply }).await()

    const section = slots.entries('settings.section')[0]!
    expect(section.options).toMatchObject({ id: 'marketplace', order: 16 })
    expect(resolveSlotLabel(section.options.label)).toBe('插件市场')
  })

  it('refreshes inventory when the shared manager publishes a change', async () => {
    const refresh = vi.spyOn(MarketplaceStore.prototype, 'refresh')
    onTestFinished(() => { refresh.mockRestore() })
    const { ctx, slots, remote } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const listener = remote.$on.mock.calls.find(([event]) => event === 'plugin-manager/changed')?.[1]
    expect(listener).toBeTypeOf('function')
    listener?.()
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('collapses the section on teardown', async () => {
    const { ctx, slots, offChanged } = await bench()
    declareRoot(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('settings.section')).toHaveLength(1)

    await fiber.dispose()

    expect(slots.entries('settings.section')).toHaveLength(0)
    expect(offChanged).toHaveBeenCalledTimes(2)
  })
})

describe('marketplace operations', () => {
  it('keeps progress active until settlement and refuses a concurrent operation', async () => {
    const { ctx, pluginCatalog } = await bench()
    const controller = new MarketplaceStore(ctx)
    const pending = Promise.withResolvers<{ ok: true; value: CatalogInstallResult }>()
    pluginCatalog.installEntry.mockReturnValueOnce(pending.promise)
    const installing = controller.install('codex:demo')
    expect(controller.store.getSnapshot()).toMatchObject({ operations: { 'codex:demo': { mode: 'install', percent: 0 } } })
    await controller.uninstall('codex:demo')
    expect(pluginCatalog.uninstall).not.toHaveBeenCalled()
    pending.resolve({ ok: true, value: { ok: true, code: 'installed', message: 'Installed.' } })
    await installing
    expect(controller.store.getSnapshot()).toMatchObject({ operations: {}, detail: null, notice: { textKey: 'noticeInstalled' } })
  })

  it('settles activation failures without reporting success', async () => {
    const { ctx, pluginCatalog } = await bench()
    const controller = new MarketplaceStore(ctx)
    pluginCatalog.setEnabled.mockResolvedValueOnce({ ok: false, error: { message: 'Unavailable' } })
    await controller.setEnabled('codex:demo', false)
    expect(pluginCatalog.setEnabled).toHaveBeenCalledWith('codex:demo', false)
    expect(controller.store.getSnapshot()).toMatchObject({ operations: {}, notice: { kind: 'error', textKey: 'noticeFailed' } })
  })
})

describe('shared community activation', () => {
  const entry = {
    id: 'community:alice/demo', source: 'community' as const, kind: 'bundle' as const,
    kinds: ['bundle' as const], compatibility: 'full' as const, name: '@alice/demo',
    title: 'Demo', description: '', author: 'alice', installed: true, enabled: false,
  }

  it('uses the existing bundle endpoint rather than the catalog activation route', async () => {
    const { ctx, pluginCatalog, pluginManager } = await bench()
    const controller = new MarketplaceStore(ctx)
    controller.store.set({ ...controller.store.getSnapshot(), detail: entry })
    pluginManager.setBundleEnabled.mockResolvedValueOnce({ ok: true, value: { application: 'applied' } })
    await controller.setEnabled(entry.id, true)
    expect(pluginManager.setBundleEnabled).toHaveBeenCalledWith('@alice/demo', true)
    expect(pluginCatalog.setEnabled).not.toHaveBeenCalled()
    expect(controller.store.getSnapshot().notice?.textKey).toBe('noticeEnabled')
  })

  it('reads current bundle enablement even when the catalog still reports disabled', async () => {
    const { ctx, pluginCatalog, pluginManager } = await bench()
    const controller = new MarketplaceStore(ctx)
    pluginCatalog.search.mockResolvedValue({ ok: true, value: {
      entries: [entry], total: 1, page: 1, pageSize: 24,
    } })
    pluginManager.listBundles.mockResolvedValue({ ok: true, value: [{ name: '@alice/demo', installed: true, enabled: true, official: false, availability: 'profile', optional: false, removable: true, rows: [], overrides: [] }] })
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().status).toBe('ready') })
    expect(controller.store.getSnapshot().result?.entries[0]?.enabled).toBe(true)
    pluginManager.listBundles.mockResolvedValue({ ok: true, value: [{ name: '@alice/demo', installed: true, enabled: false, official: false, availability: 'profile', optional: false, removable: true, rows: [], overrides: [] }] })
    controller.refresh()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().result?.entries[0]?.enabled).toBe(false) })
  })
})

it('tracks different plugin installations independently and prevents duplicate installs of the same plugin', async () => {
  const { ctx, pluginCatalog } = await bench()
  const controller = new MarketplaceStore(ctx)
  const first = Promise.withResolvers<{ ok: true; value: CatalogInstallResult }>()
  const second = Promise.withResolvers<{ ok: true; value: CatalogInstallResult }>()
  pluginCatalog.installEntry.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const a = controller.install('codex:first'), b = controller.install('codex:second')
  await controller.install('codex:first')
  expect(pluginCatalog.installEntry).toHaveBeenCalledTimes(2)
  controller.progress('codex:first', 25); controller.progress('codex:second', 90)
  expect(controller.store.getSnapshot().operations).toMatchObject({
    'codex:first': { percent: 25 }, 'codex:second': { percent: 90 },
  })
  first.resolve({ ok: true, value: { ok: true, code: 'installed', message: 'Installed' } })
  await a
  expect(controller.store.getSnapshot().operations?.['codex:first']).toBeUndefined()
  expect(controller.store.getSnapshot().operations?.['codex:second']?.percent).toBe(90)
  second.resolve({ ok: true, value: { ok: false, code: 'failed', message: 'Failed' } })
  await b
  expect(controller.store.getSnapshot().operations).toEqual({})
})
