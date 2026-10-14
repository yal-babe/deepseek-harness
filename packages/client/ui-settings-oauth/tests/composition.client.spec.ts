// @vitest-environment jsdom
/** Codex OAuth mounts in the shipped web composition. */
import { expect } from 'vitest'
import { createClientTest, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import { CodexOauthCard } from '../src/client/CodexOauthCard.tsx'

const it = createClientTest({ roster: webApp })

it('registers Codex and Antigravity OAuth on Models provider cards', async ({ start, mock }) => {
  const c = await start()
  const keys = c.ctx.slots.entries('settings.models.provider-card')
    .filter(row => row.component === CodexOauthCard)
    .map(row => row.options.key)
  expect(keys).toEqual(['llm-pi-ai', 'llm-antigravity'])
  expect(mock.log.streams().some(stream => stream.endpoint === 'oauth/watch')).toBe(true)
}, 60_000)
