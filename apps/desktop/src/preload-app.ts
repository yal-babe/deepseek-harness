/** Origin-scoped boot, native directory selection, host paths of picked files, and update presentation with native confirmation actions. */

import type { DesktopShortcutInput, ShortcutConfigSnapshot, ShortcutSaveResult } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { DESKTOP_IPC, PET_IPC, PET_WINDOW_QUERY, SCHEME, type DshDesktopProductApi, type DesktopUpdatePresentation } from './ipc.ts'
import { PLATFORM_IPC } from './platform-ipc.ts'
import { markDocumentPlatform, syncWindowFullscreen } from './preload-platform.ts'
import { syncNativeTheme } from './preload-theme.ts'
import { syncWindowsAppearance } from './preload-windows.ts'
import { installMandatoryUpdateOverlay } from './preload-mandatory-overlay.ts'
import { createDesktopBrowserBridge } from './preload-browser.ts'

function createProductApi(): DshDesktopProductApi {
  return {
    protocolVersion: 1,
    browser: createDesktopBrowserBridge(),
    deviceInfo: () => ipcRenderer.invoke(DESKTOP_IPC.deviceInfo) as Promise<string>,
    keyboard: {
      closeWindow: revision => ipcRenderer.invoke(DESKTOP_IPC.shortcutsCloseWindow, revision) as Promise<void>,
      subscribe: (listener) => {
        const handle = (_event: Electron.IpcRendererEvent, input: DesktopShortcutInput): void => {
          if (input.kind === 'iframe') {
            const element = document.activeElement
            if (!(element instanceof HTMLIFrameElement) || !element.isConnected
              || !element.matches('iframe[data-sidebar-browser-frame], iframe[data-html-preview]')) return
            if (input.frameName === '' || element.name !== input.frameName) return
          }
          if (input.kind === 'webview') {
            const element = document.activeElement
            if (element?.matches('webview[data-sidebar-browser-frame]') !== true || !element.isConnected
              || input.frameName === '' || element.getAttribute('name') !== input.frameName) return
          }
          listener(input)
        }
        ipcRenderer.on(DESKTOP_IPC.shortcutsInput, handle)
        return () => { ipcRenderer.off(DESKTOP_IPC.shortcutsInput, handle) }
      },
    },
    shortcuts: {
      get: definitions => ipcRenderer.invoke(DESKTOP_IPC.shortcutsGet, definitions) as Promise<ShortcutConfigSnapshot>,
      edit: (edit, revision) => ipcRenderer.invoke(DESKTOP_IPC.shortcutsEdit, edit, revision) as Promise<ShortcutSaveResult>,
      recording: active => ipcRenderer.invoke(DESKTOP_IPC.shortcutsRecording, active) as Promise<void>,
      subscribe(listener) {
        const handle = (_event: Electron.IpcRendererEvent, snapshot: ShortcutConfigSnapshot): void => { listener(snapshot) }
        ipcRenderer.on(DESKTOP_IPC.shortcutsChanged, handle)
        return () => { ipcRenderer.off(DESKTOP_IPC.shortcutsChanged, handle) }
      },
    },
    updates: {
      source: () => ipcRenderer.invoke(DESKTOP_IPC.updatesSource) as Promise<{ url: string | null; version: string }>,
      saveSource: (url: string) => ipcRenderer.invoke(DESKTOP_IPC.updatesSourceSave, url) as Promise<void>,
      status: () => ipcRenderer.invoke(DESKTOP_IPC.updatesStatus) as Promise<DesktopUpdatePresentation>,
      open: () => ipcRenderer.invoke(DESKTOP_IPC.updatesOpen) as Promise<void>,
      subscribe(listener) {
        const handle = (_event: Electron.IpcRendererEvent, state: DesktopUpdatePresentation): void => { listener(state) }
        ipcRenderer.on(DESKTOP_IPC.updatesPresentation, handle)
        return () => { ipcRenderer.off(DESKTOP_IPC.updatesPresentation, handle) }
      },
    },
  }
}

