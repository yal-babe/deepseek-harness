/** Where this Client document renders the pet, and the optional Desktop pet-window bridge. */

/** Query parameter that marks the document loaded inside the Desktop pet window. */
export const PET_WINDOW_QUERY = 'dsh-pet-window'

/**
 * Native pet-window controls the Desktop preload exposes as `window.dshDesktopPet`.
 * The Desktop main process mirrors this shape; both sides keep protocol version 1.
 */
export interface DesktopPetBridge {
  /** Bridge protocol version. */
  readonly protocolVersion: 1
  /** `pet` inside the pet window, `main` inside the main application window. */
  readonly role: 'pet' | 'main'
  /**
   * Let the pet window receive pointer input (`true`) or pass clicks through to the desktop (`false`).
   * @param interactive - whether the window takes pointer input.
   */
  /** Enable bounded idle wandering; older Desktop bridges simply omit this capability. */
  readonly wander?: (active: boolean, activity?: 'quiet' | 'normal' | 'lively') => void
  /** Observe native autonomous movement; absent in older bridges. */
  readonly onMovement?: (listener: (value: { moving: boolean; direction: 'left' | 'right' }) => void) => () => void
  readonly setInteractive: (interactive: boolean) => void
  /**
   * Show or hide the pet window to follow the Host "show desktop pet" value.
   * @param visible - Host visibility.
   */
  readonly setVisible: (visible: boolean) => void
  /**
   * Bring the main application window to the front.
   * @param sessionId - Session the main window should show, when one is relevant.
   */
  readonly openMain: (sessionId?: string) => void
  /**
   * Observe Session requests the main process forwards to the main window
   * (from the pet window or a `dsh://session/<id>` link). Present in both roles;
   * only the main window receives requests.
   * @param listener - called with the Session id to show.
   * @returns unsubscribe.
   */
  readonly onOpenSession: (listener: (sessionId: string) => void) => () => void
  /**
   * Observe the global quick-ask shortcut.
   * @param listener - called each time the shortcut fires.
   * @returns unsubscribe.
   */
  readonly onQuickAsk: (listener: () => void) => () => void
  /**
   * Observe requests to change the Host "show desktop pet" value, sent by the
   * Desktop tray to the pet window. Present in both roles; only the pet window receives them.
   * @param listener - called with the wanted visibility.
   * @returns unsubscribe.
   */
  readonly onVisibleRequest: (listener: (visible: boolean) => void) => () => void
  /**
   * Report a character drag; the main process moves the window with the cursor and remembers where it ends.
   * @param phase - drag phase.
   * @param options - `thrown` on `end` when the renderer throws the character; older bridges ignore it.
   */
  readonly drag: (phase: PetDragPhase, options?: { readonly thrown?: boolean }) => void
  /**
   * Ask for a window origin during a throw; the main process throttles, clamps, and saves the final one.
   * Absent in older bridges, which then never throw.
   */
  readonly place?: (point: { readonly x: number; readonly y: number }, final: boolean) => void
  /** Report the character body inside the window, in DIP, so the main process keeps it on screen. */
  readonly body?: (rect: PetDesktopRect) => void
  /** Report that a panel or menu opened or closed; the main process keeps the whole window on screen meanwhile. */
  readonly reveal?: (open: boolean) => void
  /** Observe the window bounds and the work areas and panels of all displays. */
  readonly onGeometry?: (listener: (geometry: unknown) => void) => () => void
  /**
   * Move the window horizontally with a walking clip; the main process keeps the body on screen and saves the final position.
   * Absent in older bridges, which then never walk autonomously.
   */
  readonly travel?: (dx: number, final: boolean) => void
}

/** Rectangle in Desktop DIP coordinates. */
export interface PetDesktopRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Window bounds and display geometry the Desktop main process reports. */
export interface PetDesktopGeometry {
  readonly window: PetDesktopRect
  /** Work areas, one per display. */
  readonly areas: readonly PetDesktopRect[]
  /** Full display bounds in the same order. */
  readonly panels: readonly PetDesktopRect[]
}

function isRect(value: unknown): value is PetDesktopRect {
  if (typeof value !== 'object' || value === null) return false
  const { x, y, width, height } = value as Record<string, unknown>
  return [x, y, width, height].every(field => typeof field === 'number' && Number.isFinite(field)) && Number(width) > 0 && Number(height) > 0
}

/**
 * Validate geometry received from the Desktop main process.
 * @param value - received payload.
 * @returns the geometry, or `undefined` when malformed or without displays.
 */
export function petDesktopGeometry(value: unknown): PetDesktopGeometry | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { window, areas, panels } = value as Record<string, unknown>
  if (!isRect(window) || !Array.isArray(areas) || !Array.isArray(panels) || areas.length === 0) return undefined
  if (!areas.every(isRect) || !panels.every(isRect)) return undefined
  return { window, areas, panels: panels.length === areas.length ? panels : areas }
}

/** Phase of a character drag that moves the Desktop pet window. */
export type PetDragPhase = 'start' | 'move' | 'end'

/** Pet surface of this document. */
export type PetSurface = 'window' | 'page' | 'none'

/**
 * Read the Desktop bridge when the preload exposed a compatible one.
 * @param scope - global object carrying `dshDesktopPet`.
 * @returns the bridge, or `undefined` outside Desktop.
 */
export function desktopPetBridge(scope: object): DesktopPetBridge | undefined {
  const bridge: unknown = Reflect.get(scope, 'dshDesktopPet')
  if (typeof bridge !== 'object' || bridge === null) return undefined
  return Reflect.get(bridge, 'protocolVersion') === 1 ? bridge as DesktopPetBridge : undefined
}

/**
 * Choose the pet surface. The pet-window query renders the pet-only root (Web
 * can open it for preview); Desktop's main window shows no in-page character
 * because the pet window owns it there.
 * @param search - `location.search` of this document.
 * @param bridge - Desktop pet bridge, when present.
 * @returns the surface this document renders.
 */
export function detectPetSurface(search: string, bridge: DesktopPetBridge | undefined): PetSurface {
  if (new URLSearchParams(search).get(PET_WINDOW_QUERY) === '1') return 'window'
  return bridge?.role === 'main' ? 'none' : 'page'
}
