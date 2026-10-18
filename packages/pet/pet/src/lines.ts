/**
 * Local line tables of a pet pack (`lines.json`, format version 2) and the
 * pure picker that chooses one line for a trigger. Lines are never generated
 * by a model: a pack ships every line in zh and en, and the picker only
 * selects among them. Browser-safe; reads no clock and no randomness of its
 * own.
 *
 * Time-of-day and festival triggers derive from a {@link PetMoment}:
 * `festival.<id>.<phase>`, then `festival.<id>` for the festival days
 * themselves (`today`, `during`, `last-day`), then `greet.<slot>`.
 */
import type { PetFestivalPhase, PetMoment } from './time-context.ts'

/** One line in both locales. */
export interface PetLine {
  readonly zh: string
  readonly en: string
}

/** Validated `lines.json`. */
export interface PetLineTable {
  readonly formatVersion: 2
  /** Lines by trigger key, such as `turn.success` or `greet.morning`. */
  readonly lines: Readonly<Record<string, readonly PetLine[]>>
}

/** Result of {@link parsePetLines}: the table, or every problem found. */
export type PetLinesParseResult =
  | { readonly ok: true; readonly table: PetLineTable }
  | { readonly ok: false; readonly errors: readonly string[] }

/** One picked line and the trigger that supplied it. */
export interface PetLinePick {
  readonly trigger: string
  readonly line: PetLine
}

const TRIGGER = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Validate a parsed `lines.json`.
 * @param value - JSON value read from a pack.
 * @returns the table, or all problems at once.
 */
export function parsePetLines(value: unknown): PetLinesParseResult {
  const errors: string[] = []
  if (!isRecord(value)) return { ok: false, errors: ['lines.json must be an object'] }
  if (value['formatVersion'] !== 2) errors.push('formatVersion must be 2')
  const raw = value['lines']
  const lines: Record<string, PetLine[]> = {}
  if (!isRecord(raw)) {
    errors.push('lines must map trigger keys to arrays')
  } else {
    for (const [trigger, entries] of Object.entries(raw)) {
      if (!TRIGGER.test(trigger)) errors.push(`trigger "${trigger}" must be dot-separated lowercase segments`)
      if (!Array.isArray(entries) || entries.length === 0) {
        errors.push(`trigger "${trigger}" must list at least one line`)
        continue
      }
      const valid: PetLine[] = []
      for (const [index, entry] of entries.entries()) {
        if (isRecord(entry) && isText(entry['zh']) && isText(entry['en']) && Object.keys(entry).length === 2) {
          valid.push({ zh: entry['zh'], en: entry['en'] })
        } else {
          errors.push(`trigger "${trigger}" line ${String(index)} must have exactly non-empty zh and en`)
        }
      }
      lines[trigger] = valid
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, table: { formatVersion: 2, lines } }
}

/** Festival phases on which the festival's own line (`festival.<id>`) applies. */
const FESTIVAL_DAY_PHASES: ReadonlySet<PetFestivalPhase> = new Set(['today', 'during', 'last-day'])

/**
 * Trigger keys for a moment, most specific first.
 * @param moment - local time context.
 * @returns `festival.<id>.<phase>`, `festival.<id>` on festival days, then `greet.<slot>`.
 */
export function petMomentTriggers(moment: PetMoment): string[] {
  const triggers: string[] = []
  const festival = moment.festival
  if (festival !== undefined) {
    triggers.push(`festival.${festival.id}.${festival.phase}`)
    if (FESTIVAL_DAY_PHASES.has(festival.phase)) triggers.push(`festival.${festival.id}`)
  }
  triggers.push(`greet.${moment.slot}`)
  return triggers
}

/**
 * Pick one line from the first trigger that has lines.
 * @param table - validated line table.
 * @param triggers - trigger keys in preference order.
 * @param random - uniform source in [0, 1), such as `Math.random`.
 * @param previous - line shown last; another line of the same trigger is preferred.
 * @returns the line and its trigger, or `undefined` when no trigger has lines.
 */
export function pickPetLine(
  table: PetLineTable,
  triggers: readonly string[],
  random: () => number,
  previous?: PetLine,
): PetLinePick | undefined {
  for (const trigger of triggers) {
    const entries = table.lines[trigger]
    if (entries === undefined || entries.length === 0) continue
    const fresh = entries.length > 1 && previous !== undefined
      ? entries.filter(entry => entry.zh !== previous.zh || entry.en !== previous.en)
      : entries
    const pool = fresh.length > 0 ? fresh : entries
    const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)))
    const line = pool[index]
    if (line !== undefined) return { trigger, line }
  }
  return undefined
}
