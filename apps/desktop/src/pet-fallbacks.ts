/**
 * Pure decisions behind two Windows safeguards of the Studio Pet window:
 *
 * - Click-through fallback. The window passes mouse input through and relies on
 *   Electron's forwarded mouse moves for the renderer to report the cursor over
 *   the character. On Windows that forwarding hook can silently stop (a timed-out
 *   low-level hook is removed by the system, or another program's hook interferes),
 *   leaving a pet that cannot be hovered, dragged, or clicked. A main-process poll
 *   of the real cursor position restores input over the character body.
 * - Keep-on-top watchdog. Electron toggles click-through with a read-modify-write of
 *   the extended window style, which keeps the topmost style bit but does not keep
 *   the window in the topmost band; an ordinary window (such as a maximized main
 *   window) can then cover the pet. Re-asserting always-on-top at a low rate puts it
 *   back without moving, resizing, or focusing it.
 *
 * Both are enabled on Windows by default and can be turned on or off with
 * `DSH_PET_POINTER_POLL` and `DSH_PET_TOPMOST_WATCHDOG` (`1`/`0`).
 *
 * Adapted from PC2005-cloud/dsh-pet (MIT), commit 091b27b, dsh-pet/runtime/electron-helper/pointer-target.js
 * and dsh-pet/runtime/electron-helper/topmost-watchdog.js. Changes: the hit area is the body
 * rectangle the renderer reports instead of a canvas hit box; an open panel or menu
 * leaves the decision to the renderer instead of per-control rectangles.
 */
import type { PetPoint, PetRect } from './pet-position.ts'

/** Cursor poll interval of the click-through fallback, in ms (the upstream reporter's measured value). */
export const PET_POINTER_POLL_MS = 60
/** Time the cursor may rest on the window outside the body before input passes through again, in ms. */
export const PET_OFF_BODY_RELEASE_MS = 400
/** Keep-on-top watchdog tick, in ms; a tick only decides whether to re-assert. */
export const PET_TOPMOST_TICK_MS = 1000
/** Shortest interval between always-on-top re-assertions, in ms. */
export const PET_TOPMOST_REASSERT_MS = 5000

/** Which safeguards run. */
export interface PetWindowsFallbacks {
  readonly pointerPoll: boolean
  readonly topmostWatchdog: boolean
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === '1' || value === 'true') return true
  if (value === '0' || value === 'false') return false
  return fallback
}

/**
 * Read which safeguards run: on for Windows unless turned off, off elsewhere unless turned on.
 * @param env - process environment.
 * @param platform - `process.platform`.
 * @returns the enabled safeguards.
 */
export function petWindowsFallbacks(env: Readonly<Record<string, string | undefined>>, platform: string): PetWindowsFallbacks {
  const windows = platform === 'win32'
  return { pointerPoll: flag(env.DSH_PET_POINTER_POLL, windows), topmostWatchdog: flag(env.DSH_PET_TOPMOST_WATCHDOG, windows) }
}

/** Where the cursor is relative to the pet window. */
export type PetPointerZone = 'outside' | 'body' | 'margin'

/**
 * Locate the cursor relative to the window and the character body.
 * @param bounds - window bounds in DIP.
 * @param point - cursor in DIP.
 * @param body - body rectangle relative to the window origin.
 * @returns the zone.
 */
export function petPointerZone(bounds: PetRect, point: PetPoint, body: PetRect): PetPointerZone {
  const inside = (x: number, y: number, width: number, height: number): boolean =>
    point.x >= x && point.x < x + width && point.y >= y && point.y < y + height
  if (!inside(bounds.x, bounds.y, bounds.width, bounds.height)) return 'outside'
  return inside(bounds.x + body.x, bounds.y + body.y, body.width, body.height) ? 'body' : 'margin'
}

/** Inputs of one click-through decision. */
export interface PetIgnoreInput {
  readonly bounds: PetRect
  readonly point: PetPoint
  readonly body: PetRect
  /** Whether the window currently passes input through. */
  readonly ignoring: boolean
  /** A character drag holds the input; position must not interrupt it. */
  readonly dragging: boolean
  /** A panel or menu is open; the renderer decides click-through for its controls. */
  readonly panelOpen: boolean
  /** How long the cursor has rested in the margin, in ms. */
  readonly offBodyMs: number
}

/**
 * Decide whether the window should pass mouse input through
 * (the first argument of `setIgnoreMouseEvents`). A drag always keeps input,
 * because the character lags the cursor and the cursor may leave the window;
 * an open panel or menu keeps the current state; otherwise the body takes
 * input, the outside passes it through, and the margin keeps the current state
 * until the cursor has rested there for {@link PET_OFF_BODY_RELEASE_MS}.
 * @param input - window, cursor, and renderer state.
 * @returns the new click-through state.
 */
export function decidePetIgnore(input: PetIgnoreInput): boolean {
  if (input.dragging) return false
  if (input.panelOpen) return input.ignoring
  const zone = petPointerZone(input.bounds, input.point, input.body)
  if (zone === 'outside') return true
  if (zone === 'body') return false
  return input.offBodyMs >= PET_OFF_BODY_RELEASE_MS ? true : input.ignoring
}

/**
 * Decide whether this watchdog tick re-asserts always-on-top: only for a live,
 * visible, unpaused window, at most every {@link PET_TOPMOST_REASSERT_MS}; a clock
 * that moved backwards counts as due, since re-asserting has no side effect.
 * @param state - clock and window state.
 * @returns whether to re-assert.
 */
export function shouldReassertTopmost(state: {
  readonly nowMs: number
  readonly lastAssertMs: number
  readonly destroyed: boolean
  readonly visible: boolean
  readonly paused: boolean
}): boolean {
  if (state.destroyed || !state.visible || state.paused) return false
  const elapsed = state.nowMs - state.lastAssertMs
  return !(elapsed >= 0 && elapsed < PET_TOPMOST_REASSERT_MS)
}
