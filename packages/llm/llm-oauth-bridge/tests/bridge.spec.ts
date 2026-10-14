/** UI-driven authorization attempts buffer notices, prompts, and settlement. */
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService, {
  type AuthorizationFlow,
  type AuthorizationSession,
} from '@deepseek-ai/dsh-authorization'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import OAuthBridge from '../src/index.ts'
import { MemoryCredentials } from './memory.ts'

const KEY = credentialKey('llm-pi-ai', 'openai-codex')
const KEY_TEXT = 'llm-pi-ai/openai-codex'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })

async function harness() {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(MemoryCredentials)
  await ctx.plugin(AuthorizationService)
  await ctx.plugin(OAuthBridge)
  return ctx
}

function flow(
  run: (session: AuthorizationSession) => Promise<void>,
): AuthorizationFlow {
  return {
    key: KEY,
    label: 'ChatGPT (Codex)',
    methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }, { id: 'api-key', label: 'Paste a key' }],
    async run(session) {
      await run(session)
      await session.commit({ kind: 'grant', payload: { token: 'granted' } })
    },
  }
}

it('starts idle with no stored credential', async () => {
  const ctx = await harness()
  await expect(ctx.oauthBridge.getState(KEY_TEXT)).resolves.toEqual({
    status: 'idle', inFlight: false, credentialConfigured: false,
  })
})

it('refuses a key that is not <scope>/<id>', async () => {
  const ctx = await harness()
  await expect(ctx.oauthBridge.getState('openai-codex')).rejects.toThrow(/must be "<scope>\/<id>"/)
})

it('buffers a URL notice as waiting-browser and opens one attempt per key', async () => {
  const ctx = await harness()
  let release: (() => void) | undefined
  ctx.authorization.registerFlow(flow( session => new Promise((resolve) => {
    session.notify({ message: 'Continue in your browser', url: 'https://auth.example/start' })
    release = resolve
  })))

  const first = await ctx.oauthBridge.start(KEY_TEXT, 'oauth')
  expect(first).toMatchObject({ status: 'waiting-browser', inFlight: true })
  const second = await ctx.oauthBridge.start(KEY_TEXT)
  expect(second.inFlight).toBe(true)

  await expect.poll(async () => await ctx.oauthBridge.getState(KEY_TEXT)).toMatchObject({
    status: 'waiting-browser',
    authorizeUrl: 'https://auth.example/start',
    message: 'Continue in your browser',
    inFlight: true,
    credentialConfigured: false,
  })

  release?.()
  await expect.poll(async () => await ctx.oauthBridge.getState(KEY_TEXT)).toMatchObject({
    status: 'authorized',
    inFlight: false,
    credentialConfigured: true,
  })
})

it('sets prompting, answers, and declines prompts', async () => {
  const ctx = await harness()
  const answered: string[] = []
  ctx.authorization.registerFlow(flow( async (session) => {
    session.notify({ message: 'Signing in' })
    answered.push(await session.prompt({ kind: 'text', message: 'Paste the code', placeholder: 'code' }))
    try {
      await session.prompt({ kind: 'secret', message: 'Secret' })
    } catch {
      answered.push('declined')
    }
    answered.push(await session.prompt({
      kind: 'select',
      message: 'Account',
      options: [
        { id: 'work', label: 'Work', description: 'Work profile' },
        { id: 'personal', label: 'Personal' },
      ],
    }))
  }))

  await ctx.oauthBridge.start(KEY_TEXT)
  await expect.poll(async () => await ctx.oauthBridge.getState(KEY_TEXT)).toMatchObject({
    status: 'prompting',
    prompt: { kind: 'text', message: 'Paste the code', placeholder: 'code' },
  })
  await ctx.oauthBridge.answerPrompt(KEY_TEXT, 'typed-code')

  await expect.poll(async () => await ctx.oauthBridge.getState(KEY_TEXT)).toMatchObject({
    status: 'prompting',
    prompt: { kind: 'secret', message: 'Secret' },
  })
  await ctx.oauthBridge.declinePrompt(KEY_TEXT)

  await expect.poll(async () => await ctx.oauthBridge.getState(KEY_TEXT)).toMatchObject({
    status: 'prompting',
    prompt: { kind: 'select', message: 'Account' },
  })
  await ctx.oauthBridge.answerPrompt(KEY_TEXT, 'work')

  await expect.poll(async () => await ctx.oauthBridge.getState(KEY_TEXT)).toMatchObject({
    status: 'authorized',
    credentialConfigured: true,
  })
  expect(answered).toEqual(['typed-code', 'declined', 'work'])
})

