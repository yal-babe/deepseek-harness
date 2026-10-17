import type { IpcMainEvent } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DesktopPetWindow, PET_IPC, PET_QUICK_ASK_ACCELERATOR, PET_SESSION_ID_MAX_LENGTH, petSessionId, petWindowUrl, sessionDeepLink,
} from '../src/pet-window.ts'

const native = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  const windows: FakeWindow[] = []
  const state = { failLoad: false }
  let nextId = 1
  class FakeWindow extends EventEmitter {
    destroyed = false
    visible = false
    readonly webContents = {
      id: nextId++,
      mainFrame: { url: 'dsh-app://app/?dsh-pet-window=1' },
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    }
    readonly setAlwaysOnTop = vi.fn()
    readonly setVisibleOnAllWorkspaces = vi.fn()
    readonly setIgnoreMouseEvents = vi.fn()
    readonly loadURL = vi.fn(async () => { if (state.failLoad) throw new Error('offline') })
    readonly showInactive = vi.fn(() => { this.visible = true })
    readonly show = vi.fn(() => { this.visible = true })
    readonly hide = vi.fn(() => { this.visible = false })
    readonly focus = vi.fn()
    readonly destroy = vi.fn(() => { this.destroyed = true; this.emit('closed') })
    constructor(readonly options: Record<string, unknown>) { super(); windows.push(this) }
    isDestroyed(): boolean { return this.destroyed }
    isVisible(): boolean { return this.visible }
  }
  return {
    windows,
    state,
    FakeWindow,
    register: vi.fn((_accelerator: string, _callback: () => void) => true),
    unregister: vi.fn(),
  }
})
vi.mock('electron', () => ({
  BrowserWindow: native.FakeWindow,
  globalShortcut: { register: native.register, unregister: native.unregister },
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
}))

afterEach(() => {
  native.windows.length = 0
  vi.clearAllMocks()
  native.register.mockImplementation(() => true)
})

function setup() {
  const openMain = vi.fn()
  const pet = new DesktopPetWindow({ preload: '/app/preload-app.cjs', applicationUrl: 'dsh-app://app/', openMain })
  return { pet, openMain }
}

function ipcBench(pet: DesktopPetWindow) {
  const handlers = new Map<string, (event: IpcMainEvent, value: unknown) => void>()
  const ipc = {
    on: vi.fn((channel: string, listener: (event: IpcMainEvent, value: unknown) => void) => {
      handlers.set(channel, listener)
      return ipc
    }),
    removeListener: vi.fn((channel: string) => { handlers.delete(channel); return ipc }),
  }
  const remove = pet.installIpc(ipc as never)
  const send = (channel: string, value: unknown, sender: { id: number; mainFrame: unknown }, frame?: unknown): void => {
    handlers.get(channel)?.({ sender, senderFrame: frame ?? sender.mainFrame } as never, value)
  }
  return { remove, send, handlers }
}

describe('petWindowUrl', () => {
  it('marks the application document', () => {
    expect(petWindowUrl('dsh-app://app/')).toBe('dsh-app://app/?dsh-pet-window=1')
  })
})

describe('Session ids from the pet and deep links', () => {
  it('accepts only bounded printable ids', () => {
    expect(petSessionId('2026-10-17_abc:1.x')).toBe('2026-10-17_abc:1.x')
    expect(petSessionId('')).toBeUndefined()
    expect(petSessionId('a/b')).toBeUndefined()
    expect(petSessionId(42)).toBeUndefined()
    expect(petSessionId('a'.repeat(PET_SESSION_ID_MAX_LENGTH + 1))).toBeUndefined()
  })

  it('reads dsh://session/<id> and nothing else', () => {
    expect(sessionDeepLink('dsh://session/abc-1')).toBe('abc-1')
    expect(sessionDeepLink('dsh://session/abc-1/')).toBe('abc-1')
    expect(sessionDeepLink('dsh://session/')).toBeUndefined()
    expect(sessionDeepLink('dsh://session/a/b')).toBeUndefined()
    expect(sessionDeepLink('dsh://open')).toBeUndefined()
    expect(sessionDeepLink('https://session/abc')).toBeUndefined()
    expect(sessionDeepLink('not a url')).toBeUndefined()
    expect(sessionDeepLink('dsh://session/%E0%A4%A')).toBeUndefined()
  })
})

