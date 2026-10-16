import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatGmt8 } from '../src/client/formatGmt8.ts'

afterEach(() => { vi.restoreAllMocks() })

describe('formatGmt8', () => {
  it('formats an instant in Asia/Shanghai without a timezone suffix', () => {
    expect(formatGmt8(Date.parse('2026-10-16T08:00:00.000Z'))).toBe('2026-10-16 16:00')
  })

  it('uses empty fields when the formatter omits a part', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function DateTimeFormatMock() {
      return { formatToParts: () => [] } as unknown as Intl.DateTimeFormat
    })
    expect(formatGmt8(0)).toBe('-- :')
  })
})