it('returns to waiting-browser after a prompt that followed a URL', async () => {
  const ctx = await harness()
  let release: (() => void) | undefined
  ctx.authorization.registerFlow(flow( async (session) => {
    session.notify({ message: 'Open this page', url: 'https://auth.example/start' })
    await session.prompt({ kind: 'text', message: 'Code' })
    await new Promise<void>((resolve) => { release = resolve })
  }))
  await ctx.oauthBridge.start(KEY_TEXT)
  await expect.poll(async () => await ctx.oauthBridge.getState(KEY_TEXT)).toMatchObject({
    status: 'prompting', authorizeUrl: 'https://auth.example/start',
  })
  await ctx.oauthBridge.answerPrompt(KEY_TEXT, 'typed')
  await expect.poll(async () => await ctx.oauthBridge.getState(KEY_TEXT)).toMatchObject({
    status: 'waiting-browser', authorizeUrl: 'https://auth.example/start',
  })
  release?.()
  await expect.poll(async () => await ctx.oauthBridge.getState(KEY_TEXT)).toMatchObject({
    status: 'authorized',
  })
})

it('rejects answering or declining when no prompt is waiting', async () => {
  const ctx = await harness()
  await expect(ctx.oauthBridge.answerPrompt(KEY_TEXT, 'x')).rejects.toThrow(/no authorization prompt/)
  await expect(ctx.oauthBridge.declinePrompt(KEY_TEXT)).rejects.toThrow(/no authorization prompt/)
})

it('cancel on an idle key is a no-op snapshot', async () => {
  const ctx = await harness()
  await expect(ctx.oauthBridge.cancel(KEY_TEXT)).resolves.toEqual({
    status: 'idle', inFlight: false, credentialConfigured: false,
  })
})

it('cancels a waiting-browser attempt', async () => {
  const ctx = await harness()
  ctx.authorization.registerFlow(flow( session => new Promise((_resolve, reject) => {
    session.notify({ message: 'Open this page', url: 'https://auth.example/start', code: 'WXYZ' })
    session.signal.addEventListener('abort', () => { reject(new Error('withdrawn')) }, { once: true })
  })))

  await ctx.oauthBridge.start(KEY_TEXT)
  await expect.poll(async () => await ctx.oauthBridge.getState(KEY_TEXT)).toMatchObject({
    status: 'waiting-browser', code: 'WXYZ',
  })
  await expect(ctx.oauthBridge.cancel(KEY_TEXT)).resolves.toMatchObject({
    status: 'cancelled', inFlight: false,
  })
  const view = await ctx.oauthBridge.getState(KEY_TEXT)
  expect(view.authorizeUrl).toBeUndefined()
})

it('does not finish start on a progress notice before the authorize URL', async () => {
  const ctx = await harness()
  const gate = Promise.withResolvers<undefined>()
  let release: (() => void) | undefined
  ctx.authorization.registerFlow(flow(async (session) => {
    session.notify({ message: 'Signing in' })
    await gate.promise
    session.notify({ message: 'Open this page', url: 'https://auth.example/start' })
    await new Promise<void>((resolve) => { release = resolve })
  }))
  const pending = ctx.oauthBridge.start(KEY_TEXT)
  await expect.poll(() => ctx.authorization.describe(KEY)?.inFlight).toBe(true)
  let settled = false
  void pending.then(() => { settled = true })
  await Promise.resolve()
  expect(settled).toBe(false)
  gate.resolve()
  await expect(pending).resolves.toMatchObject({
    status: 'waiting-browser',
    authorizeUrl: 'https://auth.example/start',
    inFlight: true,
  })
  release?.()
  await expect.poll(async () => await ctx.oauthBridge.getState(KEY_TEXT)).toMatchObject({
    status: 'authorized',
  })
})

