import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Volatile } from '@deepseek-ai/cordis'
import { updateVolatile } from '@deepseek-ai/cosmokit'
import { Session, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import PetService, { PetReducer } from '../src/index.ts'
import type { Config } from '../src/index.ts'
import type { PetSnapshot } from '../src/types.ts'
import { asked, decided, S1, S2, SUB, turnEnd, turnStart } from './fixtures.ts'

function session(id: SessionId, extra: { origin?: 'subagent'; cwd?: string } = {}): Session {
  return Session.create(id, [], { version: SESSION_FORMAT_VERSION, id, createdAt: 0, isSeeded: false, ...extra })
}

type ConfigInput = Partial<{
  [K in keyof Config]: Config[K] extends Volatile<infer V> ? V : Config[K]
}>

interface Setup {
  ctx: Context
  pet: PetService
  config: Config
  dispose: () => Promise<void>
}

/**
 * Mount the service. `settings` mounts a fake Settings service and names the profile entry `pet`.
 */
async function setup(input: ConfigInput = {}, settings?: (ns: string, patch: object) => Promise<void>): Promise<Setup> {
  const ctx = new Context()
  if (settings !== undefined) {
    const write = settings
    class Settings extends Service {
      constructor(inner: Context) { super(inner, 'settings') }
      update(ns: string, patch: object): Promise<void> { return write(ns, patch) }
    }
    await ctx.plugin(Settings)
  }
  let captured: Config | undefined
  class Capturing extends PetService {
    constructor(inner: Context, resolved: Config) {
      if (settings !== undefined) Object.defineProperty(inner.fiber, 'entry', { value: { options: { id: 'pet' } } })
      super(inner, resolved)
      captured = resolved
    }
  }
  const fiber = ctx.plugin(Capturing, { snapshotDebounceMs: 0, ...input })
  await fiber
  if (captured === undefined) throw new Error('pet did not mount')
  return { ctx, pet: ctx.pet, config: captured, dispose: async () => { await fiber.dispose() } }
}

/** Commit new volatile values the way the Loader does, then announce them. */
function reconfigure(ctx: Context, config: Config, input: ConfigInput): void {
  const next = PetService.Config(input) as Config
  for (const key of Object.keys(input) as (keyof Config)[]) {
    const target = config[key]
    const source = next[key]
    if (typeof target === 'object' && typeof source === 'object') updateVolatile(target, source)
  }
  ctx.emit('loader/volatile-update', Object.keys(input).map(key => [key]))
}

function emit(ctx: Context, target: Session, event: SessionEvent): void {
  ctx.emit('session/event', target, event)
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('PetService', () => {
  it('folds session/event from every Session and serves getSnapshot', async () => {
    const { ctx, pet } = await setup()
    const one = session(S1, { cwd: '/repo/alpha' })
    emit(ctx, one, turnStart(Date.now()))
    const snapshot = pet.getSnapshot()
    expect(snapshot.primary).toBe('THINKING')
    expect(snapshot.sessions[0]).toMatchObject({ sessionId: S1, project: 'alpha', subagent: false })
    expect(snapshot.visible).toBe(true)
    expect(pet.getSnapshot().revision).toBe(snapshot.revision + 1)
  })

  it('treats delegated Sessions as subagents', async () => {
    const { ctx, pet } = await setup({ includeSubagents: true })
    emit(ctx, session(SUB, { origin: 'subagent' }), turnStart(Date.now()))
    expect(pet.getSnapshot().sessions[0]).toMatchObject({ sessionId: SUB, subagent: true })
  })

  it('streams frames on change and stops on abort', async () => {
    const { ctx, pet } = await setup()
    const controller = new AbortController()
    const frames: PetSnapshot[] = []
    const iterator = pet.watch(controller.signal)[Symbol.asyncIterator]()
    const first = await iterator.next()
    if (first.done === true) throw new Error('stream ended early')
    frames.push(first.value)
    const next = iterator.next()
    emit(ctx, session(S1), turnStart(Date.now()))
    emit(ctx, session(S1), asked(Date.now(), 'r1', 'bash'))
    const second = await next
    if (second.done === true) throw new Error('stream ended early')
    frames.push(second.value)
    expect(frames.map(frame => frame.primary)).toEqual(['IDLE', 'WAITING'])
    const ended = iterator.next()
    controller.abort()
    expect((await ended).done).toBe(true)
  })

  it('coalesces changes within the debounce window', async () => {
    vi.useFakeTimers()
    const { ctx, pet } = await setup({ snapshotDebounceMs: 50 })
    const iterator = pet.watch(new AbortController().signal)[Symbol.asyncIterator]()
    await iterator.next()
    const next = iterator.next()
    emit(ctx, session(S1), turnStart(Date.now()))
    emit(ctx, session(S1), asked(Date.now(), 'r', 'bash'))
    emit(ctx, session(S1), decided(Date.now(), 'r'))
    await vi.advanceTimersByTimeAsync(50)
    const frame = await next
    expect(frame.done).toBe(false)
    if (frame.done === false) expect(frame.value).toMatchObject({ primary: 'THINKING', pending: [] })
  })

  it('re-emits when a SUCCESS hold expires without new events', async () => {
    vi.useFakeTimers()
    const { ctx, pet } = await setup({ successHoldMs: 1000 })
    const iterator = pet.watch(new AbortController().signal)[Symbol.asyncIterator]()
    await iterator.next()
    emit(ctx, session(S1), turnStart(Date.now()))
    emit(ctx, session(S1), turnEnd(Date.now(), { kind: 'completed' }))
    const success = await iterator.next()
    if (success.done === true) throw new Error('stream ended early')
    expect(success.value.primary).toBe('SUCCESS')
    const idle = iterator.next()
    await vi.advanceTimersByTimeAsync(1000)
    const frame = await idle
    if (frame.done === true) throw new Error('stream ended early')
    expect(frame.value.primary).toBe('IDLE')
  })

  it('re-arms one expiry timer across reads and clears it on dispose', async () => {
    vi.useFakeTimers()
    const { ctx, pet, dispose } = await setup({ successHoldMs: 1000 })
    emit(ctx, session(S1), turnEnd(Date.now(), { kind: 'completed' }))
    pet.getSnapshot()
    pet.getSnapshot()
    expect(vi.getTimerCount()).toBe(1)
    await dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ends watchers when the plugin is disposed', async () => {
    const { pet, dispose } = await setup()
    const iterator = pet.watch(new AbortController().signal)[Symbol.asyncIterator]()
    await iterator.next()
    const ended = iterator.next()
    await dispose()
    expect((await ended).done).toBe(true)
  })

  it('drops Sessions on session/disposed and clears a matching pin', async () => {
    const { ctx, pet } = await setup()
    const one = session(S1)
    emit(ctx, one, turnStart(Date.now()))
    pet.pin(S1)
    expect(pet.getSnapshot().pinnedSessionId).toBe(S1)
    ctx.emit('session/disposed', one)
    const snapshot = pet.getSnapshot()
    expect(snapshot.sessions).toEqual([])
    expect(snapshot.pinnedSessionId).toBeUndefined()
    ctx.emit('session/disposed', session(S2))
  })

  it('keeps setVisible in memory without Settings and validates input', async () => {
    const { ctx, pet } = await setup()
    await pet.setVisible(false)
    await pet.setVisible(false)
    expect(pet.getSnapshot().visible).toBe(false)
    await expect(pet.setVisible(JSON.parse('"yes"') as boolean)).rejects.toThrow(RemoteError)
    expect(() => { pet.pin(S2) }).toThrow(RemoteError)
    emit(ctx, session(S2), turnStart(Date.now()))
    pet.pin(S2)
    pet.pin(S2)
    pet.pin(null)
    expect(pet.getSnapshot().pinnedSessionId).toBeUndefined()
  })

  it('persists setVisible through Settings and follows the committed value', async () => {
    const update = vi.fn((_ns: string, _patch: object) => Promise.resolve())
    const { ctx, pet, config } = await setup({}, update)
    await pet.setVisible(true)
    expect(update).not.toHaveBeenCalled()
    await pet.setVisible(false)
    expect(update).toHaveBeenCalledWith('pet', { visible: false })
    expect(pet.getSnapshot().visible).toBe(true)
    reconfigure(ctx, config, { visible: false })
    expect(pet.getSnapshot().visible).toBe(false)
  })

  it('publishes shared settings and re-emits when they change', async () => {
    const { ctx, pet, config } = await setup({ restrictTools: true, restrictedTools: ['bash'], notifySuccess: false })
    emit(ctx, session(S1), asked(Date.now(), 'r1', 'bash'))
    const first = pet.getSnapshot()
    expect(first.settings).toEqual({ restrictTools: true, restrictedTools: ['bash'], notify: { waiting: true, success: false, error: true } })
    expect(first.pending[0]?.restrictedInPet).toBe(true)
    const iterator = pet.watch(new AbortController().signal)[Symbol.asyncIterator]()
    await iterator.next()
    const next = iterator.next()
    reconfigure(ctx, config, { restrictTools: false })
    const frame = await next
    if (frame.done === true) throw new Error('stream ended early')
    expect(frame.value.pending[0]?.restrictedInPet).toBe(false)
  })

  it('drops an in-memory visibility once the Loader commits configuration', async () => {
    const { ctx, pet, config } = await setup()
    await pet.setVisible(false)
    reconfigure(ctx, config, { visible: true })
    expect(pet.getSnapshot().visible).toBe(true)
  })

  it('acknowledges unseen results', async () => {
    const { ctx, pet } = await setup()
    emit(ctx, session(S1), turnStart(Date.now()))
    emit(ctx, session(S1), turnEnd(Date.now(), { kind: 'completed' }))
    pet.acknowledge(S1)
    pet.acknowledge(S1)
    expect(pet.getSnapshot().sessions[0]).toMatchObject({ state: 'IDLE', unseenResult: false })
  })

  it('offers no pack without the development switch and reads the switch once', async () => {
    vi.stubEnv('DSH_PET_DEV', '')
    const { pet } = await setup()
    const first = pet.pack()
    expect(await pet.pack()).toEqual(await first)
    expect(await first).toEqual({ pack: null, problems: [] })
    vi.unstubAllEnvs()
  })

  it('logs and survives a fold failure', async () => {
    const { ctx, pet } = await setup()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    vi.spyOn(PetReducer.prototype, 'apply').mockImplementationOnce(() => { throw new Error('fold bug') })
    emit(ctx, session(S1), turnStart(Date.now()))
    expect(warn).toHaveBeenCalled()
    expect(pet.getSnapshot().sessions).toEqual([])
  })
})
