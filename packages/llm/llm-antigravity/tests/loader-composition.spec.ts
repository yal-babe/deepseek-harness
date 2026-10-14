/** Boot the adapter through a real Loader composition. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader, { type ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { profileComposition } from '../../../settings/settings/tests/profile-composition.ts'
import * as Antigravity from '@deepseek-ai/dsh-llm-antigravity'
import { PROVIDER } from '../src/config.ts'
import { assemble } from './assemble.ts'
import { assistProject, closeMockServers, mockServer, textEvents } from './mock-server.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  await closeMockServers()
  vi.unstubAllEnvs()
})

async function loadComposition(baseURL: string): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-ag-composition-'))
  await writeFile(join(root, '.credentials.yaml'), 'version: 1\nrefs:\n  ANTIGRAVITY_API_KEY: composition-key\n', { mode: 0o600 })
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: llm',
    "  name: 'test-llm-service'",
    '- id: credentials',
    "  name: '@deepseek-ai/dsh-credentials-local'",
    '  config:',
    `    path: ${JSON.stringify(join(root, '.credentials.yaml'))}`,
    '    debounceMs: 10',
    '- id: authorization',
    "  name: '@deepseek-ai/dsh-authorization'",
    '- id: llm-antigravity',
    "  name: '@deepseek-ai/dsh-llm-antigravity'",
    '  config:',
    `    baseURL: ${JSON.stringify(baseURL)}`,
    '    models:',
    '      - id: gemini-flash',
    '',
  ].join('\n'))
  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['test-llm-service', LlmRuntime],
    ['@deepseek-ai/dsh-credentials-local', LocalCredentialProvider],
    ['@deepseek-ai/dsh-authorization', AuthorizationService],
    ['@deepseek-ai/dsh-llm-antigravity', Antigravity],
  ])
  const internal: ModuleLoaderV2 = {
    version: 'v2',
    loadCache: new Map(),
    import: (specifier: string) => {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return Promise.resolve(modules.get(specifier))
    },
    register(): never { throw new Error('unexpected module hook registration') },
    getOrCreateModuleJob(): never { throw new Error('unexpected module job creation') },
    resolveSync(): never { throw new Error('unexpected synchronous module resolution') },
    load(): never { throw new Error('unexpected module load') },
  }
  ctx.loader.internal = internal
  await profileComposition(ctx, root, configPath)
  return ctx
}

describe('llm-antigravity real composition', () => {
  it('boots the antigravity route and streams a Cloud Code request', async () => {
    vi.stubEnv('ANTIGRAVITY_API_KEY', '')
    const server = await mockServer([assistProject, { events: textEvents }])
    const ctx = await loadComposition(server.url)
    expect(ctx.llm.listProviders()).toEqual([{ id: PROVIDER, name: 'Antigravity' }])
    expect(ctx.authorization.list()).toEqual([expect.objectContaining({
      key: 'llm-antigravity/default',
      label: 'Antigravity',
      methods: [{ id: 'oauth', label: 'Google' }],
    })])
    const result = await assemble(ctx, { model: 'gemini-flash', messages: [] })
    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(server.headers[0]?.authorization).toBe('Bearer composition-key')
  })
})
