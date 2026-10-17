/**
 * Studio Pet window: a transparent, frameless, always-on-top companion that
 * loads the same `dsh-app://app/` document as the main window with
 * `?dsh-pet-window=1`, so it boots the full Client and reuses the Host
 * authentication the main process injects (HTTP through the protocol handler,
 * WebSocket through the cookie allowlist that `owns()` extends). Pointer input
 * passes through to the desktop until the renderer reports the cursor over the
 * character or bubble. The global quick-ask shortcut is registered here.
 * "Open main window" may carry a Session id; the main process forwards it to
 * the main window renderer, which shows that Session.
 */
import { BrowserWindow, globalShortcut, screen, type IpcMain, type IpcMainEvent } from 'electron'
import { PET_IPC, PET_WINDOW_QUERY } from './ipc.ts'

export { PET_IPC, PET_WINDOW_QUERY } from './ipc.ts'

/** Default global shortcut that opens the pet quick ask. */
export const PET_QUICK_ASK_ACCELERATOR = 'CommandOrControl+Shift+Space'

/** Pet window size in DIP: room for the bubble above a 112 px character. */
export const PET_WINDOW_SIZE = { width: 340, height: 560 } as const

/**
 * Pet document URL for an application URL.
 * @param applicationUrl - main window document URL.
 * @returns the same document with the pet-window marker.
 */
export function petWindowUrl(applicationUrl: string): string {
  const url = new URL(applicationUrl)
  url.searchParams.set(PET_WINDOW_QUERY, '1')
  return url.href
}

/** Longest Session id accepted from the pet renderer or a deep link. */
export const PET_SESSION_ID_MAX_LENGTH = 200

/**
 * Validate a Session id received over IPC or a deep link. Session ids are
 * opaque to Desktop; only their transport form is checked.
 * @param value - untrusted value.
 * @returns the id, or `undefined` when it is not a non-empty printable string without separators.
 */
export function petSessionId(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > PET_SESSION_ID_MAX_LENGTH) return undefined
  return /^[\w.:-]+$/u.test(value) ? value : undefined
}

/**
 * Read the Session of a `dsh://session/<id>` deep link.
 * @param url - URL handed to the application.
 * @returns the Session id, or `undefined` for any other URL.
 */
export function sessionDeepLink(url: string): string | undefined {
  if (!URL.canParse(url)) return undefined
  const parsed = new URL(url)
  if (parsed.protocol !== 'dsh:' || parsed.hostname !== 'session') return undefined
  const [only, ...rest] = parsed.pathname.split('/').filter(segment => segment.length > 0)
  if (only === undefined || rest.length > 0) return undefined
  try {
    return petSessionId(decodeURIComponent(only))
  } catch (_malformed) {
    // A malformed percent escape names no Session.
    return undefined
  }
}

/** Collaborators supplied by the main process. */
export interface DesktopPetWindowOptions {
  /** Application preload shared with the main window. */
  readonly preload: string
  /** Main window document URL. */
  readonly applicationUrl: string
  /**
   * Bring the main application window forward.
   * @param sessionId - validated Session to show there, when the pet named one.
   */
  readonly openMain: (sessionId: string | undefined) => void
}

/** Owns the pet BrowserWindow, its IPC, and the global shortcut. */
export class DesktopPetWindow {
  private window: BrowserWindow | undefined
  private shortcut: string | undefined
  private disposed = false
  private started = false

  /** @param options - main-process collaborators. */
  constructor(private readonly options: DesktopPetWindowOptions) {}

  /** Open the window and register the global shortcut the first time; later calls keep the current state. */
  start(): void {
    if (this.started || this.disposed) return
    this.started = true
    this.open()
    this.registerShortcut()
  }

