/**
 * Studio Pet window: a transparent, frameless, always-on-top companion that
 * loads the same `dsh-app://app/` document as the main window with
 * `?dsh-pet-window=1`, so it boots the full Client and reuses the Host
 * authentication the main process injects (HTTP through the protocol handler,
 * WebSocket through the cookie allowlist that `owns()` extends). Pointer input
 * passes through to the desktop until the renderer reports the cursor over the
 * character or bubble. The global quick-ask shortcut is registered here.
 * "Open main window" may carry a Session id; the main process forwards it to
 * the main window renderer, which shows that Session. Dragging the character
 * moves the window; the position is remembered per display layout. A fling is
 * thrown by the renderer, which steps the physics and asks for each window
 * origin; this process validates, throttles, and clamps those requests, and
 * keeps the character body (not the whole window) inside a work area so the
 * character can reach every screen edge. While a panel or menu is open the
 * whole window is moved on screen and put back afterwards.
 */
import { BrowserWindow, globalShortcut, screen, type IpcMain, type IpcMainEvent } from 'electron'
import { PET_IPC, PET_WINDOW_QUERY } from './ipc.ts'
import {
  fitPetBody, PET_DEFAULT_BODY, petBodyRect, petDefaultPosition, petDisplayLayout, petPlaceRequest, revealPetWindow,
  type PetPoint, type PetPositionStore, type PetRect,
} from './pet-position.ts'

export { PET_IPC, PET_WINDOW_QUERY } from './ipc.ts'

/** Default global shortcut that opens the pet quick ask. */
export const PET_QUICK_ASK_ACCELERATOR = 'CommandOrControl+Shift+Space'

/** Pet window size in DIP: room for the bubble above a 112 px character. */
export const PET_WINDOW_SIZE = { width: 340, height: 560 } as const

/** Shortest interval between window moves during a throw, in ms; later requests replace a pending one. */
export const PET_PLACE_INTERVAL_MS = 16

/** A throw without a request for this long ends where the window is, in ms (a renderer that stopped reporting). */
export const PET_FLIGHT_IDLE_MS = 3000

/** Window bounds and display geometry sent to the pet renderer, in DIP. */
export interface PetWindowGeometry {
  readonly window: PetRect
  /** Work areas, one per display. */
  readonly areas: readonly PetRect[]
  /** Full display bounds in the same order. */
  readonly panels: readonly PetRect[]
}

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
  /** Remembered positions; without it the window always opens at the default corner. */
  readonly positions?: PetPositionStore
  /** Called when the Host visibility the renderer reports changes, so the tray can relabel. */
  readonly onVisibleChange?: () => void
}

/** Owns the pet BrowserWindow, its IPC, and the global shortcut. */
export class DesktopPetWindow {
  private window: BrowserWindow | undefined
  private shortcut: string | undefined
  private disposed = false
  private started = false
  private hostVisible: boolean | undefined
  private drag: { readonly cursor: PetPoint; readonly origin: PetPoint } | undefined
  private wanderTimer: ReturnType<typeof setTimeout> | undefined
  private wanderMove: ReturnType<typeof setInterval> | undefined
  private wandering = false
  private activity: 'quiet' | 'normal' | 'lively' = 'normal'
  private direction: 'left' | 'right' = 'right'
  private interactive = false
  private body: PetRect = PET_DEFAULT_BODY
  private revealed: PetPoint | undefined
  private flight: {
    pending: PetPoint | undefined
    timer: ReturnType<typeof setTimeout> | undefined
    idle: ReturnType<typeof setTimeout> | undefined
    last: number
  } | undefined
  private readonly relocate = (): void => { this.place(); this.sendGeometry() }

  /** @param options - main-process collaborators. */
  constructor(private readonly options: DesktopPetWindowOptions) {}

  /** Open the window and register the global shortcut the first time; later calls keep the current state. */
  start(): void {
    if (this.started || this.disposed) return
    this.started = true
    this.open()
    this.registerShortcut()
    screen.on('display-added', this.relocate)
    screen.on('display-removed', this.relocate)
    screen.on('display-metrics-changed', this.relocate)
  }

  /** Host "show desktop pet" value last reported by the renderer; `undefined` before the first report. */
  get visible(): boolean | undefined {
    return this.hostVisible
  }

