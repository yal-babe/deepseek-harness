// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { PetSnapshot } from '@deepseek-ai/dsh-pet/types'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'
import type { PetInjected } from '../src/client/Pet.tsx'
import type { PetSettingsInjected } from '../src/client/PetSettingsSection.tsx'
import type { DesktopPetBridge } from '../src/client/surface.ts'
import { hostPending, S1, sessionView, snapshot } from './fixtures.ts'

interface Registration {
  readonly options: {
    name: string
    id?: string
    priority?: number
    label?: () => string
    inject: () => PetInjected & { onQuickAsk?: (listener: () => void) => () => void }
  }
  readonly component: unknown
}

/** ui-settings' configForms face with one served namespace and a recording `set`. */
function fakeConfigForms(served: boolean) {
  const set = vi.fn(async (_field: string, _value: unknown) => true)
  const initial = { status: 'ready', value: undefined, base: undefined, user: undefined, revision: 1, writable: true }
  const form = { ...createSnapshotStore(initial), set }
  return {
    set,
    get: vi.fn(() => form),
    whileServed: vi.fn((namespaces: readonly string[], register: () => () => void) => served && namespaces.includes('pet') ? register() : () => {}),
  }
}

async function bench(
  search: string, bridge?: DesktopPetBridge, extraFrames?: PetSnapshot[], configForms?: ReturnType<typeof fakeConfigForms>,
  uiWorkspace?: { openSession: (sessionId: string) => void },
) {
  window.history.replaceState(null, '', `/${search}`)
  if (bridge === undefined) Reflect.deleteProperty(globalThis, 'dshDesktopPet')
  else Reflect.set(globalThis, 'dshDesktopPet', bridge)
  const ctx = new Context()
  const registrations: Registration[] = []
  const frames: PetSnapshot[] = extraFrames ?? [snapshot({ primary: 'WORKING', visible: false })]
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
  const locale = { register: vi.fn(() => () => {}), bind: vi.fn(() => (key: string, params?: Record<string, string>) => `${key}${params?.toolName ?? ''}`) }
  ctx.provide('remote', remote as never)
  ctx.provide('uiSession', { sessionStatus: createSnapshotStore(new Map(), { flush: 'sync' }) } as never)
  ctx.provide('fileUpload', fileUpload as never)
  ctx.provide('locale', locale as never)
  ctx.provide('slots', {
    inject: (_name: string, mount: () => () => void) => { const dispose = ctx.effect(() => mount()); return () => { void dispose() } },
    register: (options: Registration['options'], component: unknown) => { registrations.push({ options, component }); return () => {} },
  } as never)
  if (configForms !== undefined) ctx.provide('configForms', configForms as never)
  if (uiWorkspace !== undefined) ctx.provide('uiWorkspace', uiWorkspace as never)
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
      onOpenSession: vi.fn(() => () => {}),
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
      onOpenSession: vi.fn(() => () => {}),
    }
    const { registrations, remote } = await bench('', bridge)
    expect(registrations).toEqual([])
    expect(remote.$stream).not.toHaveBeenCalled()
  })

  it('shows Sessions the main process forwards to the Desktop main window', async () => {
    let forward: ((sessionId: string) => void) | undefined
    const main: DesktopPetBridge = {
      protocolVersion: 1, role: 'main', setInteractive: vi.fn(), setVisible: vi.fn(), openMain: vi.fn(), onQuickAsk: vi.fn(() => () => {}),
      onOpenSession: vi.fn((listener: (sessionId: string) => void) => { forward = listener; return () => {} }),
    }
    const uiWorkspace = { openSession: vi.fn() }
    await bench('', main, undefined, undefined, uiWorkspace)
    forward?.('s9')
    expect(uiWorkspace.openSession).toHaveBeenCalledWith('s9')
    await bench('', main)
    expect(() => { forward?.('s9') }).not.toThrow()
  })

  it('opens the notified Session in the page when a Web notification is clicked', async () => {
    class FakeNotification {
      static permission = 'granted' as const
      static requestPermission = async () => 'granted' as const
      static last: FakeNotification | undefined
      onclick: ((event: Event) => unknown) | null = null
      constructor() { FakeNotification.last = this }
    }
    vi.stubGlobal('Notification', FakeNotification)
    vi.spyOn(window, 'focus').mockImplementation(() => {})
    window.localStorage.setItem('dsh-pet:preferences', '{"notify":true}')
    const uiWorkspace = { openSession: vi.fn() }
    const frames = [snapshot({ sessions: [sessionView(S1, { state: 'WORKING' })] }), snapshot({ sessions: [sessionView(S1, { state: 'ERROR' })] })]
    const { fiber } = await bench('', undefined, frames, undefined, uiWorkspace)
    await vi.waitFor(() => { expect(FakeNotification.last).toBeDefined() })
    FakeNotification.last?.onclick?.(new Event('click'))
    expect(uiWorkspace.openSession).toHaveBeenCalledWith(S1)
    await fiber.dispose()
    window.localStorage.removeItem('dsh-pet:preferences')
    vi.unstubAllGlobals()
  })

  it('registers the settings page on Web and in the Desktop main window while the Host serves the pet entry', async () => {
    const web = fakeConfigForms(true)
    const first = await bench('', undefined, undefined, web)
    expect(first.registrations.map(entry => [entry.options.name, entry.options.id]).sort()).toEqual([['settings.section', 'pet'], ['shell.overlay', 'pet.character']])
    const section = first.registrations.find(entry => entry.options.name === 'settings.section')!
    expect(section.options.label?.()).toBe('settings.nav')
    const page = section.options.inject() as unknown as PetSettingsInjected
    expect(page.desktop).toBe(false)
    expect(await page.setSwitch('restrictTools', true)).toBe(true)
    expect(await page.setRestrictedTools(['bash'])).toBe(true)
    expect(web.set.mock.calls).toEqual([['restrictTools', true], ['restrictedTools', ['bash']]])
    expect(await page.setDeviceNotify(true)).toBe(false)
    await first.fiber.dispose()
    const main: DesktopPetBridge = {
      protocolVersion: 1, role: 'main', setInteractive: vi.fn(), setVisible: vi.fn(), openMain: vi.fn(), onQuickAsk: vi.fn(() => () => {}),
      onOpenSession: vi.fn(() => () => {}),
    }
    const second = await bench('', main, undefined, fakeConfigForms(true))
    expect(second.registrations.map(entry => entry.options.name)).toEqual(['settings.section'])
    expect((second.registrations[0]!.options.inject() as unknown as PetSettingsInjected).desktop).toBe(true)
    const unserved = await bench('', undefined, undefined, fakeConfigForms(false))
    expect(unserved.registrations.map(entry => entry.options.name)).toEqual(['shell.overlay'])
    const window = await bench('?dsh-pet-window=1', undefined, undefined, fakeConfigForms(true))
    expect(window.registrations.map(entry => entry.options.name)).toEqual(['root'])
  })

  it('shows system notifications when the user opted in, and tolerates blocked storage', async () => {
    const shown: { title: string; options: { body: string }; onclick: ((event: Event) => unknown) | null }[] = []
    class FakeNotification {
      static permission = 'granted' as const
      static requestPermission = async () => 'granted' as const
      onclick: ((event: Event) => unknown) | null = null
      constructor(readonly title: string, readonly options: { body: string; tag: string }) { shown.push(this) }
    }
    vi.stubGlobal('Notification', FakeNotification)
    window.localStorage.setItem('dsh-pet:preferences', '{"notify":true}')
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => {})
    const frames = [
      snapshot({ sessions: [sessionView(S1, { state: 'WORKING' })] }),
      snapshot({ pending: [hostPending('r', S1, 'bash')], sessions: [sessionView(S1, { state: 'WAITING' })] }),
      snapshot({ pending: [hostPending('r', S1, 'bash')], sessions: [sessionView(S1, { state: 'SUCCESS', title: 'Fix' })] }),
    ]
    const { fiber } = await bench('', undefined, frames)
    await vi.waitFor(() => { expect(shown.length).toBe(2) })
    expect(shown.map(entry => [entry.title, entry.options.body])).toEqual([['notify.waitingbash', 'notify.untitled'], ['notify.success', 'Fix']])
    shown[0]!.onclick?.(new Event('click'))
    expect(focus).toHaveBeenCalled()
    await fiber.dispose()
    window.localStorage.removeItem('dsh-pet:preferences')
    vi.unstubAllGlobals()
    const blocked = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('blocked') })
    const second = await bench('')
    expect(second.registrations.length).toBe(1)
    await second.fiber.dispose()
    blocked.mockRestore()
  })
})
