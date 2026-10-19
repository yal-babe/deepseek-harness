/** Device-local update directory; never sent to the cloud account service. */
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'

/** Normalize the generic electron-updater directory, or clear the override.
 * @param value - user-entered HTTP(S) directory.
 * @returns a canonical URL, or undefined for a blank value.
 */
export function normalizeStudioUpdateUrl(value: string): string | undefined {
  if (!value.trim()) return undefined
  const url = new URL(value.trim())
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Update source must be an HTTP(S) directory without credentials, query or fragment')
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url.href
}

/** @param directory - Electron userData directory. @returns saved update URL, if configured. */
export function readStudioUpdateUrl(directory: string): string | undefined {
  try {
    const data: unknown = JSON.parse(readFileSync(join(directory, 'desktop', 'update-source.json'), 'utf8'))
    if (typeof data !== 'object' || data === null || !('url' in data) || typeof data.url !== 'string') return undefined
    return normalizeStudioUpdateUrl(data.url)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) console.warn('Studio update source could not be loaded')
    return undefined
  }
}

/** @param directory - Electron userData. @param value - a validated update directory or blank. */
export function saveStudioUpdateUrl(directory: string, value: string): void {
  const url = normalizeStudioUpdateUrl(value)
  const target = join(directory, 'desktop')
  mkdirSync(target, { recursive: true, mode: 0o700 })
  const filename = join(target, 'update-source.json')
  writeFileSync(`${filename}.tmp`, JSON.stringify({ url: url ?? '' }) + '\n', { mode: 0o600 })
  renameSync(`${filename}.tmp`, filename)
}
