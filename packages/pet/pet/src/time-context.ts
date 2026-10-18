/**
 * Local time context of the pet: the time-of-day slot, workday or weekend,
 * and the festival or school break the date falls near. The result is a set of
 * structured codes; lines and copy live in the pack's `lines.json` and the
 * Client dictionaries, never here. The module reads no clock and imports
 * nothing, so it runs on the Host and in a browser alike.
 *
 * Adapted from PC2005-cloud/dsh-pet (MIT), commit 091b27b,
 * dsh-pet/src/host/time-context.ts. See this package's NOTICE.
 *
 * Calendar rules:
 * - Fields come from the `Date`'s local time, so slots follow the time zone of
 *   the process that calls {@link petMomentOf}.
 * - Lunar dates use the ICU Chinese calendar (`Intl.DateTimeFormat` with
 *   `ca-chinese`). Without that calendar, lunar festivals and the
 *   Spring Festival Eve are skipped; solar festivals and breaks still apply.
 *   ICU places the first lunar month one day off when the new moon falls within
 *   minutes of midnight UTC+8: 2027-02-06 and 2030-02-03 are each read one day
 *   late or early (upstream measured 2 of 445 month starts in 2025–2060).
 * - School breaks use fixed approximate ranges (winter 1-20 to 2-18, summer
 *   7-1 to 8-29); provincial calendars differ.
 * - Workday means Monday to Friday; statutory make-up workdays are not known.
 * - When several festivals cover one day, the earlier entry of
 *   {@link PET_FESTIVALS} wins.
 */

/** Nine time-of-day slots, by starting local hour: 0, 5, 7, 9, 11, 13, 17, 19, 23. */
export type PetDaySlot =
  | 'small-hours'
  | 'dawn'
  | 'morning'
  | 'forenoon'
  | 'noon'
  | 'afternoon'
  | 'dusk'
  | 'evening'
  | 'late-night'

/** Monday to Friday, or Saturday and Sunday. */
export type PetDayKind = 'workday' | 'weekend'

/** Festival, observance, or school break known to the pet. */
export type PetFestivalId =
  | 'valentines-day'
  | 'new-years-eve'
  | 'april-fools'
  | 'youth-day'
  | 'spring-festival-eve'
  | 'lantern-festival'
  | 'spring-festival'
  | 'mid-autumn'
  | 'national-day'
  | 'new-year'
  | 'dragon-boat'
  | 'qingming'
  | 'labor-day'
  | 'childrens-day'
  | 'qixi'
  | 'zhongyuan'
  | 'longtaitou'
  | 'double-ninth'
  | 'laba'
  | 'xiaonian'
  | 'winter-break'
  | 'summer-break'
  | 'womens-day'
  | 'teachers-day'
  | 'party-founding-day'
  | 'army-day'
  | 'halloween'
  | 'christmas-eve'
  | 'christmas'

/**
 * Position of the date relative to a festival: `soon` (two or more days
 * before), `tomorrow`, `today` (first day), `during` (inside a multi-day
 * holiday or break), `ending` (last days of a break), `last-day` (last day of a
 * multi-day holiday), `just-over` (first two days after), `over` (later days
 * after, inside the festival's afterglow window).
 */
export type PetFestivalPhase = 'soon' | 'tomorrow' | 'today' | 'during' | 'ending' | 'last-day' | 'just-over' | 'over'

/** Festival near the date. */
export interface PetFestivalMoment {
  /** Which festival. */
  readonly id: PetFestivalId
  /** Where the date falls relative to it. */
  readonly phase: PetFestivalPhase
}

/** Structured local time context; the Client picks local lines from it. */
export interface PetMoment {
  /** Local calendar date, `YYYY-MM-DD`. */
  readonly date: string
  /** Time-of-day slot. */
  readonly slot: PetDaySlot
  /** Workday or weekend. */
  readonly dayKind: PetDayKind
  /** Highest-priority festival whose window covers the date, if any. */
  readonly festival?: PetFestivalMoment
}

/** Slot starts, latest first; the first start not after the hour wins. */
const SLOTS: readonly (readonly [number, PetDaySlot])[] = [
  [23, 'late-night'],
  [19, 'evening'],
  [17, 'dusk'],
  [13, 'afternoon'],
  [11, 'noon'],
  [9, 'forenoon'],
  [7, 'morning'],
  [5, 'dawn'],
  [0, 'small-hours'],
]

