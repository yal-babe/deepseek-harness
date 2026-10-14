/** OAuth Remote delegation preserves bridge results, failures, and stream lifetime. */
import { Context } from '@deepseek-ai/cordis'
import type { OAuthBridge } from '@deepseek-ai/dsh-llm-oauth-bridge'
import { RemoteError, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, expect, it, vi } from 'vitest'
import OAuthController from '../src/index.ts'
import type { OAuthAttemptView } from '../src/types.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })

const idle: OAuthAttemptView = { status: 'idle', inFlight: false, credentialConfigured: false }
const KEY = 'llm-pi-ai/openai-codex'

function fixture() {
  const ctx = new Context()
  roots.push(ctx)
  const provider = {
    getState: vi.fn<OAuthBridge['getState']>().mockResolvedValue(idle),
    start: vi.fn<OAuthBridge['start']>().mockResolvedValue(idle),
    cancel: vi.fn<OAuthBridge['cancel']>().mockResolvedValue(idle),
    signOut: vi.fn<OAuthBridge['signOut']>().mockResolvedValue(idle),
    answerPrompt: vi.fn<OAuthBridge['answerPrompt']>().mockResolvedValue(idle),
    declinePrompt: vi.fn<OAuthBridge['declinePrompt']>().mockResolvedValue(idle),
    watch: vi.fn<OAuthBridge['watch']>(),
  }
  ctx.provide('oauthBridge', provider as never)
  return { ctx, provider, controller: new OAuthController(ctx) }
}

it('delegates OAuth operations without altering their values', async () => {
  const { provider, controller } = fixture()
  expect(await controller.getState(KEY)).toBe(idle)
  expect(await controller.start(KEY, 'oauth')).toBe(idle)
  expect(provider.start).toHaveBeenCalledExactlyOnceWith(KEY, 'oauth')
  expect(await controller.start(KEY)).toBe(idle)
  expect(await controller.cancel(KEY)).toBe(idle)
  expect(provider.cancel).toHaveBeenCalledExactlyOnceWith(KEY)
  expect(await controller.signOut(KEY)).toBe(idle)
  expect(await controller.answerPrompt(KEY, 'code')).toBe(idle)
  expect(provider.answerPrompt).toHaveBeenCalledExactlyOnceWith(KEY, 'code')
  expect(await controller.declinePrompt(KEY)).toBe(idle)
})

it('classifies bridge refusals as oauth/rejected', async () => {
  const { provider, controller } = fixture()
  provider.getState.mockRejectedValueOnce(new TypeError('credential key "openai-codex" must be "<scope>/<id>"'))
  const failure = await controller.getState('openai-codex').catch((error: unknown) => error)
  expect(remoteErrorOf(failure)).toMatchObject({
    code: 'oauth/rejected',
    details: { key: 'openai-codex' },
  })
  const missing = new Error('no authorization prompt is waiting for "llm-pi-ai/openai-codex"')
  provider.answerPrompt.mockRejectedValueOnce(missing)
  const answered = await controller.answerPrompt(KEY, 'x').catch((error: unknown) => error)
  expect(remoteErrorOf(answered)).toMatchObject({ code: 'oauth/rejected', details: { key: KEY } })
  provider.declinePrompt.mockRejectedValueOnce(missing)
  await expect(controller.declinePrompt(KEY)).rejects.toMatchObject({ code: 'oauth/rejected' })
  provider.cancel.mockRejectedValueOnce(missing)
  await expect(controller.cancel(KEY)).rejects.toMatchObject({ code: 'oauth/rejected' })
  provider.signOut.mockRejectedValueOnce(missing)
  await expect(controller.signOut(KEY)).rejects.toMatchObject({ code: 'oauth/rejected' })
  provider.start.mockRejectedValueOnce(missing)
  await expect(controller.start(KEY)).rejects.toMatchObject({ code: 'oauth/rejected' })
  provider.getState.mockRejectedValueOnce('bare refusal')
  await expect(controller.getState(KEY)).rejects.toMatchObject({
    code: 'oauth/rejected',
    message: 'bare refusal',
  })
  const remote = new RemoteError('oauth/rejected', 'already classified', { key: KEY })
  provider.getState.mockRejectedValueOnce(remote)
  await expect(controller.getState(KEY)).rejects.toBe(remote)
})

it('passes the subscriber lifetime to the bridge and returns its state stream', async () => {
  const { provider, controller } = fixture()
  const lifetime = new AbortController()
  const stream: AsyncIterable<OAuthAttemptView> = { async *[Symbol.asyncIterator]() { yield idle } }
  provider.watch.mockReturnValue(stream)
  const received: OAuthAttemptView[] = []
  for await (const value of controller.watch(KEY, lifetime.signal)) received.push(value)
  expect(received).toEqual([idle])
  expect(provider.watch).toHaveBeenCalledExactlyOnceWith(KEY, lifetime.signal)
})

it('classifies a watch failure as oauth/rejected', async () => {
  const { provider, controller } = fixture()
  provider.watch.mockImplementation(() => {
    throw new TypeError('credential key "bad" must be "<scope>/<id>"')
  })
  const failure = await controller.watch('bad', new AbortController().signal)[Symbol.asyncIterator]().next()
    .catch((error: unknown) => error)
  expect(remoteErrorOf(failure)).toMatchObject({
    code: 'oauth/rejected',
    details: { key: 'bad' },
  })
})
