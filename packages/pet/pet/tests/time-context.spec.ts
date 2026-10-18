// Cases adapted from PC2005-cloud/dsh-pet (MIT), commit 091b27b, dsh-pet/src/host/time-context.test.ts.
// Dates use local-time constructors, matching the local fields the module reads,
// so expectations do not depend on the time zone of the test machine.
import { describe, expect, it } from 'vitest'
import {
  nextPetMomentChange, petDayKindOf, petDaySlotOf, petFestivalOf, petMomentOf,
  type PetDaySlot, type PetFestivalId, type PetFestivalPhase,
} from '../src/time-context.ts'

const BY_HOUR: PetDaySlot[] = [
  'small-hours', 'small-hours', 'small-hours', 'small-hours', 'small-hours', 'dawn', 'dawn', 'morning', 'morning',
  'forenoon', 'forenoon', 'noon', 'noon', 'afternoon', 'afternoon', 'afternoon', 'afternoon', 'dusk', 'dusk',
  'evening', 'evening', 'evening', 'evening', 'late-night',
]

function on(year: number, month: number, day: number, hour = 10): Date {
  return new Date(year, month - 1, day, hour, 0)
}

function expectFestival(date: Date, id: PetFestivalId, phase: PetFestivalPhase): void {
  expect(petFestivalOf(date), date.toDateString()).toEqual({ id, phase })
}

describe('petDaySlotOf', () => {
  it('maps every hour to its slot and clamps odd input', () => {
    expect(Array.from({ length: 24 }, (_, hour) => petDaySlotOf(hour))).toEqual(BY_HOUR)
    expect(petDaySlotOf(-1)).toBe('small-hours')
    expect(petDaySlotOf(Number.NaN)).toBe('small-hours')
    expect(petDaySlotOf(24)).toBe('late-night')
  })

  it('keeps minute boundaries inside the slot', () => {
    expect(petMomentOf(new Date(2026, 4, 12, 4, 59))?.slot).toBe('small-hours')
    expect(petMomentOf(new Date(2026, 4, 12, 5, 0))?.slot).toBe('dawn')
    expect(petMomentOf(new Date(2026, 4, 12, 22, 59))?.slot).toBe('evening')
    expect(petMomentOf(new Date(2026, 4, 12, 23, 0))?.slot).toBe('late-night')
  })
})

describe('petMomentOf', () => {
  it('reports the local date, slot, and day kind without a festival on an ordinary day', () => {
    expect(petMomentOf(new Date(2026, 4, 12, 15, 4))).toEqual({ date: '2026-05-12', slot: 'afternoon', dayKind: 'workday' })
    expect(petMomentOf(new Date(2026, 4, 9, 23, 59))).toEqual({ date: '2026-05-09', slot: 'late-night', dayKind: 'weekend' })
    expect(petMomentOf(new Date(2026, 4, 10, 5, 0))?.dayKind).toBe('weekend')
    expect([0, 1, 2, 3, 4, 5, 6].map(petDayKindOf)).toEqual(['weekend', 'workday', 'workday', 'workday', 'workday', 'workday', 'weekend'])
  })

  it('includes the festival and rejects an invalid date', () => {
    expect(petMomentOf(on(2026, 10, 1, 12))).toEqual({
      date: '2026-10-01', slot: 'noon', dayKind: 'workday', festival: { id: 'national-day', phase: 'today' },
    })
    expect(petMomentOf(new Date('not a date'))).toBeUndefined()
  })
})

describe('nextPetMomentChange', () => {
  it('returns the next slot start, or the next midnight after the last slot', () => {
    expect(nextPetMomentChange(new Date(2026, 4, 12, 15, 4).getTime())).toBe(new Date(2026, 4, 12, 17).getTime())
    expect(nextPetMomentChange(new Date(2026, 4, 12, 17).getTime())).toBe(new Date(2026, 4, 12, 19).getTime())
    expect(nextPetMomentChange(new Date(2026, 4, 12, 23, 30).getTime())).toBe(new Date(2026, 4, 13).getTime())
  })
})

describe('petFestivalOf — single-day festivals', () => {
  it('reads the day, the days around it, and nothing outside the window', () => {
    expectFestival(on(2026, 10, 1), 'national-day', 'today')
    expectFestival(on(2026, 1, 1), 'new-year', 'today')
    expectFestival(on(2025, 12, 31), 'new-years-eve', 'today')
    expectFestival(on(2025, 12, 24), 'christmas-eve', 'today')
    expectFestival(on(2025, 12, 25), 'christmas', 'today')
    expectFestival(on(2026, 5, 29), 'childrens-day', 'soon')
    expectFestival(on(2026, 5, 30), 'childrens-day', 'soon')
    expectFestival(on(2026, 5, 31), 'childrens-day', 'tomorrow')
    expectFestival(on(2026, 6, 2), 'childrens-day', 'just-over')
    expectFestival(on(2026, 6, 3), 'childrens-day', 'just-over')
    expectFestival(on(2026, 6, 4), 'childrens-day', 'over')
    expect(petFestivalOf(on(2026, 5, 28))).toBeUndefined()
    expect(petFestivalOf(on(2026, 6, 5))).toBeUndefined()
  })
})