it('holds start until the flow prompts after an initial await', async () => {
  const ctx = await harness()
  const gate = Promise.withResolvers<undefined>()
  ctx.authorization.registerFlow(flow(async (session) => {
    await gate.promise
    await session.prompt({
      kind: 'select',
      message: 'Method',
      options: [
        { id: 'browser', label: 'Browser' },
        { id: 'device_code', label: 'Device' },
      ],
    })
  }))
  const pending = ctx.oauthBridge.start(KEY_TEXT)
  await expect.poll(() => ctx.authorization.describe(KEY)?.inFlight).toBe(true)
  gate.resolve()
  await expect(pending).resolves.toMatchObject({ status: 'prompting', inFlight: true })
  await ctx.oauthBridge.cancel(KEY_TEXT)
})

it('signs out a stored grant and forgets the attempt', async () => {
  const ctx = await harness()
  ctx.authorization.registerFlow(flow( async () => undefined))
  await ctx.oauthBridge.start(KEY_TEXT)
  await expect.poll(async () => await ctx.oauthBridge.getState(KEY_TEXT)).toMatchObject({
    status: 'authorized', credentialConfigured: true,
  })
  await expect(ctx.oauthBridge.signOut(KEY_TEXT)).resolves.toEqual({
    status: 'idle', inFlight: false, credentialConfigured: false,
  })
})

it('cancels while a prompt is waiting after a URL notice', async () => {
  const ctx = await harness()
  ctx.authorization.registerFlow(flow( async (session) => {
    session.notify({ message: 'Open this page', url: 'https://auth.example/start' })
    try {
      await session.prompt({ kind: 'text', message: 'Code' })
    } catch {
      return
    }
  }))
  await ctx.oauthBridge.start(KEY_TEXT)
  await expect.poll(async () => await ctx.oauthBridge.getState(KEY_TEXT)).toMatchObject({
    status: 'prompting', authorizeUrl: 'https://auth.example/start',
  })
  await expect(ctx.oauthBridge.cancel(KEY_TEXT)).resolves.toMatchObject({
    status: 'cancelled', inFlight: false,
  })
})

it('signs out a hanging attempt', async () => {
  const ctx = await harness()
  ctx.authorization.registerFlow(flow( session => new Promise((_resolve, reject) => {
    session.notify({ message: 'Open this page', url: 'https://auth.example/start' })
    session.signal.addEventListener('abort', () => { reject(new Error('withdrawn')) }, { once: true })
  })))
  await ctx.oauthBridge.start(KEY_TEXT)
  await expect.poll(async () => await ctx.oauthBridge.getState(KEY_TEXT)).toMatchObject({
    status: 'waiting-browser', inFlight: true,
  })
  await expect(ctx.oauthBridge.signOut(KEY_TEXT)).resolves.toMatchObject({
    status: 'idle', inFlight: false, credentialConfigured: false,
  })
})

it('records a flow failure on the view', async () => {
  const ctx = await harness()
  ctx.authorization.registerFlow({
    key: KEY,
    label: 'ChatGPT (Codex)',
    methods: [{ id: 'oauth', label: 'Sign in' }],
    run: () => Promise.reject(new Error('exchange failed')),
  })
  await ctx.oauthBridge.start(KEY_TEXT)
  await expect.poll(async () => await ctx.oauthBridge.getState(KEY_TEXT)).toMatchObject({
    status: 'failed',
    error: 'exchange failed',
    inFlight: false,
  })
})

it('fails loud when no flow is registered', async () => {
  const ctx = await harness()
  await ctx.oauthBridge.start(KEY_TEXT)
  await expect.poll(async () => await ctx.oauthBridge.getState(KEY_TEXT)).toMatchObject({
    status: 'failed',
    inFlight: false,
  })
})