  /**
   * Create and load the pet window once; later calls return it.
   * @returns the pet window.
   */
  open(): BrowserWindow {
    if (this.window !== undefined && !this.window.isDestroyed()) return this.window
    const area = screen.getPrimaryDisplay().workArea
    const window = new BrowserWindow({
      width: PET_WINDOW_SIZE.width,
      height: PET_WINDOW_SIZE.height,
      x: area.x + area.width - PET_WINDOW_SIZE.width - 16,
      y: area.y + area.height - PET_WINDOW_SIZE.height - 16,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      webPreferences: {
        preload: this.options.preload,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        devTools: true,
      },
    })
    window.setAlwaysOnTop(true, 'floating')
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    window.setIgnoreMouseEvents(true, { forward: true })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.once('ready-to-show', () => { if (!window.isDestroyed()) window.showInactive() })
    window.on('closed', () => { if (this.window === window) this.window = undefined })
    this.window = window
    void window.loadURL(petWindowUrl(this.options.applicationUrl)).catch((error: unknown) => {
      console.warn('desktop pet: window failed to load', error)
    })
    return window
  }

  /**
   * Whether a renderer belongs to the pet window; extends the Host credential allowlist.
   * @param webContentsId - renderer id from a request or IPC event.
   * @returns true for the live pet window.
   */
  owns(webContentsId: number | undefined): boolean {
    const window = this.window
    return window !== undefined && !window.isDestroyed() && window.webContents.id === webContentsId
  }

  /**
   * Toggle click-through. Non-interactive windows forward mouse moves so the renderer sees `mouseenter`.
   * @param interactive - whether the window takes pointer input.
   */
  setInteractive(interactive: boolean): void {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    if (interactive) window.setIgnoreMouseEvents(false)
    else window.setIgnoreMouseEvents(true, { forward: true })
  }

  /**
   * Follow the Host "show desktop pet" value.
   * @param visible - Host visibility.
   */
  setVisible(visible: boolean): void {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    if (!visible) window.hide()
    else if (!window.isVisible()) window.showInactive()
  }

  /** Show the pet with keyboard focus and ask the renderer to open the quick ask. */
  quickAsk(): void {
    if (this.disposed) return
    const window = this.open()
    window.setIgnoreMouseEvents(false)
    window.show()
    window.focus()
    window.webContents.send(PET_IPC.quickAsk)
  }

  /**
   * Register the global quick-ask shortcut. Another application may own the accelerator.
   * @param accelerator - Electron accelerator.
   * @returns whether the shortcut is registered.
   */
  registerShortcut(accelerator: string = PET_QUICK_ASK_ACCELERATOR): boolean {
    this.unregisterShortcut()
    let registered = false
    try {
      registered = globalShortcut.register(accelerator, () => { this.quickAsk() })
    } catch (error) {
      console.warn('desktop pet: invalid quick-ask shortcut', accelerator, error)
    }
    if (registered) this.shortcut = accelerator
    else console.warn('desktop pet: quick-ask shortcut unavailable', accelerator)
    return registered
  }

  /**
   * Accept renderer requests only from the pet window's top frame.
   * @param ipc - main-process IPC.
   * @returns removes the listeners.
   */
  installIpc(ipc: Pick<IpcMain, 'on' | 'removeListener'>): () => void {
    const guard = (handler: (value: unknown) => void) => (event: IpcMainEvent, value: unknown): void => {
      if (!this.owns(event.sender.id) || event.senderFrame !== event.sender.mainFrame) return
      handler(value)
    }
    const listeners: ReadonlyArray<readonly [string, (event: IpcMainEvent, value: unknown) => void]> = [
      [PET_IPC.setInteractive, guard((value) => { if (typeof value === 'boolean') this.setInteractive(value) })],
      [PET_IPC.setVisible, guard((value) => { if (typeof value === 'boolean') this.setVisible(value) })],
      [PET_IPC.openMain, guard((value) => { this.options.openMain(petSessionId(value)) })],
    ]
    for (const [channel, listener] of listeners) ipc.on(channel, listener)
    return () => { for (const [channel, listener] of listeners) ipc.removeListener(channel, listener) }
  }

  /** Release the shortcut and close the window. */
  dispose(): void {
    this.disposed = true
    this.unregisterShortcut()
    const window = this.window
    this.window = undefined
    if (window !== undefined && !window.isDestroyed()) window.destroy()
  }

  private unregisterShortcut(): void {
    if (this.shortcut === undefined) return
    globalShortcut.unregister(this.shortcut)
    this.shortcut = undefined
  }
}
