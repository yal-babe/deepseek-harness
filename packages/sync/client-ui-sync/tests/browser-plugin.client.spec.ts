/**
 * ui-sync plugin halves: dictionary and header-slot registration against the
 * real SlotRegistry, plus the inert node entry.
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject, EMPTY_SYNC_STATUS } from '../src/client/index.ts'
import type { SyncStatusInjected } from '../src/client/SyncStatusChip.tsx'
import { apply as applyNode } from '../src/index.ts'
import { en, zh } from '../src/client/locales.ts'

function headerEntryIds(ctx: Context): (string | undefined)[] {
  return ctx.slots
    .entries('conversation.session.header.utilities')
    .map(entry => entry.options.id)
}

async function bench(): Promise<{ ctx: Context; fiber: ReturnType<Context['plugin']> }> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('configForms', { developerTools: { enabled: createSnapshotStore(true) }, get: () => stubConfigForm().scope } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  ctx.locale.setLocale('zh')
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber }
}

describe('ui-sync browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('registers the chip and tears it down with the fiber', async () => {
    const { ctx, fiber } = await bench()
    expect(headerEntryIds(ctx)).toEqual(['sync-status'])
    const entry = ctx.slots.entries('conversation.session.header.utilities')[0]
    const injectFace = entry?.inject as (() => SyncStatusInjected) | undefined
    if (injectFace === undefined) throw new Error('sync-status entry registered no inject face')
    expect(injectFace().hooks.syncStatus.getSnapshot()).toEqual(EMPTY_SYNC_STATUS)
    await fiber.dispose()
    expect(headerEntryIds(ctx)).toEqual([])
  })

  it('keeps Chinese as the dictionary source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('exposes an inert node apply', () => {
    expect(applyNode()).toBeUndefined()
  })
})
