import type { IpcMainEvent } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DesktopPetWindow, PET_IPC, PET_QUICK_ASK_ACCELERATOR, PET_SESSION_ID_MAX_LENGTH, petSessionId, petWindowUrl, sessionDeepLink,
} from '../src/pet-window.ts'
import type { PetPositionStore } from '../src/pet-position.ts'

const native = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  const windows: FakeWindow[] = []
  const primary = {
    id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1,
  }
  const state = { failLoad: false, cursor: { x: 0, y: 0 }, displays: [primary] }
  const screenEvents = new EventEmitter()
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
    readonly setBounds = vi.fn((bounds: { x: number; y: number }) => { this.x = bounds.x; this.y = bounds.y })
    x: number
    y: number
    constructor(readonly options: Record<string, unknown>) {
      super()
      this.x = options.x as number
      this.y = options.y as number
      windows.push(this)
    }
    getPosition(): number[] { return [this.x, this.y] }
    isDestroyed(): boolean { return this.destroyed }
    isVisible(): boolean { return this.visible }
  }
  return {
    windows,
    state,
    primary,
    screenEvents,
    FakeWindow,
    register: vi.fn((_accelerator: string, _callback: () => void) => true),
    unregister: vi.fn(),
  }
})
vi.mock('electron', () => ({
  BrowserWindow: native.FakeWindow,
  globalShortcut: { register: native.register, unregister: native.unregister },
  screen: {
    getPrimaryDisplay: () => native.state.displays[0],
    getAllDisplays: () => native.state.displays,
    getCursorScreenPoint: () => native.state.cursor,
    on: (event: string, listener: () => void) => native.screenEvents.on(event, listener),
    removeListener: (event: string, listener: () => void) => native.screenEvents.removeListener(event, listener),
  },
}))

const LAYOUT = '1@0,0,1920x1080*1'

afterEach(() => {
  native.windows.length = 0
  native.state.displays = [native.primary]
  native.state.cursor = { x: 0, y: 0 }
  native.screenEvents.removeAllListeners()
  vi.clearAllMocks()
  native.register.mockImplementation(() => true)
})

