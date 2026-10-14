import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { appendRuntimeLog, RUNTIME_LOG_FILE, runtimeLogDirectory } from '../src/runtime-log.ts'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function scratch(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'desktop-runtime-log-'))
  roots.push(root)
  return root
}

it('names the logs directory under userData', () => {
  expect(runtimeLogDirectory('/data')).toBe(join('/data', 'logs'))
})

it('creates userData/logs and appends ISO-timestamped lines', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-14T01:02:03.456Z'))
  const userData = await scratch()
  await appendRuntimeLog(userData, 'startup pid=1')
  await appendRuntimeLog(userData, 'host ready')
  const text = await readFile(join(userData, 'logs', RUNTIME_LOG_FILE), 'utf8')
  expect(text).toBe('2026-10-14T01:02:03.456Z startup pid=1\n2026-10-14T01:02:03.456Z host ready\n')
})

it('logs and swallows the error when the file cannot be written', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const userData = await scratch()
  const blocked = join(userData, 'logs')
  await writeFile(blocked, '')
  await appendRuntimeLog(userData, 'startup')
  expect(error).toHaveBeenCalledWith(
    'dsh desktop: runtime log could not be written',
    join(blocked, RUNTIME_LOG_FILE),
    expect.anything(),
  )
})