describe('DesktopPetWindow', () => {
  it('opens one transparent, always-on-top, click-through window on the application document', () => {
    const { pet } = setup()
    const window = pet.open()
    expect(pet.open()).toBe(window)
    const fake = native.windows[0]!
    expect(fake.options).toMatchObject({
      frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, show: false, x: 1564, y: 504,
    })
    expect(fake.options.webPreferences).toMatchObject({ preload: '/app/preload-app.cjs', contextIsolation: true, sandbox: true, nodeIntegration: false })
    expect(fake.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true })
    expect(fake.loadURL).toHaveBeenCalledWith('dsh-app://app/?dsh-pet-window=1')
    fake.emit('ready-to-show')
    expect(fake.showInactive).toHaveBeenCalled()
    expect(pet.owns(fake.webContents.id)).toBe(true)
    expect(pet.owns(fake.webContents.id + 100)).toBe(false)
    expect(pet.owns(undefined)).toBe(false)
  })

  it('logs a failed load, denies popups, and recreates the window after it closes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    native.state.failLoad = true
    const { pet } = setup()
    pet.open()
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith('desktop pet: window failed to load', expect.any(Error)) })
    native.state.failLoad = false
    const first = native.windows[0]!
    const popup = first.webContents.setWindowOpenHandler.mock.calls[0]![0] as () => unknown
    expect(popup()).toEqual({ action: 'deny' })
    first.destroy()
    first.emit('ready-to-show')
    expect(first.showInactive).not.toHaveBeenCalled()
    expect(pet.owns(first.webContents.id)).toBe(false)
    pet.open()
    expect(native.windows).toHaveLength(2)
    native.windows[1]!.emit('closed')
    pet.dispose()
    warn.mockRestore()
  })

  it('toggles click-through and follows Host visibility', () => {
    const { pet } = setup()
    pet.setInteractive(true)
    pet.setVisible(true)
    pet.open()
    const fake = native.windows[0]!
    pet.setInteractive(true)
    expect(fake.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false)
    pet.setInteractive(false)
    expect(fake.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
    pet.setVisible(false)
    expect(fake.hide).toHaveBeenCalled()
    pet.setVisible(true)
    expect(fake.showInactive).toHaveBeenCalledOnce()
    pet.setVisible(true)
    expect(fake.showInactive).toHaveBeenCalledOnce()
  })

  it('registers the global quick-ask shortcut once and focuses the pet when it fires', () => {
    const { pet } = setup()
    pet.start()
    pet.start()
    expect(native.windows).toHaveLength(1)
    expect(native.register).toHaveBeenCalledOnce()
    expect(native.register).toHaveBeenCalledWith(PET_QUICK_ASK_ACCELERATOR, expect.any(Function))
    const fire = native.register.mock.calls[0]![1]
    fire()
    const fake = native.windows[0]!
    expect(fake.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false)
    expect(fake.show).toHaveBeenCalled()
    expect(fake.focus).toHaveBeenCalled()
    expect(fake.webContents.send).toHaveBeenCalledWith(PET_IPC.quickAsk)
    expect(pet.registerShortcut('Alt+P')).toBe(true)
    expect(native.unregister).toHaveBeenCalledWith(PET_QUICK_ASK_ACCELERATOR)
    pet.dispose()
    expect(native.unregister).toHaveBeenCalledWith('Alt+P')
    expect(fake.destroy).toHaveBeenCalled()
    fire()
    pet.start()
    expect(native.windows).toHaveLength(1)
  })

  it('reports an unavailable or invalid accelerator', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { pet } = setup()
    native.register.mockReturnValueOnce(false)
    expect(pet.registerShortcut()).toBe(false)
    native.register.mockImplementationOnce(() => { throw new Error('bad accelerator') })
    expect(pet.registerShortcut('Nope+')).toBe(false)
    pet.dispose()
    expect(native.unregister).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(3)
    warn.mockRestore()
  })

  it('accepts renderer messages only from the pet window top frame', () => {
    const { pet, openMain } = setup()
    pet.open()
    const fake = native.windows[0]!
    const { send, remove, handlers } = ipcBench(pet)
    send(PET_IPC.setInteractive, true, fake.webContents)
    expect(fake.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false)
    send(PET_IPC.setInteractive, 'yes', fake.webContents)
    expect(fake.setIgnoreMouseEvents).toHaveBeenCalledTimes(2)
    send(PET_IPC.setVisible, false, fake.webContents)
    expect(fake.hide).toHaveBeenCalled()
    send(PET_IPC.setVisible, 1, fake.webContents)
    send(PET_IPC.openMain, undefined, fake.webContents)
    expect(openMain).toHaveBeenCalledWith(undefined)
    send(PET_IPC.openMain, undefined, { id: 999, mainFrame: {} })
    send(PET_IPC.openMain, undefined, fake.webContents, { url: 'child-frame' })
    expect(openMain).toHaveBeenCalledOnce()
    send(PET_IPC.openMain, 'sess-1', fake.webContents)
    expect(openMain).toHaveBeenLastCalledWith('sess-1')
    send(PET_IPC.openMain, '../etc', fake.webContents)
    expect(openMain).toHaveBeenLastCalledWith(undefined)
    remove()
    expect(handlers.size).toBe(0)
  })
})