it('yields snapshots from watch and stops when the subscriber aborts', async () => {
  const ctx = await harness()
  let release: (() => void) | undefined
  ctx.authorization.registerFlow(flow( session => new Promise((resolve) => {
    session.notify({ message: 'Continue', url: 'https://auth.example/start' })
    release = resolve
  })))
  const lifetime = new AbortController()
  const iterator = ctx.oauthBridge.watch(KEY_TEXT, lifetime.signal)[Symbol.asyncIterator]()
  expect(await iterator.next()).toMatchObject({ done: false, value: { status: 'idle', inFlight: false } })
  const next = iterator.next()
  await ctx.oauthBridge.start(KEY_TEXT)
  const started = await next
  expect(started.done).toBe(false)
  expect(started.value?.inFlight).toBe(true)
  await expect.poll(async () => {
    const frame = await iterator.next()
    return frame.value?.status
  }).toBe('waiting-browser')
  release?.()
  lifetime.abort()
  expect(await iterator.next()).toMatchObject({ done: true, value: undefined })
})

it('stops watch immediately when the subscriber is already aborted', async () => {
  const ctx = await harness()
  const lifetime = new AbortController()
  lifetime.abort()
  const received: unknown[] = []
  for await (const view of ctx.oauthBridge.watch(KEY_TEXT, lifetime.signal)) received.push(view)
  expect(received).toEqual([{ status: 'idle', inFlight: false, credentialConfigured: false }])
})

it('stringifies a non-Error flow failure', async () => {
  const ctx = await harness()
  ctx.authorization.registerFlow({
    key: KEY,
    label: 'ChatGPT (Codex)',
    methods: [{ id: 'oauth', label: 'Sign in' }],
    run: () => Promise.reject('bare refusal'),
  })
  await ctx.oauthBridge.start(KEY_TEXT)
  await expect.poll(async () => await ctx.oauthBridge.getState(KEY_TEXT)).toMatchObject({
    status: 'failed',
    error: 'bare refusal',
    inFlight: false,
  })
})

it('keeps a second watch subscriber when the first aborts', async () => {
  const ctx = await harness()
  const first = new AbortController()
  const second = new AbortController()
  const iterFirst = ctx.oauthBridge.watch(KEY_TEXT, first.signal)[Symbol.asyncIterator]()
  const iterSecond = ctx.oauthBridge.watch(KEY_TEXT, second.signal)[Symbol.asyncIterator]()
  expect((await iterFirst.next()).value).toMatchObject({ status: 'idle' })
  expect((await iterSecond.next()).value).toMatchObject({ status: 'idle' })
  const firstHeld = iterFirst.next()
  const secondHeld = iterSecond.next()
  first.abort()
  expect(await firstHeld).toMatchObject({ done: true })
  second.abort()
  expect(await secondHeld).toMatchObject({ done: true })
})

it('records an unknown method as a failed attempt', async () => {
  const ctx = await harness()
  ctx.authorization.registerFlow(flow( async () => undefined))
  await ctx.oauthBridge.start(KEY_TEXT, 'missing')
  await expect.poll(async () => await ctx.oauthBridge.getState(KEY_TEXT)).toMatchObject({
    status: 'failed',
    inFlight: false,
  })
})

it('withdraws a running attempt when the plugin unloads', async () => {
  const ctx = await harness()
  ctx.authorization.registerFlow(flow( session => new Promise((_resolve, reject) => {
    session.notify({ message: 'Open this page', url: 'https://auth.example/start' })
    session.signal.addEventListener('abort', () => { reject(new Error('withdrawn')) }, { once: true })
  })))
  await ctx.oauthBridge.start(KEY_TEXT)
  await expect.poll(async () => await ctx.oauthBridge.getState(KEY_TEXT)).toMatchObject({
    status: 'waiting-browser',
    inFlight: true,
  })
  await ctx.fiber.dispose()
})

it('withdraws a prompt when its own signal aborts', async () => {
  const ctx = await harness()
  ctx.authorization.registerFlow(flow( async (session) => {
    const prompt = new AbortController()
    const pending = session.prompt({ kind: 'text', message: 'Code', signal: prompt.signal })
    prompt.abort()
    await pending.catch(() => undefined)
  }))
  await ctx.oauthBridge.start(KEY_TEXT)
  await expect.poll(async () => await ctx.oauthBridge.getState(KEY_TEXT)).toMatchObject({
    status: 'authorized',
    credentialConfigured: true,
  })
})
