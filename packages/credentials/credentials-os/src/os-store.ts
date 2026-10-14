/**
 * Secret backends for the OS credentials provider: an in-memory store for
 * tests, and a subprocess store that talks to macOS Keychain or Windows DPAPI.
 * @module @deepseek-ai/dsh-credentials-os/os-store
 */

import { execFile } from 'node:child_process'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Run one executable as UTF-8 text. Uses the callback form so a test mock of
 * `execFile` does not need Node's promisify.custom `{ stdout, stderr }` result.
 * @param file - executable path or PATH name.
 * @param args - argv after the executable.
 * @returns stdout with a trailing newline still attached, as the tool wrote it.
 */
function execFileUtf8(file: string, args: readonly string[]): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { encoding: 'utf8' }, (error, stdout) => {
      if (error !== null) {
        reject(error)
        return
      }
      resolve({ stdout: stdout === undefined ? '' : stdout })
    })
  })
}

/** Durable secret account under one OS service name. */
export interface OsSecretStore {
  /**
   * Read one secret.
   * @param account - account name within the service.
   * @returns the secret, or undefined when absent.
   */
  get(account: string): Promise<string | undefined>
  /**
   * Write or replace one secret.
   * @param account - account name within the service.
   * @param secret - non-empty secret value.
   */
  set(account: string, secret: string): Promise<void>
  /**
   * Remove one secret when present.
   * @param account - account name within the service.
   */
  delete(account: string): Promise<void>
}

/** In-memory store for unit tests; never talks to the OS. */
export class MemoryOsSecretStore implements OsSecretStore {
  private readonly values = new Map<string, string>()

  /** @inheritdoc */
  async get(account: string): Promise<string | undefined> {
    return this.values.get(account)
  }

  /** @inheritdoc */
  async set(account: string, secret: string): Promise<void> {
    this.values.set(account, secret)
  }

  /** @inheritdoc */
  async delete(account: string): Promise<void> {
    this.values.delete(account)
  }
}

/**
 * Build the default OS-backed store for the current platform.
 * @param service - keychain / credential-manager service name.
 * @returns a store that shells out to platform tools.
 */
export function createPlatformOsSecretStore(service: string): OsSecretStore {
  if (process.platform === 'darwin') return new MacOsKeychainStore(service)
  if (process.platform === 'win32') return new WindowsDpapiStore(service)
  return new MemoryOsSecretStore()
}

/** macOS Keychain via the `security` CLI. */
class MacOsKeychainStore implements OsSecretStore {
  constructor(private readonly service: string) {}

  /** @inheritdoc */
  async get(account: string): Promise<string | undefined> {
    try {
      const { stdout } = await execFileUtf8('security', [
        'find-generic-password', '-s', this.service, '-a', account, '-w',
      ])
      const value = stdout.replace(/\n$/u, '')
      return value.length === 0 ? undefined : value
    } catch (error: unknown) {
      if (isMissingSecret(error)) return undefined
      throw error
    }
  }

  /** @inheritdoc */
  async set(account: string, secret: string): Promise<void> {
    await execFileUtf8('security', [
      'add-generic-password', '-U', '-s', this.service, '-a', account, '-w', secret,
    ])
  }

  /** @inheritdoc */
  async delete(account: string): Promise<void> {
    try {
      await execFileUtf8('security', [
        'delete-generic-password', '-s', this.service, '-a', account,
      ])
    } catch (error: unknown) {
      if (isMissingSecret(error)) return
      throw error
    }
  }
}

/**
 * Windows Credential Manager stand-in: DPAPI-protected files under LocalAppData.
 * Keeps secrets out of the harness YAML and bound to the signed-in Windows user.
 */
class WindowsDpapiStore implements OsSecretStore {
  private readonly root: string

  constructor(service: string) {
    this.root = join(homedir(), 'AppData', 'Local', 'dsh-studio-creds', sanitize(service))
  }

  private pathFor(account: string): string {
    return join(this.root, `${sanitize(account)}.bin`)
  }

  /** @inheritdoc */
  async get(account: string): Promise<string | undefined> {
    const path = this.pathFor(account)
    let encoded: string
    try {
      encoded = await readFile(path, 'utf8')
    } catch (error: unknown) {
      if (isENOENT(error)) return undefined
      throw error
    }
    const script = [
      'Add-Type -AssemblyName System.Security',
      `$b = [Convert]::FromBase64String(${JSON.stringify(encoded)})`,
      '$p = [System.Security.Cryptography.ProtectedData]::Unprotect($b, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
      '[Text.Encoding]::UTF8.GetString($p)',
    ].join('; ')
    const { stdout } = await execFileUtf8('powershell.exe', ['-NoProfile', '-Command', script])
    const value = stdout.replace(/\r?\n$/u, '')
    return value.length === 0 ? undefined : value
  }

  /** @inheritdoc */
  async set(account: string, secret: string): Promise<void> {
    await mkdir(this.root, { recursive: true })
    const script = [
      'Add-Type -AssemblyName System.Security',
      `$p = [System.Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes(${JSON.stringify(secret)}), $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)`,
      '[Convert]::ToBase64String($p)',
    ].join('; ')
    const { stdout } = await execFileUtf8('powershell.exe', ['-NoProfile', '-Command', script])
    await writeFile(this.pathFor(account), stdout.replace(/\r?\n$/u, ''), { mode: 0o600 })
  }

  /** @inheritdoc */
  async delete(account: string): Promise<void> {
    try {
      await unlink(this.pathFor(account))
    } catch (error: unknown) {
      if (isENOENT(error)) return
      throw error
    }
  }
}

/** Path-safe fragment for service and account names. */
function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/gu, '_')
}

/** Whether a platform tool reported that the secret is absent. */
function isMissingSecret(error: unknown): boolean {
  if (error instanceof Error) {
    return /could not be found|cannot find|not found|No such|does not exist/iu.test(error.message)
  }
  return /could not be found|cannot find|not found|No such|does not exist/iu.test(String(error))
}

/** Whether a filesystem error means absence. */
function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}
