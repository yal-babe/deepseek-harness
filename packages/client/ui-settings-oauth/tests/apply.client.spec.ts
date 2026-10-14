// @vitest-environment jsdom
/** Codex OAuth plugin registers the llm-pi-ai card and drives the oauth Remote. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { OAuthAttemptView } from '@deepseek-ai/dsh-llm-oauth-bridge/types'
import { apply, inject } from '../src/client/index.ts'
import { CodexOauthCard } from '../src/client/CodexOauthCard.tsx'
import type { CodexOauthInjected } from '../src/client/CodexOauthCard.tsx'
import { zh } from '../src/client/locales.ts'

const idle: OAuthAttemptView = { status: 'idle', inFlight: false, credentialConfigured: false }
const waiting: OAuthAttemptView = {
  status: 'waiting-browser',
  inFlight: true,
  credentialConfigured: false,
  authorizeUrl: 'https://auth.example/start',
}

afterEach(() => { vi.unstubAllGlobals() })

it('declares the services it uses', () => {
  expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.oauth'])
})

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const frames: Array<{ value: OAuthAttemptView; accept: () => void }> = []
  const release = Promise.withResolvers<undefined>()
  const oauth = {
    watch: vi.fn((_key: string, signal: AbortSignal) => {
      signal.addEventListener('abort', () => { release.resolve(undefined) }, { once: true })
      return (async function* () {
        yield idle
        await release.promise
      })()
    }),
    start: vi.fn(async () => ({ ok: true as const, value: waiting })),
    cancel: vi.fn(async () => ({ ok: true as const, value: idle })),
    signOut: vi.fn(async () => ({ ok: true as const, value: idle })),
    answerPrompt: vi.fn(async () => ({ ok: true as const, value: idle })),
    declinePrompt: vi.fn(async () => ({ ok: true as const, value: idle })),
  }
  const remote = {
    oauth,
    $stream: ({
      open, ended,
    }: { open: (signal: AbortSignal) => AsyncIterable<OAuthAttemptView>; ended: () => Error }) => {
      ended()
      const abort = new AbortController()
      return {
        dispose: () => { abort.abort(); return Promise.resolve() },
        async *[Symbol.asyncIterator]() {
          for await (const value of open(abort.signal)) {
            const frame = { value, accept: () => undefined }
            frames.push(frame)
            yield frame
          }
        },
      }
    },
  }
  ctx.provide('remote', remote)
  ctx.provide('remote.oauth', oauth)
  ctx.get('slots')!.register({
    name: 'root',
    children: { 'settings.models.provider-card': { kind: 'keyed', scope: 'root' } },
  } as never, () => null)
  return { ctx, oauth, frames, locale }
}

it('registers the keyed card, dictionaries, and Host operations', async () => {
  const { ctx, oauth } = await bench()
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const slots = ctx.get('slots')!
  const entry = slots.entries('settings.models.provider-card')[0]!
  expect(entry.component).toBe(CodexOauthCard)
  expect(entry.options.key).toBe('llm-pi-ai')
  expect(ctx.get('locale')!.bind('settings.oauth')('signIn')).toBe(zh.signIn)
  const entries = slots.entries('settings.models.provider-card')
  expect(entries.map(row => row.options.key)).toEqual(['llm-pi-ai', 'llm-antigravity'])
  const operations = entry.inject!() as object as CodexOauthInjected
  const listener = vi.fn()
  operations.hooks.oauth.subscribe(listener)
  operations.hooks.oauth.getSnapshot()
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  expect(operations.openAuthorizeUrl('https://auth.example/start')).toBe(false)
  expect(open).toHaveBeenCalledExactlyOnceWith('https://auth.example/start', '_blank', 'noopener,noreferrer')
  await operations.start()
  expect(oauth.start).toHaveBeenCalledExactlyOnceWith('llm-pi-ai/openai-codex', 'oauth')
  const antigravity = entries[1]!.inject!() as object as CodexOauthInjected
  await antigravity.start()
  expect(oauth.start).toHaveBeenLastCalledWith('llm-antigravity/default', 'oauth')
  await operations.cancel()
  expect(oauth.cancel).toHaveBeenCalledExactlyOnceWith('llm-pi-ai/openai-codex')
  await operations.signOut()
  expect(oauth.signOut).toHaveBeenCalledExactlyOnceWith('llm-pi-ai/openai-codex')
  await operations.answerPrompt('typed')
  expect(oauth.answerPrompt).toHaveBeenCalledExactlyOnceWith('llm-pi-ai/openai-codex', 'typed')
  await operations.declinePrompt()
  expect(oauth.declinePrompt).toHaveBeenCalledExactlyOnceWith('llm-pi-ai/openai-codex')
  await fiber.dispose()
  expect(slots.entries('settings.models.provider-card')).toHaveLength(0)
  await ctx.fiber.dispose()
})

it('publishes streamed views and failed status when the stream ends unexpectedly', async () => {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const ended = Promise.withResolvers<undefined>()
  const gate = Promise.withResolvers<undefined>()
  const remote = {
    oauth: {
      watch: vi.fn(),
      start: vi.fn(),
      cancel: vi.fn(),
      signOut: vi.fn(),
      answerPrompt: vi.fn(),
      declinePrompt: vi.fn(),
    },
    $stream: ({ ended: endedStream }: { ended: () => Error }) => {
      endedStream()
      return {
        dispose: () => Promise.resolve(),
        async *[Symbol.asyncIterator]() {
          await gate.promise
          yield { value: waiting, accept: () => { ended.resolve(undefined) } }
          throw new Error('oauth stream ended')
        },
      }
    },
  }
  ctx.provide('remote', remote)
  ctx.provide('remote.oauth', remote.oauth)
  ctx.get('slots')!.register({
    name: 'root',
    children: { 'settings.models.provider-card': { kind: 'keyed', scope: 'root' } },
  } as never, () => null)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const operations = ctx.get('slots')!.entries('settings.models.provider-card')[0]!.inject!() as object as CodexOauthInjected
  const listener = vi.fn()
  const unsubscribe = operations.hooks.oauth.subscribe(listener)
  gate.resolve(undefined)
  await ended.promise
  expect(listener).toHaveBeenCalled()
  await expect.poll(() => operations.hooks.oauth.getSnapshot().status).toBe('failed')
  unsubscribe()
  await fiber.dispose()
  await ctx.fiber.dispose()
})

it('ignores a stream failure after the plugin is disposed', async () => {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const late = Promise.withResolvers<undefined>()
  const remote = {
    oauth: { watch: vi.fn(), start: vi.fn(), cancel: vi.fn(), signOut: vi.fn(), answerPrompt: vi.fn(), declinePrompt: vi.fn() },
    $stream: ({ ended }: { ended: () => Error }) => {
      ended()
      return {
        dispose: () => Promise.resolve(),
        async *[Symbol.asyncIterator]() {
          yield { value: idle, accept: () => undefined }
          await late.promise
          throw new Error('oauth stream ended')
        },
      }
    },
  }
  ctx.provide('remote', remote)
  ctx.provide('remote.oauth', remote.oauth)
  ctx.get('slots')!.register({
    name: 'root',
    children: { 'settings.models.provider-card': { kind: 'keyed', scope: 'root' } },
  } as never, () => null)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  await fiber.dispose()
  late.resolve(undefined)
  await Promise.resolve()
  await ctx.fiber.dispose()
})

it('throws when a Remote command is refused', async () => {
  const { ctx } = await bench()
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const operations = ctx.get('slots')!.entries('settings.models.provider-card')[0]!.inject!() as object as CodexOauthInjected
  const error = new Error('oauth/rejected')
  const oauth = ctx.get('remote.oauth') as {
    start: ReturnType<typeof vi.fn>
    cancel: ReturnType<typeof vi.fn>
    signOut: ReturnType<typeof vi.fn>
    answerPrompt: ReturnType<typeof vi.fn>
    declinePrompt: ReturnType<typeof vi.fn>
  }
  oauth.start.mockResolvedValueOnce({ ok: false, error })
  await expect(operations.start()).rejects.toBe(error)
  oauth.cancel.mockResolvedValueOnce({ ok: false, error })
  await expect(operations.cancel()).rejects.toBe(error)
  oauth.signOut.mockResolvedValueOnce({ ok: false, error })
  await expect(operations.signOut()).rejects.toBe(error)
  oauth.answerPrompt.mockResolvedValueOnce({ ok: false, error })
  await expect(operations.answerPrompt('x')).rejects.toBe(error)
  oauth.declinePrompt.mockResolvedValueOnce({ ok: false, error })
  await expect(operations.declinePrompt()).rejects.toBe(error)
  await fiber.dispose()
  await ctx.fiber.dispose()
})
