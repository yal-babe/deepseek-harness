import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { StudioCloud } from '../src/index.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})
async function fixture() {
  const stateDirectory = await mkdtemp(join(tmpdir(), 'studio-account-'))
  cleanups.push(() => rm(stateDirectory, { recursive: true, force: true }))
  const user = {
    id: randomUUID(),
    username: 'personal',
    email: null,
    displayName: 'Personal',
    mustChangePassword: false,
  }
  const calls: string[] = []
  let unavailable = false
  let access = 'access-one',
    refresh = 'refresh-one',
    expired = false,
    rotations = 0,
    hold: (() => void) | undefined,
    holdStarted: (() => void) | undefined
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    calls.push(req.url ?? '')
    const chunks: Buffer[] = []
    for await (const raw of req) {
      const chunk: unknown = raw
      if (chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk))
      else throw new Error('Expected request bytes')
    }
    const body = z
      .object({ password: z.string().optional(), refreshToken: z.string().optional() })
      .parse(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
    res.setHeader('content-type', 'application/json')
    const send = (value: object, status = 200) => {
      res.statusCode = status
      res.end(JSON.stringify(value))
    }
    if (req.url === '/v1/capabilities') {
      send({ protocolVersion: 1, payloadVersions: [1], encryption: ['plain'] })
      return
    }
    if (req.url === '/v1/auth/login') {
      if (body.password !== 'valid-password') {
        send({ error: { code: 'LOGIN_FAILED' } }, 401)
        return
      }
      if (holdStarted) {
        const started = holdStarted
        holdStarted = undefined
        started()
        await new Promise<void>((resolve) => {
          hold = resolve
        })
      }
      send({ accessToken: access, refreshToken: refresh, expiresIn: 900 })
      return
    }
    if (req.url === '/v1/auth/refresh') {
      rotations++
      if (body.refreshToken !== refresh) {
        send({ error: { code: 'UNAUTHORIZED' } }, 401)
        return
      }
      access = 'access-two'
      refresh = 'refresh-two'
      expired = false
      send({ accessToken: access, refreshToken: refresh, expiresIn: 900 })
      return
    }
    if (expired || req.headers.authorization !== `Bearer ${access}`) {
      send({ error: { code: 'UNAUTHORIZED' } }, 401)
      return
    }
    if (req.url === '/v1/auth/session') {
      send(user)
      return
    }
    if (req.url === '/v1/me/storage') {
      if (unavailable) { send({ error: { code: 'TEMPORARILY_UNAVAILABLE' } }, 503); return }
      send({ usedBytes: 0, quotaBytes: 100000, encryptionMode: 'plain' })
      return
    }
    if (req.url?.startsWith('/v1/sync/snapshot')) { send({ snapshot: randomUUID(), items: [], hasMore: false, after: null, cursor: '0' }); return }
    if (req.url === '/v1/auth/logout') {
      send({ ok: true })
      return
    }
    send({ error: { code: 'NOT_FOUND' } }, 404)
  }
  const server: Server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      res.statusCode = 500
      res.end()
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(async () => {
    hold?.()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      }),
    )
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('TCP fixture did not bind')
  const ctx = new Context(),
    credentials = ctx.plugin(MemoryCredentials)
  await credentials
  const plugin = ctx.plugin(StudioCloud, { stateDirectory, requestTimeoutMs: 5000, syncIntervalMs: 3600000 })
  cleanups.push(async () => {
    await plugin.dispose()
    await credentials.dispose()
  })
  await plugin
  return {
    ctx,
    origin: `http://127.0.0.1:${address.port}`,
    calls,
    user,
    unavailable() { unavailable = true },
    get rotations() {
      return rotations
    },
    expire() {
      expired = true
    },
    holdLogin() {
      return new Promise<void>((resolve) => {
        holdStarted = resolve
      })
    },
    release() {
      hold?.()
    },
  }
}

describe('Host-owned Studio identity', () => {
  it('keeps device grants only in credentials and requires preview before any upload', async () => {
    const f = await fixture()
    const user = await f.ctx.studioCloud.signIn(f.origin, 'personal', 'valid-password', 'Laptop', true)
    expect(user).toEqual(f.user)
    const state = await f.ctx.studioCloud.getState()
    expect(state.phase).toBe('preview-required')
    expect(JSON.stringify(state)).not.toContain('access-one')
    expect(f.calls.some(path => path.includes('/sync/snapshot'))).toBe(true)
    expect(f.calls.some(path => path.includes('/sync/push'))).toBe(false)
    const record = await f.ctx.credentials.readRecord(credentialKey('studio-cloud', 'connection'))
    expect(record?.kind).toBe('grant')
    expect(await f.ctx.studioCloud.signOut()).toEqual({ revoked: true })
    expect(await f.ctx.credentials.readRecord(credentialKey('studio-cloud', 'connection'))).toBeUndefined()
  })
  it('rotates a rejected access token once for concurrent account reads', async () => {
    const f = await fixture()
    await f.ctx.studioCloud.signIn(f.origin, 'personal', 'valid-password', 'Laptop', true)
    f.expire()
    const states = await Promise.all([f.ctx.studioCloud.getState(), f.ctx.studioCloud.getState()])
    expect(states.map(state => state.identity?.id)).toEqual([f.user.id, f.user.id])
    expect(f.rotations).toBe(1)
  })
  it('sign-out prevents a late login from persisting credentials', async () => {
    const f = await fixture(),
      started = f.holdLogin()
    const pending = f.ctx.studioCloud.signIn(f.origin, 'personal', 'valid-password', 'Laptop', true)
    const rejected = expect(pending).rejects.toMatchObject({ details: { code: 'CANCELLED' } })
    await started
    await f.ctx.studioCloud.signOut()
    f.release()
    await rejected
    expect((await f.ctx.studioCloud.getState()).identity).toBeNull()
  })
  it('retains account identity and server settings while cloud storage is unavailable', async () => {
    const f = await fixture()
    await f.ctx.studioCloud.signIn(f.origin, 'personal', 'valid-password', '', true)
    f.unavailable()
    expect(await f.ctx.studioCloud.getState()).toMatchObject({
      origin: f.origin, identity: f.user, phase: 'paused', failureCode: 'TEMPORARILY_UNAVAILABLE',
    })
  })
  it('uses a saved HTTP server for login and retains it after sign-out', async () => {
    const f = await fixture()
    await f.ctx.studioCloud.configureServer(f.origin)
    expect((await f.ctx.studioCloud.getState()).origin).toBe(f.origin)
    await f.ctx.studioCloud.signIn('', 'personal', 'valid-password', '', false)
    expect(f.calls).toContain('/v1/auth/login')
    await expect(f.ctx.studioCloud.configureServer('https://other.example')).rejects.toMatchObject({
      details: { code: 'SIGN_OUT_REQUIRED' },
    })
    await f.ctx.studioCloud.signOut()
    expect((await f.ctx.studioCloud.getState()).origin).toBe(f.origin)
  })
})
