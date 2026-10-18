import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePetLines, petMomentTriggers, pickPetLine, type PetLineTable } from '../src/lines.ts'
import { PET_FESTIVALS, PET_SLOT_START_HOURS, petDaySlotOf, petMomentOf } from '../src/time-context.ts'

const BUILTIN = join(import.meta.dirname, '..', 'packs', 'whaletail-maid', 'lines.json')

function builtin(): PetLineTable {
  const result = parsePetLines(JSON.parse(readFileSync(BUILTIN, 'utf8')))
  if (!result.ok) throw new Error(result.errors.join('; '))
  return result.table
}

describe('parsePetLines', () => {
  it('accepts the built-in table', () => {
    expect(builtin().formatVersion).toBe(2)
  })

  it('reports every malformed trigger and line at once', () => {
    const result = parsePetLines({
      formatVersion: 1,
      lines: { 'Bad Key': [{ zh: 'a', en: 'a' }], empty: [], 'turn.success': [{ zh: '', en: 'x' }, { zh: 'a', en: 'b', extra: 1 }] },
    })
    expect(result.ok).toBe(false)
    expect(result.ok ? [] : result.errors).toHaveLength(5)
    expect(parsePetLines(null)).toEqual({ ok: false, errors: ['lines.json must be an object'] })
  })
})

describe('petMomentTriggers', () => {
  it('orders festival phase, festival day, and greeting keys', () => {
    expect(petMomentTriggers({ date: '2026-10-01', slot: 'noon', dayKind: 'workday', festival: { id: 'national-day', phase: 'today' } }))
      .toEqual(['festival.national-day.today', 'festival.national-day', 'greet.noon'])
    expect(petMomentTriggers({ date: '2026-09-29', slot: 'evening', dayKind: 'workday', festival: { id: 'national-day', phase: 'soon' } }))
      .toEqual(['festival.national-day.soon', 'greet.evening'])
    expect(petMomentTriggers({ date: '2026-05-12', slot: 'dusk', dayKind: 'workday' })).toEqual(['greet.dusk'])
  })
})

describe('pickPetLine', () => {
  const table: PetLineTable = {
    formatVersion: 2,
    lines: { 'greet.noon': [{ zh: '一', en: 'one' }, { zh: '二', en: 'two' }], 'festival.qixi': [{ zh: '七夕', en: 'qixi' }] },
  }

  it('uses the first trigger that has lines and the supplied random source', () => {
    expect(pickPetLine(table, ['festival.qixi.today', 'festival.qixi', 'greet.noon'], () => 0.9))
      .toEqual({ trigger: 'festival.qixi', line: { zh: '七夕', en: 'qixi' } })
    expect(pickPetLine(table, ['greet.noon'], () => 0.99)?.line.en).toBe('two')
    expect(pickPetLine(table, ['greet.dawn'], () => 0)).toBeUndefined()
  })

  it('avoids repeating the previous line when the trigger has another', () => {
    expect(pickPetLine(table, ['greet.noon'], () => 0, { zh: '一', en: 'one' })?.line.en).toBe('two')
    expect(pickPetLine(table, ['festival.qixi'], () => 0, { zh: '七夕', en: 'qixi' })?.line.en).toBe('qixi')
  })
})

describe('built-in lines', () => {
  it('greets in every time-of-day slot and speaks on every festival day', () => {
    const lines = builtin().lines
    for (const hour of PET_SLOT_START_HOURS) expect(lines[`greet.${petDaySlotOf(hour)}`], petDaySlotOf(hour)).toBeDefined()
    for (const rule of PET_FESTIVALS) expect(lines[`festival.${rule.id}`], rule.id).toBeDefined()
  })

  it('picks a festival line on the Lunar New Year and a greeting on an ordinary afternoon', () => {
    const table = builtin()
    const newYear = petMomentOf(new Date(2026, 1, 17, 9, 30))!
    expect(pickPetLine(table, petMomentTriggers(newYear), () => 0)?.trigger).toBe('festival.spring-festival.today')
    const ordinary = petMomentOf(new Date(2026, 4, 12, 15, 4))!
    expect(pickPetLine(table, petMomentTriggers(ordinary), () => 0)?.trigger).toBe('greet.afternoon')
  })
})
