/** Device-local character coordinates; panels do not participate in positioning. */
export interface PetPagePoint {
  readonly x: number
  readonly y: number
}

/** Storage key for the page origin. */
export const PET_PAGE_POSITION_KEY = 'dsh-pet:page-position'
/** Unscaled character hitbox in CSS pixels. */
export const PET_CHARACTER_SIZE = { width: 112, height: 142 } as const
const MARGIN = 8

/** Clamp a character origin to the available viewport, including tiny windows.
 * @param point - requested origin.
 * @param width - viewport width.
 * @param height - viewport height.
 * @param size - character size in percent.
 * @returns an origin constrained to the available viewport.
 */
export function clampPetPoint(point: PetPagePoint, width: number, height: number, size = 100): PetPagePoint {
  return {
    x: Math.max(MARGIN, Math.min(point.x, Math.max(MARGIN, width - PET_CHARACTER_SIZE.width * size / 100 - MARGIN))),
    y: Math.max(MARGIN, Math.min(point.y, Math.max(MARGIN, height - PET_CHARACTER_SIZE.height * size / 100 - MARGIN))),
  }
}

/** Read a valid saved origin, otherwise start above the bottom-right composer.
 * @param raw - stored JSON or null.
 * @param width - viewport width.
 * @param height - viewport height.
 * @param size - character size in percent.
 * @returns the restored or default constrained origin.
 */
export function readPetPoint(raw: string | null, width: number, height: number, size = 100): PetPagePoint {
  if (raw !== null) {
    try {
      const value: unknown = JSON.parse(raw)
      if (typeof value === 'object' && value !== null && 'x' in value && 'y' in value
        && typeof value.x === 'number' && Number.isFinite(value.x)
        && typeof value.y === 'number' && Number.isFinite(value.y)) {
        return clampPetPoint({ x: value.x, y: value.y }, width, height, size)
      }
    } catch {
      // An invalid saved record has the same placement as a new device.
    }
  }
  return clampPetPoint({
    x: width - PET_CHARACTER_SIZE.width * size / 100 - 24,
    y: height - PET_CHARACTER_SIZE.height * size / 100 - 96,
  }, width, height, size)
}