/** Local hours at which {@link petDaySlotOf} changes. */
export const PET_SLOT_START_HOURS: readonly number[] = SLOTS.map(([hour]) => hour).sort((left, right) => left - right)

const DAY_MS = 86_400_000
const DEFAULT_AHEAD = 3
const DEFAULT_SPAN = 1
const DEFAULT_AFTER = 3
const BREAK_AHEAD = 3
const BREAK_ENDING = 3
const BREAK_AFTER = 3

/**
 * Time-of-day slot of a local hour.
 * @param hour - `Date.getHours()`, normally 0–23.
 * @returns the slot; hours below 0 or `NaN` read as `small-hours`.
 */
export function petDaySlotOf(hour: number): PetDaySlot {
  for (const [start, slot] of SLOTS) {
    if (hour >= start) return slot
  }
  return 'small-hours'
}

/**
 * Workday or weekend of a weekday number.
 * @param day - `Date.getDay()` (0 is Sunday).
 * @returns `weekend` for Saturday and Sunday, otherwise `workday`.
 */
export function petDayKindOf(day: number): PetDayKind {
  return day === 0 || day === 6 ? 'weekend' : 'workday'
}

interface FestivalWindow {
  /** Days before the first day that read as `soon` / `tomorrow`. */
  readonly ahead?: number
  /** Length of the holiday in days. */
  readonly span?: number
  /** Days after the holiday that read as `just-over` / `over`. */
  readonly after?: number
}

/** One festival rule: a solar day, a lunar day, the last day of the lunar year, or a solar date range. */
export type PetFestivalRule = FestivalWindow & { readonly id: PetFestivalId } & (
  | { readonly kind: 'solar'; readonly monthDay: string }
  | { readonly kind: 'lunar'; readonly monthDay: string }
  | { readonly kind: 'lunar-eve' }
  | { readonly kind: 'break'; readonly from: string; readonly to: string }
)

/**
 * Festival rules in priority order: when several windows cover one date, the
 * earlier rule wins. Single-day observances that neighbour a larger festival
 * come first with `after: 0`; the Spring Festival Eve and the Lantern Festival
 * precede the Spring Festival; traditional festivals precede the school breaks;
 * commemorative days come last, after the breaks.
 */
export const PET_FESTIVALS: readonly PetFestivalRule[] = [
  { kind: 'solar', monthDay: '2-14', id: 'valentines-day', after: 0 },
  { kind: 'solar', monthDay: '12-31', id: 'new-years-eve', after: 0 },
  { kind: 'solar', monthDay: '4-1', id: 'april-fools', after: 0 },
  { kind: 'solar', monthDay: '5-4', id: 'youth-day', ahead: 0, after: 0 },
  { kind: 'lunar-eve', id: 'spring-festival-eve', ahead: 1, after: 0 },
  { kind: 'lunar', monthDay: '1-15', id: 'lantern-festival' },
  { kind: 'lunar', monthDay: '1-1', id: 'spring-festival', span: 15 },
  { kind: 'lunar', monthDay: '8-15', id: 'mid-autumn', span: 3, after: 2 },
  { kind: 'solar', monthDay: '10-1', id: 'national-day', span: 7 },
  { kind: 'solar', monthDay: '1-1', id: 'new-year', span: 3 },
  { kind: 'lunar', monthDay: '5-5', id: 'dragon-boat', span: 3 },
  { kind: 'solar', monthDay: '4-4', id: 'qingming', span: 3, ahead: 1 },
  { kind: 'solar', monthDay: '5-1', id: 'labor-day', span: 3 },
  { kind: 'solar', monthDay: '6-1', id: 'childrens-day' },
  { kind: 'lunar', monthDay: '7-7', id: 'qixi' },
  { kind: 'lunar', monthDay: '7-15', id: 'zhongyuan' },
  { kind: 'lunar', monthDay: '2-2', id: 'longtaitou' },
  { kind: 'lunar', monthDay: '9-9', id: 'double-ninth' },
  { kind: 'lunar', monthDay: '12-8', id: 'laba' },
  { kind: 'lunar', monthDay: '12-23', id: 'xiaonian' },
  { kind: 'break', from: '1-20', to: '2-18', id: 'winter-break' },
  { kind: 'break', from: '7-1', to: '8-29', id: 'summer-break' },
  { kind: 'solar', monthDay: '3-8', id: 'womens-day' },
  { kind: 'solar', monthDay: '9-10', id: 'teachers-day' },
  { kind: 'solar', monthDay: '7-1', id: 'party-founding-day' },
  { kind: 'solar', monthDay: '8-1', id: 'army-day' },
  { kind: 'solar', monthDay: '10-31', id: 'halloween' },
  { kind: 'solar', monthDay: '12-24', id: 'christmas-eve', after: 0 },
  { kind: 'solar', monthDay: '12-25', id: 'christmas' },
]

