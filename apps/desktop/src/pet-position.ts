/**
 * Remembered Studio Pet window positions. One position is kept per display
 * layout, so docking and undocking a laptop each restore their own place.
 * Positions live in Electron userData (`pet-window.json`); a missing, damaged,
 * or off-screen entry falls back to the bottom-right of the primary work area.
 */
import { readFileSync } from 'node:fs'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

/** Rectangle in DIP screen coordinates. */
export interface PetRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Window origin in DIP screen coordinates. */
export interface PetPoint {
  readonly x: number
  readonly y: number
}

/** Fields of an Electron `Display` the position logic reads. */
export interface PetDisplay {
  readonly id: number
  readonly bounds: PetRect
  readonly workArea: PetRect
  readonly scaleFactor: number
}

/**
 * Character body inside the pet window at 100% size, in window DIP: the clip
 * box at the bottom-right corner with the 8 px padding. Used until the
 * renderer reports the measured body.
 */
export const PET_DEFAULT_BODY: PetRect = { x: 164, y: 412, width: 168, height: 140 }

/** Gap between the default position and the work-area corner, in DIP. */
export const PET_EDGE_MARGIN = 16

/** Display layouts remembered at most; the oldest is dropped first. */
export const PET_POSITION_LAYOUT_LIMIT = 8

/**
 * Key that identifies the connected displays and their arrangement.
 * @param displays - all connected displays.
 * @returns a stable string for the same set of displays at the same places and scales.
 */
export function petDisplayLayout(displays: readonly PetDisplay[]): string {
  return [...displays]
    .sort((a, b) => a.id - b.id)
    .map(({ id, bounds: { x, y, width, height }, scaleFactor }) => `${String(id)}@${String(x)},${String(y)},${String(width)}x${String(height)}*${String(scaleFactor)}`)
    .join('|')
}

/**
 * Bottom-right corner of a work area.
 * @param workArea - primary display work area.
 * @param size - window size.
 * @returns the default window origin.
 */
export function petDefaultPosition(workArea: PetRect, size: { readonly width: number; readonly height: number }): PetPoint {
  return {
    x: workArea.x + workArea.width - size.width - PET_EDGE_MARGIN,
    y: workArea.y + workArea.height - size.height - PET_EDGE_MARGIN,
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high))
}

/**
 * Keep a window fully inside the work area that holds its center.
 * @param point - wanted window origin.
 * @param displays - all connected displays.
 * @param size - window size.
 * @returns the clamped origin, or `undefined` when no display holds the window center.
 */
export function fitPetPosition(point: PetPoint, displays: readonly PetDisplay[],
  size: { readonly width: number; readonly height: number }): PetPoint | undefined {
  const cx = point.x + size.width / 2
  const cy = point.y + size.height / 2
  const display = displays.find(({ bounds: b }) => cx >= b.x && cx < b.x + b.width && cy >= b.y && cy < b.y + b.height)
  if (display === undefined) return undefined
  const area = display.workArea
  return {
    x: Math.round(clamp(point.x, area.x, area.x + area.width - size.width)),
    y: Math.round(clamp(point.y, area.y, area.y + area.height - size.height)),
  }
}

/**
 * Keep the character body inside the work area of the display that holds the
 * body centre. The rest of the window (bubble room) may extend past the edge,
 * so the character can sit in any corner.
 * @param point - wanted window origin.
 * @param displays - all connected displays.
 * @param body - body rectangle relative to the window origin.
 * @returns the clamped origin, or `undefined` when no display holds the body centre.
 */
export function fitPetBody(point: PetPoint, displays: readonly PetDisplay[], body: PetRect): PetPoint | undefined {
  const cx = point.x + body.x + body.width / 2
  const cy = point.y + body.y + body.height / 2
  const display = displays.find(({ bounds: b }) => cx >= b.x && cx < b.x + b.width && cy >= b.y && cy < b.y + b.height)
  if (display === undefined) return undefined
  const area = display.workArea
  return {
    x: Math.round(clamp(point.x, area.x - body.x, area.x + area.width - body.x - body.width)),
    y: Math.round(clamp(point.y, area.y - body.y, area.y + area.height - body.y - body.height)),
  }
}

/**
 * Move the whole window inside the work area of the display that holds the
 * body centre, so an open panel or menu is fully visible.
 * @param point - current window origin.
 * @param displays - all connected displays.
 * @param size - window size.
 * @param body - body rectangle relative to the window origin.
 * @returns the clamped origin, or `undefined` when no display holds the body centre.
 */