if (location.protocol === `${SCHEME}:` && location.hostname === 'app') {
  contextBridge.exposeInMainWorld('dshOnboarding', {
    hasApiKey: () => ipcRenderer.invoke(DESKTOP_IPC.onboardingApiKey) as Promise<boolean>,
    setActive: (active: boolean) => { ipcRenderer.send(DESKTOP_IPC.onboardingActive, active) },
  })
  ipcRenderer.on(DESKTOP_IPC.enterWorkspace, () => {
    const body = document.body
    const previous = body.getAttribute('tabindex')
    body.tabIndex = -1
    body.focus({ preventScroll: true })
    if (previous === null) body.removeAttribute('tabindex')
    else body.setAttribute('tabindex', previous)
  })
  syncWindowsAppearance()
  if (process.platform === 'win32') installMandatoryUpdateOverlay()
  contextBridge.exposeInMainWorld('__DSH_DIRECTORY_PICKER__', {
    pick: () => ipcRenderer.invoke(DESKTOP_IPC.directoryPick) as Promise<string | null>,
  })
  // The composer cites dropped, picked, and pasted files and folders that
  // have a real path as `@path` references instead of uploading them; a
  // File without one (pasted bytes) answers '' and uploads as before.
  contextBridge.exposeInMainWorld('__DSH_HOST_PATHS__', {
    pathFor: (file: File) => webUtils.getPathForFile(file),
  })
  contextBridge.exposeInMainWorld('dshDesktopBoot', {
    ready: () => ipcRenderer.invoke(DESKTOP_IPC.boot) as Promise<unknown>,
    failed: (message: string) => ipcRenderer.invoke(DESKTOP_IPC.bootFailed, message) as Promise<void>,
  })
  // Studio Pet bridge; the main process accepts these messages only from the pet window's top frame.
  if (process.isMainFrame) {
    contextBridge.exposeInMainWorld('dshDesktopPet', {
      protocolVersion: 1,
      role: new URLSearchParams(location.search).get(PET_WINDOW_QUERY) === '1' ? 'pet' : 'main',
      wander: (active: boolean, activity: 'quiet' | 'normal' | 'lively' = 'normal') => { ipcRenderer.send(PET_IPC.wander, { active, activity }) },
      onMovement: (listener: (value: { moving: boolean; direction: 'left' | 'right' }) => void) => {
        const receive = (_event: Electron.IpcRendererEvent, value: { moving: boolean; direction: 'left' | 'right' }) => { listener(value) }
        ipcRenderer.on(PET_IPC.movement, receive)
        return () => { ipcRenderer.removeListener(PET_IPC.movement, receive) }
      },
      setInteractive: (interactive: boolean) => { ipcRenderer.send(PET_IPC.setInteractive, interactive) },
      setVisible: (visible: boolean) => { ipcRenderer.send(PET_IPC.setVisible, visible) },
      openMain: (sessionId?: string) => { ipcRenderer.send(PET_IPC.openMain, sessionId) },
      onOpenSession: (listener: (sessionId: string) => void) => {
        const handle = (_event: unknown, sessionId: unknown): void => { if (typeof sessionId === 'string') listener(sessionId) }
        ipcRenderer.on(PET_IPC.openSession, handle)
        return () => { ipcRenderer.off(PET_IPC.openSession, handle) }
      },
      onQuickAsk: (listener: () => void) => {
        const handle = (): void => { listener() }
        ipcRenderer.on(PET_IPC.quickAsk, handle)
        return () => { ipcRenderer.off(PET_IPC.quickAsk, handle) }
      },
      onVisibleRequest: (listener: (visible: boolean) => void) => {
        const handle = (_event: unknown, visible: unknown): void => { if (typeof visible === 'boolean') listener(visible) }
        ipcRenderer.on(PET_IPC.requestVisible, handle)
        return () => { ipcRenderer.off(PET_IPC.requestVisible, handle) }
      },
      drag: (phase: 'start' | 'move' | 'end', options?: { thrown?: boolean }) => {
        if (phase === 'end') ipcRenderer.send(PET_IPC.dragEnd, { thrown: options?.thrown === true })
        else ipcRenderer.send(phase === 'start' ? PET_IPC.dragStart : PET_IPC.dragMove)
      },
      place: (point: { x: number; y: number }, final: boolean) => { ipcRenderer.send(PET_IPC.place, { x: point.x, y: point.y, final }) },
      body: (rect: { x: number; y: number; width: number; height: number }) => {
        ipcRenderer.send(PET_IPC.body, { x: rect.x, y: rect.y, width: rect.width, height: rect.height })
      },
      reveal: (open: boolean) => { ipcRenderer.send(PET_IPC.reveal, open) },
      travel: (dx: number, final: boolean) => { ipcRenderer.send(PET_IPC.travel, { dx, final }) },
      onGeometry: (listener: (geometry: unknown) => void) => {
        const handle = (_event: unknown, geometry: unknown): void => { listener(geometry) }
        ipcRenderer.on(PET_IPC.geometry, handle)
        return () => { ipcRenderer.off(PET_IPC.geometry, handle) }
      },
    })
  }
  contextBridge.exposeInMainWorld('dshPlatform', {
    open: (page: 'usage' | 'top-up', bounds: { x: number; y: number; width: number; height: number }) => ipcRenderer.invoke(PLATFORM_IPC.open, page, bounds),
    setBounds: (bounds: { x: number; y: number; width: number; height: number }) => ipcRenderer.invoke(PLATFORM_IPC.bounds, bounds),
    close: () => ipcRenderer.invoke(PLATFORM_IPC.close),
  })
}

markDocumentPlatform()
syncWindowFullscreen()
syncNativeTheme()
// Main-process IPC also verifies the owning window and top frame.
contextBridge.exposeInMainWorld('dshDesktop', location.protocol === `${SCHEME}:` && location.hostname === 'app' && process.isMainFrame ? createProductApi() : { protocolVersion: 1 })

if (location.protocol === `${SCHEME}:` && location.hostname === 'app') {
  contextBridge.exposeInMainWorld('__DSH_LOCALE__', {
    read: () => ipcRenderer.invoke(DESKTOP_IPC.localeBootstrap),
    onChange: (locale: string) => { ipcRenderer.send(DESKTOP_IPC.localeChanged, locale) },
  })
}