interface Ranked {
  readonly rule: PetFestivalRule
  readonly priority: number
}

interface Candidate {
  readonly festival: PetFestivalMoment
  readonly priority: number
}

const SOLAR = new Map<string, Ranked>()
const LUNAR = new Map<string, Ranked>()
const BREAKS: (Ranked & { readonly from: string; readonly to: string })[] = []
let LUNAR_EVE: Ranked | undefined
for (const [priority, rule] of PET_FESTIVALS.entries()) {
  switch (rule.kind) {
    case 'solar': SOLAR.set(rule.monthDay, { rule, priority }); break
    case 'lunar': LUNAR.set(rule.monthDay, { rule, priority }); break
    case 'lunar-eve': LUNAR_EVE = { rule, priority }; break
    case 'break': BREAKS.push({ rule, priority, from: rule.from, to: rule.to }); break
  }
}
const DAY_RULES = PET_FESTIVALS.filter(rule => rule.kind !== 'break')
const MAX_AHEAD = Math.max(...DAY_RULES.map(rule => rule.ahead ?? DEFAULT_AHEAD))
const MAX_LOOKBACK = Math.max(...DAY_RULES.map(rule => (rule.span ?? DEFAULT_SPAN) - 1 + (rule.after ?? DEFAULT_AFTER)))

/** Lunar month and day; a leap month is negative (leap sixth month = -6). */
interface LunarParts {
  readonly month: number
  readonly day: number
}

/** `null` once the runtime is known to lack the Chinese calendar. */
let lunarFormatter: Intl.DateTimeFormat | null | undefined

function getLunarFormatter(): Intl.DateTimeFormat | undefined {
  if (lunarFormatter === undefined) {
    const formatter = new Intl.DateTimeFormat('en-u-ca-chinese', { month: 'numeric', day: 'numeric', year: 'numeric' })
    // Intl silently falls back to the Gregorian calendar when `chinese` is missing.
    lunarFormatter = formatter.resolvedOptions().calendar === 'chinese' ? formatter : null
  }
  return lunarFormatter ?? undefined
}

function lunarPartsOf(date: Date): LunarParts | undefined {
  const formatter = getLunarFormatter()
  if (formatter === undefined) return undefined
  const parts = formatter.formatToParts(date)
  const pick = (type: string): string | undefined => parts.find(part => part.type === type)?.value
  const rawMonth = pick('month')
  const rawDay = pick('day')
  const rawYear = pick('relatedYear') ?? pick('year')
  if (rawMonth === undefined || rawDay === undefined || rawYear === undefined) return undefined
  const month = Number.parseInt(rawMonth, 10)
  const day = Number.parseInt(rawDay, 10)
  const year = Number.parseInt(rawYear, 10)
  if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) return undefined
  // A lunar year is the Gregorian year or the one before; anything else is a degraded ICU answer.
  if (year !== date.getFullYear() && year !== date.getFullYear() - 1) return undefined
  return { month: /bis/iu.test(rawMonth) ? -month : month, day }
}

function isLunarEve(date: Date): boolean {
  const today = lunarPartsOf(date)
  if (today?.month !== 12) return false
  const next = lunarPartsOf(new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1))
  return next?.month === 1 && next.day === 1
}