export function revealPetWindow(point: PetPoint, displays: readonly PetDisplay[],
  size: { readonly width: number; readonly height: number }, body: PetRect): PetPoint | undefined {
  const cx = point.x + body.x + body.width / 2
  const cy = point.y + body.y + body.height / 2
  const display = displays.find(({ bounds: b }) => cx >= b.x && cx < b.x + b.width && cy >= b.y && cy < b.y + b.height)
  if (display === undefined) return undefined
  const area = display.workArea
  return {
    x: Math.round(clamp(point.x, area.x, area.x + area.width - size.width)),
    y: Math.round(clamp(point.y, area.y, area.y + area.height - size.height)),
  }
}

/**
 * Validate a body rectangle reported by the renderer.
 * @param value - untrusted value.
 * @param size - window size the body must lie in.
 * @returns the rectangle, or `undefined` when it is not a finite non-empty rectangle inside the window.
 */
export function petBodyRect(value: unknown, size: { readonly width: number; readonly height: number }): PetRect | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { x, y, width, height } = value as Record<string, unknown>
  if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number') return undefined
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return undefined
  if (x < -1 || y < -1 || x + width > size.width + 1 || y + height > size.height + 1) return undefined
  return { x, y, width, height }
}

function isPoint(value: unknown): value is PetPoint {
  if (typeof value !== 'object' || value === null) return false
  const { x, y } = value as Record<string, unknown>
  return Number.isFinite(x) && Number.isFinite(y)
}

/**
 * Validate a window origin the renderer requests during a throw.
 * @param value - untrusted `{ x, y, final }`.
 * @returns the origin and whether the flight ended, or `undefined`.
 */
export function petPlaceRequest(value: unknown): { readonly point: PetPoint; readonly final: boolean } | undefined {
  if (!isPoint(value) || Math.abs(value.x) > 1e6 || Math.abs(value.y) > 1e6) return undefined
  const final = Reflect.get(value, 'final')
  return { point: { x: value.x, y: value.y }, final: final === true }
}

/** Largest horizontal step one walking report may move the window, in DIP. */
export const PET_TRAVEL_STEP_LIMIT = 64

/**
 * Validate a walking step the renderer reports.
 * @param value - untrusted `{ dx, final }`.
 * @returns the step and whether the walk ended, or `undefined`.
 */
export function petTravelRequest(value: unknown): { readonly dx: number; readonly final: boolean } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const dx = Reflect.get(value, 'dx')
  if (typeof dx !== 'number' || !Number.isFinite(dx) || Math.abs(dx) > PET_TRAVEL_STEP_LIMIT) return undefined
  return { dx, final: Reflect.get(value, 'final') === true }
}

/** Reads and writes `pet-window.json`; writes are serialized and atomic. */
export class PetPositionStore {
  private readonly layouts = new Map<string, PetPoint>()
  private writing: Promise<void> = Promise.resolve()

  /**
   * Load the remembered positions; an unreadable file starts empty.
   * @param path - JSON file under Electron userData.
   */
  constructor(private readonly path: string) {
    let raw: string
    try {
      raw = readFileSync(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('desktop pet: positions unreadable', error)
      return
    }
    try {
      const value: unknown = JSON.parse(raw)
      const layouts: unknown = typeof value === 'object' && value !== null && Reflect.get(value, 'version') === 1
        ? Reflect.get(value, 'layouts') : undefined
      if (typeof layouts !== 'object' || layouts === null) throw new Error('expected { version: 1, layouts }')
      for (const [layout, point] of Object.entries(layouts)) {
        if (isPoint(point)) this.layouts.set(layout, { x: point.x, y: point.y })
      }
    } catch (error) {
      console.warn('desktop pet: ignoring damaged positions', error)
    }
  }

  /**
   * Remembered position for a display layout.
   * @param layout - key from {@link petDisplayLayout}.
   * @returns the stored origin, unchecked against the current displays.
   */
  get(layout: string): PetPoint | undefined {
    return this.layouts.get(layout)
  }

  /**
   * Remember a position and write the file.
   * @param layout - key from {@link petDisplayLayout}.
   * @param point - window origin.
   * @returns settles after this write; a failed write only logs a warning.
   */
  set(layout: string, point: PetPoint): Promise<void> {
    this.layouts.delete(layout)
    this.layouts.set(layout, { x: point.x, y: point.y })
    for (const oldest of this.layouts.keys()) {
      if (this.layouts.size <= PET_POSITION_LAYOUT_LIMIT) break
      this.layouts.delete(oldest)
    }
    const raw = `${JSON.stringify({ version: 1, layouts: Object.fromEntries(this.layouts) }, null, 2)}\n`
    this.writing = this.writing.then(() => writeFileAtomic(this.path, raw, { mode: 0o600, dirMode: 0o700 }))
      .catch((error: unknown) => { console.warn('desktop pet: positions not saved', error) })
    return this.writing
  }
}