function setup(saved: Record<string, { x: number; y: number }> = {}) {
  const openMain = vi.fn()
  const onVisibleChange = vi.fn()
  const positions = {
    get: vi.fn((layout: string) => saved[layout]),
    set: vi.fn(async (layout: string, point: { x: number; y: number }) => { saved[layout] = point }),
  }
  const pet = new DesktopPetWindow({
    preload: '/app/preload-app.cjs', applicationUrl: 'dsh-app://app/', openMain,
    positions: positions as unknown as PetPositionStore, onVisibleChange,
  })
  return { pet, openMain, positions, onVisibleChange }
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
      frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, show: false, x: 1564, y: 464,
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

  it('opens at the remembered position for this display layout when it still fits', () => {
    const { pet } = setup({ [LAYOUT]: { x: 100, y: 200 } })
    pet.open()
    expect(native.windows[0]!.options).toMatchObject({ x: 100, y: 200 })
    const plain = new DesktopPetWindow({ preload: '', applicationUrl: 'dsh-app://app/', openMain: () => {} })
    expect(plain.position()).toEqual({ x: 1564, y: 464 })
  })

  it('clamps a remembered position into the work area and ignores one on a missing display', () => {
    const near = setup({ [LAYOUT]: { x: 1700, y: -100 } })
    expect(near.pet.position()).toEqual({ x: 1580, y: 0 })
    const gone = setup({ [LAYOUT]: { x: 5000, y: 100 } })
    expect(gone.pet.position()).toEqual({ x: 1564, y: 464 })
  })

  it('moves with the cursor during a drag and remembers the fitted end position', async () => {
    const { pet, positions } = setup()
    pet.dragStart()
    pet.dragMove()
    pet.dragEnd()
    pet.open()
    const fake = native.windows[0]!
    pet.dragMove()
    pet.dragEnd()
    expect(fake.setBounds).not.toHaveBeenCalled()
    native.state.cursor = { x: 1600, y: 600 }
    pet.dragStart()
    native.state.cursor = { x: 1500, y: 650 }
    pet.dragMove()
    expect(fake.setBounds).toHaveBeenLastCalledWith({ x: 1464, y: 514, width: 340, height: 560 })
    pet.dragEnd()
    expect(fake.setBounds).toHaveBeenLastCalledWith({ x: 1464, y: 480, width: 340, height: 560 })
    expect(positions.set).toHaveBeenCalledWith(LAYOUT, { x: 1464, y: 480 })
    pet.dragStart()
    native.state.cursor = { x: 9000, y: 650 }
    pet.dragMove()
    pet.dragEnd()
    expect(positions.set).toHaveBeenLastCalledWith(LAYOUT, { x: 1464, y: 480 })
    await Promise.resolve()
  })

  it('wanders within the work area and cancels movement and timers when hidden', () => {
    vi.useFakeTimers()
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    const { pet, positions } = setup()
    try {
      pet.open()
      pet.setVisible(true)
      const fake = native.windows[0]!
      fake.setBounds.mockClear()
      pet.setWandering(true)
      vi.advanceTimersByTime(19000)
      expect(fake.setBounds).toHaveBeenCalled()
      expect(positions.set).toHaveBeenCalledOnce()
      const count = fake.setBounds.mock.calls.length
      pet.setInteractive(true)
      vi.advanceTimersByTime(40000)
      expect(fake.setBounds).toHaveBeenCalledTimes(count)
      pet.setVisible(false)
      expect(vi.getTimerCount()).toBe(0)
      pet.dispose()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      pet.dispose()
      random.mockRestore()
      vi.useRealTimers()
    }
  })

  it('reports Host visibility changes and re-places the window when it shows again', () => {
    const saved: Record<string, { x: number; y: number }> = {}
    const { pet, onVisibleChange } = setup(saved)
    expect(pet.visible).toBeUndefined()
    pet.open()
    const fake = native.windows[0]!
    pet.setVisible(true)
    expect(pet.visible).toBe(true)
    expect(onVisibleChange).toHaveBeenCalledOnce()
    pet.setVisible(false)
    saved[LAYOUT] = { x: 10, y: 20 }
    pet.setVisible(true)
    expect(fake.setBounds).toHaveBeenLastCalledWith({ x: 10, y: 20, width: 340, height: 560 })
    expect(onVisibleChange).toHaveBeenCalledTimes(3)
    const quiet = new DesktopPetWindow({ preload: '', applicationUrl: 'dsh-app://app/', openMain: () => {} })
    quiet.open()
    quiet.setVisible(false)
    expect(quiet.visible).toBe(false)
  })

  it('asks the renderer to change visibility only while the window lives', () => {
    const { pet } = setup()
    pet.requestVisible(false)
    pet.open()
    const fake = native.windows[0]!
    pet.requestVisible(false)
    expect(fake.webContents.send).toHaveBeenCalledWith(PET_IPC.requestVisible, false)
    fake.destroy()
    pet.requestVisible(true)
    expect(fake.webContents.send).toHaveBeenCalledOnce()
  })

  it('follows display changes between start and dispose, except during a drag', () => {
    const saved: Record<string, { x: number; y: number }> = {}
    const { pet } = setup(saved)
    pet.start()
    const fake = native.windows[0]!
    const area = { x: 1920, y: 0, width: 1280, height: 1024 }
    const second = { id: 2, bounds: area, workArea: area, scaleFactor: 1 }
    native.state.displays = [native.primary, second]
    saved[`${LAYOUT}|2@1920,0,1280x1024*1`] = { x: 2000, y: 100 }
    native.screenEvents.emit('display-added')
    expect(fake.setBounds).toHaveBeenLastCalledWith({ x: 2000, y: 100, width: 340, height: 560 })
    pet.dragStart()
    native.screenEvents.emit('display-metrics-changed')
    expect(fake.setBounds).toHaveBeenCalledOnce()
    pet.dispose()
    expect(native.screenEvents.listenerCount('display-removed')).toBe(0)
    native.screenEvents.emit('display-removed')
    expect(fake.setBounds).toHaveBeenCalledOnce()
  })

  it('routes drag messages from the pet window', () => {
    const { pet, positions } = setup()
    pet.open()
    const fake = native.windows[0]!
    const { send } = ipcBench(pet)
    send(PET_IPC.dragStart, undefined, fake.webContents)
    native.state.cursor = { x: -100, y: 0 }
    send(PET_IPC.dragMove, undefined, fake.webContents)
    expect(fake.setBounds).toHaveBeenLastCalledWith({ x: 1464, y: 464, width: 340, height: 560 })
    send(PET_IPC.dragEnd, undefined, fake.webContents)
    expect(positions.set).toHaveBeenCalledWith(LAYOUT, { x: 1464, y: 464 })
  })
})