  /**
   * Ask the pet renderer to change the Host "show desktop pet" value; the window follows the Host.
   * @param visible - wanted visibility.
   */
  requestVisible(visible: boolean): void {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    window.webContents.send(PET_IPC.requestVisible, visible)
  }

  /**
   * Window origin for the current displays: the remembered one when it still fits, else the default corner.
   * @returns the origin in DIP.
   */
  position(): PetPoint {
    const displays = screen.getAllDisplays()
    const saved = this.options.positions?.get(petDisplayLayout(displays))
    return (saved === undefined ? undefined : fitPetBody(saved, displays, this.body))
      ?? petDefaultPosition(screen.getPrimaryDisplay().workArea, PET_WINDOW_SIZE)
  }

  /**
   * Create and load the pet window once; later calls return it.
   * @returns the pet window.
   */
  open(): BrowserWindow {
    if (this.window !== undefined && !this.window.isDestroyed()) return this.window
    const { x, y } = this.position()
    const window = new BrowserWindow({
      width: PET_WINDOW_SIZE.width,
      height: PET_WINDOW_SIZE.height,
      x,
      y,
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
    this.interactive = interactive
    if (interactive) this.stopWanderMove()
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
    const changed = this.hostVisible !== visible
    this.hostVisible = visible
    if (!visible) { this.setWandering(false); window.hide() }
    else if (!window.isVisible()) {
      // Displays may have changed while hidden.
      this.place()
      window.showInactive()
    }
    if (changed) this.options.onVisibleChange?.()
  }

  /** Start moving the window with the cursor; catching a thrown character ends its flight. */
  dragStart(): void {
    this.stopWanderMove()
    this.endFlight()
    this.revealed = undefined
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    const [x = 0, y = 0] = window.getPosition()
    this.drag = { cursor: screen.getCursorScreenPoint(), origin: { x, y } }
  }

  /** Follow the cursor during a drag. */
  dragMove(): void {
    const window = this.window
    const drag = this.drag
    if (drag === undefined || window === undefined || window.isDestroyed()) return
    const cursor = screen.getCursorScreenPoint()
    this.moveTo({ x: drag.origin.x + cursor.x - drag.cursor.x, y: drag.origin.y + cursor.y - drag.cursor.y })
  }

  /**
   * Finish a drag: keep the character on screen and remember the position for this display layout.
   * @param thrown - the renderer throws the character; the position is fitted and saved when the flight ends.
   */
  dragEnd(thrown = false): void {
    const window = this.window
    if (this.drag === undefined || window === undefined || window.isDestroyed()) return
    this.drag = undefined
    if (thrown) { this.startFlight(); return }
    const [x = 0, y = 0] = window.getPosition()
    this.settle({ x, y })
  }

  /**
   * Move the window to an origin the renderer computed during a throw. Moves are
   * throttled to {@link PET_PLACE_INTERVAL_MS} and kept within reach of the
   * displays; the final request fits the body into a work area and is saved.
   * @param point - requested window origin.
   * @param final - whether the flight ended.
   */
  placeThrown(point: PetPoint, final: boolean): void {
    const window = this.window
    if (this.drag !== undefined || window === undefined || window.isDestroyed()) return
    if (final) { this.endFlight(); this.settle(point); return }
    const flight = this.startFlight()
    flight.pending = this.reachable(point)
    if (flight.timer !== undefined) return
    const wait = flight.last + PET_PLACE_INTERVAL_MS - Date.now()
    const apply = (): void => {
      flight.timer = undefined
      if (this.flight !== flight || flight.pending === undefined) return
      flight.last = Date.now()
      this.moveTo(flight.pending)
      flight.pending = undefined
    }
    if (wait <= 0) apply()
    else flight.timer = setTimeout(apply, wait)
  }

  /**
   * Record the character body the renderer measured, so fitting keeps the visible character on screen.
   * @param body - body rectangle inside the window.
   */
  setBody(body: PetRect): void {
    this.body = body
    this.sendGeometry()
  }

  /**
   * Keep the whole window, including the panel or menu, on screen while one is open; put it back afterwards.
   * @param open - whether a panel or menu is open.
   */
  reveal(open: boolean): void {
    const window = this.window
    if (this.drag !== undefined || window === undefined || window.isDestroyed()) return
    const [x = 0, y = 0] = window.getPosition()
    if (open) {
      const inside = revealPetWindow({ x, y }, screen.getAllDisplays(), PET_WINDOW_SIZE, this.body)
      if (inside === undefined || inside.x === x && inside.y === y) return
      this.revealed ??= { x, y }
      this.moveTo(inside)
    } else if (this.revealed !== undefined) {
      const back = this.revealed
      this.revealed = undefined
      this.moveTo(fitPetBody(back, screen.getAllDisplays(), this.body) ?? this.position())
    }
    this.sendGeometry()
  }

  /** Window bounds and display geometry, or `undefined` without a live window. */
  geometry(): PetWindowGeometry | undefined {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return undefined
    const [x = 0, y = 0] = window.getPosition()
    const displays = screen.getAllDisplays()
    return {
      window: { x, y, ...PET_WINDOW_SIZE },
      areas: displays.map(display => ({ ...display.workArea })),
      panels: displays.map(display => ({ ...display.bounds })),
    }
  }

  private sendGeometry(): void {
    const geometry = this.geometry()
    if (geometry !== undefined) this.window?.webContents.send(PET_IPC.geometry, geometry)
  }

  /** Fit the body into a work area, move there, remember it, and tell the renderer. */
  private settle(point: PetPoint): void {
    const displays = screen.getAllDisplays()
    const fitted = fitPetBody(point, displays, this.body) ?? this.position()
    this.moveTo(fitted)
    void this.options.positions?.set(petDisplayLayout(displays), fitted)
    this.sendGeometry()
  }

  /** Keep a mid-flight origin so the body centre stays within the hull of all displays. */
  private reachable(point: PetPoint): PetPoint {
    const panels = screen.getAllDisplays().map(display => display.bounds)
    if (panels.length === 0) return point
    const left = Math.min(...panels.map(panel => panel.x))
    const top = Math.min(...panels.map(panel => panel.y))
    const right = Math.max(...panels.map(panel => panel.x + panel.width))
    const bottom = Math.max(...panels.map(panel => panel.y + panel.height))
    const cx = this.body.x + this.body.width / 2
    const cy = this.body.y + this.body.height / 2
    return { x: Math.min(Math.max(point.x, left - cx), right - cx), y: Math.min(Math.max(point.y, top - cy), bottom - cy) }
  }

  /** Begin or continue a throw and re-arm its idle timeout. */
  private startFlight(): NonNullable<DesktopPetWindow['flight']> {
    const flight = this.flight ??= { pending: undefined, timer: undefined, idle: undefined, last: 0 }
    if (flight.idle !== undefined) clearTimeout(flight.idle)
    flight.idle = setTimeout(() => {
      if (this.flight !== flight) return
      this.endFlight()
      const window = this.window
      if (window === undefined || window.isDestroyed()) return
      const [x = 0, y = 0] = window.getPosition()
      this.settle({ x, y })
    }, PET_FLIGHT_IDLE_MS)
    return flight
  }

  private endFlight(): void {
    if (this.flight?.timer !== undefined) clearTimeout(this.flight.timer)
    if (this.flight?.idle !== undefined) clearTimeout(this.flight.idle)
    this.flight = undefined
  }

  /** Schedule short movements only while the renderer reports an unobstructed idle surface. */
  setWandering(active: boolean, activity: 'quiet' | 'normal' | 'lively' = 'normal'): void {
    if (this.disposed || this.wandering === active && this.activity === activity) return
    if (this.wanderTimer !== undefined) clearTimeout(this.wanderTimer)
    this.stopWanderMove()
    this.activity = activity
    this.wandering = active
    if (!active) {
      if (this.wanderTimer !== undefined) clearTimeout(this.wanderTimer)
      this.wanderTimer = undefined
      this.stopWanderMove()
      return
    }
    const step = (): void => {
      this.wanderTimer = undefined
      const window = this.window
      if (!this.wandering || window === undefined || window.isDestroyed()) return
      const [x = 0, y = 0] = window.getPosition()
      const cursor = screen.getCursorScreenPoint()
      const near = Math.hypot(cursor.x - (x + PET_WINDOW_SIZE.width - 64), cursor.y - (y + PET_WINDOW_SIZE.height - 70)) < 180
      let movementDuration = 0
      if (!this.interactive && !near && this.drag === undefined && this.flight === undefined && window.isVisible()) {
        const target = fitPetBody({ x: x + (Math.random() - 0.5) * 160, y: y + (Math.random() - 0.5) * 100 },
          screen.getAllDisplays(), this.body)
        if (target !== undefined) {
          this.direction = target.x < x ? 'left' : 'right'
          window.webContents.send(PET_IPC.movement, { moving: true, direction: this.direction })
          movementDuration = 30 * 33
          let frame = 0
          this.wanderMove = setInterval(() => {
            frame += 1
            const progress = Math.min(1, frame / 30)
            const eased = progress * progress * (3 - 2 * progress)
            this.moveTo({ x: x + (target.x - x) * eased, y: y + (target.y - y) * eased })
            if (progress === 1) {
              this.stopWanderMove()
              void this.options.positions?.set(petDisplayLayout(screen.getAllDisplays()), target)
            }
          }, 33)
        }
      }
      this.wanderTimer = setTimeout(step, this.wanderDelay() + movementDuration)
    }
    this.wanderTimer = setTimeout(step, this.wanderDelay())
  }

  private wanderDelay(): number {
    const [min, max]: readonly [number, number] = this.activity === 'lively' ? [8000, 16000] : this.activity === 'quiet' ? [45000, 90000] : [20000, 40000]
    return min + Math.round(Math.random() * (max - min))
  }

  private stopWanderMove(): void {
    if (this.wanderMove !== undefined) {
      clearInterval(this.wanderMove)
      if (this.window !== undefined && !this.window.isDestroyed()) {
        this.window.webContents.send(PET_IPC.movement, { moving: false, direction: this.direction })
      }
    }
    this.wanderMove = undefined
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
      [PET_IPC.dragStart, guard(() => { this.dragStart() })],
      [PET_IPC.dragMove, guard(() => { this.dragMove() })],
      [PET_IPC.dragEnd, guard((value) => {
        this.dragEnd(typeof value === 'object' && value !== null && Reflect.get(value, 'thrown') === true)
      })],
      [PET_IPC.place, guard((value) => {
        const request = petPlaceRequest(value)
        if (request !== undefined) this.placeThrown(request.point, request.final)
      })],
      [PET_IPC.body, guard((value) => {
        const body = petBodyRect(value, PET_WINDOW_SIZE)
        if (body !== undefined) this.setBody(body)
      })],
      [PET_IPC.reveal, guard((value) => { if (typeof value === 'boolean') this.reveal(value) })],
      [PET_IPC.wander, guard((value) => {
        if (typeof value === 'boolean') this.setWandering(value)
        else if (typeof value === 'object' && value !== null && 'active' in value && typeof value.active === 'boolean'
          && 'activity' in value && (value.activity === 'quiet' || value.activity === 'normal' || value.activity === 'lively')) {
          this.setWandering(value.active, value.activity)
        }
      })],
    ]
    for (const [channel, listener] of listeners) ipc.on(channel, listener)
    return () => { for (const [channel, listener] of listeners) ipc.removeListener(channel, listener) }
  }

  /** Release the shortcut and close the window. */
  dispose(): void {
    this.setWandering(false)
    this.endFlight()
    this.disposed = true
    this.unregisterShortcut()
    screen.removeListener('display-added', this.relocate)
    screen.removeListener('display-removed', this.relocate)
    screen.removeListener('display-metrics-changed', this.relocate)
    const window = this.window
    this.window = undefined
    if (window !== undefined && !window.isDestroyed()) window.destroy()
  }

  /** Move the window to the position for the current displays, unless a drag or throw is running. */
  private place(): void {
    const window = this.window
    if (this.drag !== undefined || this.flight !== undefined || window === undefined || window.isDestroyed()) return
    this.revealed = undefined
    this.moveTo(this.position())
  }

  private moveTo(point: PetPoint): void {
    // setBounds keeps the size; setPosition can grow transparent windows on fractional Windows scales.
    this.window?.setBounds({ x: Math.round(point.x), y: Math.round(point.y), ...PET_WINDOW_SIZE })
  }

  private unregisterShortcut(): void {
    if (this.shortcut === undefined) return
    globalShortcut.unregister(this.shortcut)
    this.shortcut = undefined
  }
}