describe('petFestivalOf — multi-day holidays', () => {
  it('splits a long holiday into its first day, middle, last day, and afterglow', () => {
    expectFestival(on(2026, 10, 5), 'national-day', 'during')
    expectFestival(on(2026, 10, 7), 'national-day', 'last-day')
    expectFestival(on(2026, 10, 8), 'national-day', 'just-over')
    expectFestival(on(2026, 10, 10), 'national-day', 'over')
    expect(petFestivalOf(on(2026, 10, 11))).toBeUndefined()
    expectFestival(on(2026, 1, 2), 'new-year', 'during')
    expectFestival(on(2026, 1, 3), 'new-year', 'last-day')
    expectFestival(on(2026, 1, 4), 'new-year', 'just-over')
  })

  it('lets Qingming, Labor Day, and Youth Day share early April and May', () => {
    expect(petFestivalOf(on(2026, 4, 2))).toBeUndefined()
    expectFestival(on(2026, 4, 3), 'qingming', 'tomorrow')
    expectFestival(on(2026, 4, 4), 'qingming', 'today')
    expectFestival(on(2026, 4, 6), 'qingming', 'last-day')
    expectFestival(on(2026, 4, 7), 'qingming', 'just-over')
    expectFestival(on(2026, 5, 1), 'labor-day', 'today')
    expectFestival(on(2026, 5, 3), 'labor-day', 'last-day')
    expectFestival(on(2026, 5, 4), 'youth-day', 'today')
    expectFestival(on(2026, 5, 5), 'labor-day', 'just-over')
  })

  it('keeps Mid-Autumn ahead of National Day and limits its afterglow to two days', () => {
    expectFestival(on(2026, 9, 25), 'mid-autumn', 'today')
    expectFestival(on(2026, 9, 26), 'mid-autumn', 'during')
    expectFestival(on(2026, 9, 27), 'mid-autumn', 'last-day')
    expectFestival(on(2026, 9, 28), 'mid-autumn', 'just-over')
    expectFestival(on(2026, 9, 30), 'national-day', 'tomorrow')
    expectFestival(on(2027, 9, 17), 'mid-autumn', 'last-day')
    expectFestival(on(2027, 9, 19), 'mid-autumn', 'just-over')
    expect(petFestivalOf(on(2027, 9, 20))).toBeUndefined()
  })

  it('covers the fifteen days of the Spring Festival and gives the Lantern Festival its own days', () => {
    expectFestival(on(2026, 2, 17), 'spring-festival', 'today')
    expectFestival(on(2026, 2, 20), 'spring-festival', 'during')
    expectFestival(on(2026, 3, 2), 'lantern-festival', 'tomorrow')
    expectFestival(on(2026, 3, 3), 'lantern-festival', 'today')
    expectFestival(on(2026, 3, 4), 'lantern-festival', 'just-over')
    expectFestival(on(2026, 3, 5), 'lantern-festival', 'just-over')
    expectFestival(on(2026, 3, 7), 'womens-day', 'tomorrow')
  })
})

describe('petFestivalOf — lunar dates', () => {
  it('finds the Spring Festival Eve on the last day of the twelfth month', () => {
    expectFestival(on(2026, 2, 16, 12), 'spring-festival-eve', 'today')
    expectFestival(on(2026, 2, 15, 12), 'spring-festival-eve', 'tomorrow')
    expectFestival(on(2026, 2, 14, 12), 'valentines-day', 'today')
  })

  it('finds the lunar festivals and ignores leap months', () => {
    expectFestival(on(2026, 6, 19, 12), 'dragon-boat', 'today')
    expectFestival(on(2026, 6, 21, 12), 'dragon-boat', 'last-day')
    expectFestival(on(2026, 1, 26, 12), 'laba', 'today')
    expectFestival(on(2026, 8, 19, 12), 'qixi', 'today')
    expectFestival(on(2028, 5, 28, 12), 'dragon-boat', 'today')
    expect(petFestivalOf(on(2028, 6, 27, 12))).toBeUndefined()
  })
})

describe('petFestivalOf — school breaks', () => {
  it('reads the winter break before, at the start, inside, near the end, and after', () => {
    expectFestival(on(2026, 1, 17), 'winter-break', 'soon')
    expectFestival(on(2026, 1, 19), 'winter-break', 'tomorrow')
    expectFestival(on(2026, 1, 20), 'winter-break', 'today')
    expectFestival(on(2026, 2, 5), 'winter-break', 'during')
    expectFestival(on(2028, 2, 18), 'winter-break', 'ending')
    expectFestival(on(2028, 2, 19), 'winter-break', 'just-over')
    expectFestival(on(2028, 2, 21), 'winter-break', 'over')
    expect(petFestivalOf(on(2028, 2, 22))).toBeUndefined()
  })

  it('reads the summer break and lets traditional festivals speak inside it', () => {
    expectFestival(on(2026, 6, 28), 'summer-break', 'soon')
    expectFestival(on(2026, 6, 30), 'summer-break', 'tomorrow')
    expectFestival(on(2026, 7, 1), 'summer-break', 'today')
    expectFestival(on(2026, 7, 15), 'summer-break', 'during')
    expectFestival(on(2026, 8, 27), 'zhongyuan', 'today')
    expectFestival(on(2026, 8, 28), 'zhongyuan', 'just-over')
    expectFestival(on(2026, 8, 31), 'summer-break', 'just-over')
    expectFestival(on(2026, 9, 1), 'summer-break', 'over')
    expect(petFestivalOf(on(2026, 9, 2))).toBeUndefined()
  })
})

describe('petFestivalOf — priority order', () => {
  it('lets the earlier rule win a shared day', () => {
    expectFestival(on(2026, 4, 1, 12), 'april-fools', 'today')
    expectFestival(on(2026, 2, 18, 12), 'spring-festival', 'during')
    expectFestival(on(2026, 8, 19, 12), 'qixi', 'today')
    expectFestival(on(2026, 7, 1, 12), 'summer-break', 'today')
  })
})
