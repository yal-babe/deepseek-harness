/** Device-local character coordinates; panels do not participate in positioning. */
export interface PetPagePoint {
  readonly x: number
  readonly y: number
}

export const PET_PAGE_POSITION_KEY = 'dsh-pet:page-position'
export const PET_CHARACTER_SIZE = { width: 112, height: 121 } as const
const MARGIN = 8

/** Clamp a character origin to the available viewport, including tiny windows. */
export function clampPetPoint(point: PetPagePoint, width: number, height: number): PetPagePoint {
  return {
    x: Math.max(MARGIN, Math.min(point.x, Math.max(MARGIN, width - PET_CHARACTER_SIZE.width - MARGIN))),
    y: Math.max(MARGIN, Math.min(point.y, Math.max(MARGIN, height - PET_CHARACTER_SIZE.height - MARGIN))),
  }
}

/** Read a valid saved origin, otherwise start above the bottom-right composer. */
export function readPetPoint(raw: string | null, width: number, height: number): PetPagePoint {
  if (raw !== null) {
    try {
      const value: unknown = JSON.parse(raw)
      if (typeof value === 'object' && value !== null && 'x' in value && 'y' in value
        && typeof value.x === 'number' && Number.isFinite(value.x)
        && typeof value.y === 'number' && Number.isFinite(value.y)) {
        return clampPetPoint({ x: value.x, y: value.y }, width, height)
      }
    } catch {
      // An invalid saved record has the same placement as a new device.
    }
  }
  return clampPetPoint({ x: width - PET_CHARACTER_SIZE.width - 24, y: height - PET_CHARACTER_SIZE.height - 96 }, width, height)
}