function rulesAt(date: Date): Ranked[] {
  const found: Ranked[] = []
  const solar = SOLAR.get(`${String(date.getMonth() + 1)}-${String(date.getDate())}`)
  if (solar !== undefined) found.push(solar)
  const lunar = lunarPartsOf(date)
  // Leap months never match: the fifth day of a leap fifth month is not the Dragon Boat Festival.
  if (lunar !== undefined && lunar.month > 0) {
    const hit = LUNAR.get(`${String(lunar.month)}-${String(lunar.day)}`)
    if (hit !== undefined) found.push(hit)
  }
  if (LUNAR_EVE !== undefined && isLunarEve(date)) found.push(LUNAR_EVE)
  return found
}

/**
 * @param delta - days from the date to the festival's first day: positive before it, negative after it began.
 */
function dayCandidate({ rule, priority }: Ranked, delta: number): Candidate | undefined {
  const ahead = rule.ahead ?? DEFAULT_AHEAD
  const span = rule.span ?? DEFAULT_SPAN
  const after = rule.after ?? DEFAULT_AFTER
  let phase: PetFestivalPhase
  if (delta > 0) {
    if (delta > ahead) return undefined
    phase = delta === 1 ? 'tomorrow' : 'soon'
  } else if (delta === 0) {
    phase = 'today'
  } else {
    const daysIn = -delta
    if (daysIn >= span + after) return undefined
    if (daysIn < span) phase = span - daysIn === 1 ? 'last-day' : 'during'
    else phase = daysIn - span <= 1 ? 'just-over' : 'over'
  }
  return { festival: { id: rule.id, phase }, priority }
}

function dayOfYear(year: number, month: number, day: number): number {
  return (Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / DAY_MS
}

function monthDayOfYear(year: number, monthDay: string): number {
  const [month = 1, day = 1] = monthDay.split('-').map(Number)
  return dayOfYear(year, month, day)
}

function breakCandidate(date: Date): Candidate | undefined {
  const year = date.getFullYear()
  const today = dayOfYear(year, date.getMonth() + 1, date.getDate())
  for (const { rule, priority, from: fromDay, to: toDay } of BREAKS) {
    const from = monthDayOfYear(year, fromDay)
    const to = monthDayOfYear(year, toDay)
    let phase: PetFestivalPhase
    if (today < from) {
      const ahead = from - today
      if (ahead > BREAK_AHEAD) continue
      phase = ahead === 1 ? 'tomorrow' : 'soon'
    } else if (today <= to) {
      phase = today === from ? 'today' : to - today < BREAK_ENDING ? 'ending' : 'during'
    } else {
      const rest = today - to - 1
      if (rest >= BREAK_AFTER) continue
      phase = rest <= 1 ? 'just-over' : 'over'
    }
    return { festival: { id: rule.id, phase }, priority }
  }
  return undefined
}

/**
 * Highest-priority festival whose window covers a local date.
 * @param date - any time on the date; only its local calendar date is read.
 * @returns the festival and phase, or `undefined` when none applies.
 */
export function petFestivalOf(date: Date): PetFestivalMoment | undefined {
  let best: Candidate | undefined
  const keep = (candidate: Candidate | undefined): void => {
    if (candidate !== undefined && (best === undefined || candidate.priority < best.priority)) best = candidate
  }
  for (let delta = -MAX_LOOKBACK; delta <= MAX_AHEAD; delta++) {
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta)
    for (const ranked of rulesAt(day)) keep(dayCandidate(ranked, delta))
  }
  keep(breakCandidate(date))
  return best?.festival
}

/**
 * Structured local time context of one instant.
 * @param date - the instant; the caller supplies the clock.
 * @returns the moment, or `undefined` for an invalid `Date`.
 */
export function petMomentOf(date: Date): PetMoment | undefined {
  if (Number.isNaN(date.getTime())) return undefined
  const festival = petFestivalOf(date)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return {
    date: `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    slot: petDaySlotOf(date.getHours()),
    dayKind: petDayKindOf(date.getDay()),
    ...festival === undefined ? {} : { festival },
  }
}

/**
 * Next local instant after `now` at which {@link petMomentOf} can change: the
 * next slot start (midnight included, where the date and festival change).
 * @param now - Unix epoch milliseconds.
 * @returns Unix epoch milliseconds of that instant.
 */
export function nextPetMomentChange(now: number): number {
  const date = new Date(now)
  for (const hour of PET_SLOT_START_HOURS) {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour).getTime()
    if (start > now) return start
  }
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
}
