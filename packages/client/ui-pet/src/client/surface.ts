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
}

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
