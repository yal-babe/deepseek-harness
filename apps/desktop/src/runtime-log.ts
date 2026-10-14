/**
 * Non-fatal Desktop diagnostics appended under userData/logs, separate from
 * crash reports (which use the platform logs directory on macOS).
 */

import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/** File name for the append-only runtime log. */
export const RUNTIME_LOG_FILE = 'runtime.log'

/**
 * Directory that holds {@link RUNTIME_LOG_FILE} under Electron userData.
 * @param userData - `app.getPath('userData')`.
 * @returns `userData/logs`.
 */
export function runtimeLogDirectory(userData: string): string {
  return join(userData, 'logs')
}

/**
 * Append one ISO-timestamped line. Failures go to `console.error` and are
 * swallowed so callers can fire-and-forget.
 * @param userData - `app.getPath('userData')`.
 * @param line - diagnostic text without a trailing newline.
 */
export async function appendRuntimeLog(userData: string, line: string): Promise<void> {
  const directory = runtimeLogDirectory(userData)
  const path = join(directory, RUNTIME_LOG_FILE)
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await appendFile(path, `${new Date().toISOString()} ${line}\n`, { mode: 0o600 })
  } catch (error) {
    console.error('dsh desktop: runtime log could not be written', path, error)
  }
}
