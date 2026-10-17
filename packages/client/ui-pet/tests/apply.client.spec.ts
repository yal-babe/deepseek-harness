// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { PetSnapshot } from '@deepseek-ai/dsh-pet/types'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'
import type { PetInjected } from '../src/client/Pet.tsx'
import type { DesktopPetBridge } from '../src/client/surface.ts'
import { S1, snapshot } from './fixtures.ts'

interface Registration {
  readonly options: { name: string; priority?: number; inject: () => PetInjected & { onQuickAsk?: (listener: () => void) => () => void } }
  readonly component: unknown
}

async function bench(search: string, bridge?: DesktopPetBridge) {
  window.history.replaceState(null, '', `/${search}`)
  if (bridge === undefined) Reflect.deleteProperty(globalThis, 'dshDesktopPet')
  else Reflect.set(globalThis, 'dshDesktopPet', bridge)
  const ctx = new Context()
  const registrations: Registration[] = []
  const frames: PetSnapshot[] = [snapshot({ primary: 'WORKING', visible: false })]
  const remote = {
    $stream: vi.fn((options: { open: (signal: AbortSignal) => AsyncIterable<PetSnapshot> }) => {
      void options.open(new AbortController().signal)
      const iterator = (async function* () {
        for (const value of frames) yield { value, accept: () => {} }
      })()
      return Object.assign(iterator, { dispose: vi.fn(async () => {}) })
    }),
    pet: {
      watch: vi.fn(() => (async function* () {})()),
      setVisible: vi.fn(async () => ({ ok: true, value: undefined })),
      acknowledge: vi.fn(async () => ({ ok: true, value: undefined })),
    },
    session: {
      create: vi.fn(async () => ({ ok: true, value: { sessionId: S1 } })),
      prompt: vi.fn(async () => ({ ok: true, value: { accepted: true } })),
    },
  }
  const fileUpload = {
    upload: vi.fn(async () => ({ ok: true, value: { receiptId: 'rcpt', file: {} } })),
  }
  const locale = { register: vi.fn(() => () => {}) }
  ctx.provide('remote', remote as never)
  ctx.provide('uiSession', { sessionStatus: createSnapshotStore(new Map(), { flush: 'sync' }) } as never)
  ctx.provide('fileUpload', fileUpload as never)
  ctx.provide('locale', locale as never)
  ctx.provide('slots', {
    inject: (_name: string, mount: () => () => void) => { const dispose = ctx.effect(() => mount()); return () => { void dispose() } },
    register: (options: Registration['options'], component: unknown) => { registrations.push({ options, component }); return () => {} },
  } as never)
  const fiber = ctx.plugin({ inject, apply })
  await fiber.await()
  await vi.waitFor(() => { expect(remote.$stream).toHaveBeenCalled() }, { timeout: 100 }).catch(() => {})
  return { ctx, fiber, registrations, remote, fileUpload, locale }
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'dshDesktopPet')
  document.documentElement.style.removeProperty('background')
})

describe('ui-pet apply', () => {
  it('has a no-op Node half', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('adds the in-page character on Web and binds Remote actions', async () => {
    const { registrations, remote, fileUpload, fiber } = await bench('')
    expect(registrations.map(entry => entry.options.name)).toEqual(['shell.overlay'])
    const injected = registrations[0]!.options.inject()
    await vi.waitFor(() => { expect(injected.hooks.view.getSnapshot().snapshot?.primary).toBe('WORKING') })
    await injected.controller.hide()
    expect(remote.pet.setVisible).toHaveBeenCalledWith(false)
    await injected.controller.acknowledge(S1)
    expect(remote.pet.acknowledge).toHaveBeenCalledWith(S1)
    const file = new File(['x'], 'x.txt')
    expect(await injected.controller.ask('go', [file], 'new', new AbortController().signal)).toEqual({ ok: true, sessionId: S1 })
    expect(remote.session.create).toHaveBeenCalledWith({})
    expect(fileUpload.upload).toHaveBeenCalledWith(S1, file, 'x.txt', expect.any(AbortSignal))
    expect(remote.session.prompt).toHaveBeenCalledWith(expect.objectContaining({ content: [{ type: 'text', text: 'go' }, { type: 'file', receiptId: 'rcpt' }] }), expect.any(AbortSignal))
    fileUpload.upload.mockResolvedValueOnce({ ok: false, error: new Error('quota') } as never)
    expect(await injected.controller.ask('go', [file], 'new', new AbortController().signal)).toMatchObject({ ok: false, stage: 'upload' })
    await fiber.dispose()
  })

  it('creates a Session in the focused directory', async () => {
    const { registrations, remote } = await bench('')
    const injected = registrations[0]!.options.inject()
    await vi.waitFor(() => { expect(injected.hooks.view.getSnapshot().snapshot).toBeDefined() })
    vi.spyOn(injected.controller, 'target').mockReturnValue({ kind: 'new', cwd: '/repo' })
    await injected.controller.ask('go', [], 'new', new AbortController().signal)
    expect(remote.session.create).toHaveBeenCalledWith({ cwd: '/repo' })
  })

  it('renders only the pet in the Desktop pet window and follows Host visibility', async () => {
    const bridge: DesktopPetBridge = {
      protocolVersion: 1, role: 'pet', setInteractive: vi.fn(), setVisible: vi.fn(), openMain: vi.fn(), onQuickAsk: vi.fn(() => () => {}),
    }
    const { registrations, fiber } = await bench('?dsh-pet-window=1', bridge)
    expect(registrations.map(entry => [entry.options.name, entry.options.priority])).toEqual([['root', -1]])
    expect(document.documentElement.style.getPropertyValue('background')).toBe('transparent')
    await vi.waitFor(() => { expect(bridge.setVisible).toHaveBeenCalledWith(false) })
    const injected = registrations[0]!.options.inject()
    injected.onQuickAsk?.(() => {})
    expect(bridge.onQuickAsk).toHaveBeenCalled()
    await fiber.dispose()
    expect(document.documentElement.style.getPropertyValue('background')).toBe('')
  })

  it('previews the pet window on Web without a Desktop bridge', async () => {
    const { registrations } = await bench('?dsh-pet-window=1')
    const injected = registrations[0]!.options.inject()
    const unsubscribe = injected.onQuickAsk?.(() => {})
    expect(unsubscribe).toBeTypeOf('function')
    unsubscribe?.()
  })

  it('stays out of the Desktop main window', async () => {
    const bridge: DesktopPetBridge = {
      protocolVersion: 1, role: 'main', setInteractive: vi.fn(), setVisible: vi.fn(), openMain: vi.fn(), onQuickAsk: vi.fn(() => () => {}),
    }
    const { registrations, locale } = await bench('', bridge)
    expect(registrations).toEqual([])
    expect(locale.register).not.toHaveBeenCalled()
  })
})
