/** Format an instant in Asia/Shanghai without a timezone suffix. */

/**
 * Format milliseconds as `YYYY-MM-DD HH:mm` in Asia/Shanghai.
 * @param ms - epoch milliseconds.
 */
export function formatGmt8(ms: number): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms))
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find(part => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')} ${value('hour')}:${value('minute')}`
}
