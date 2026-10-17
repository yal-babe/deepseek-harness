// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { FileUploadReceiptId } from '@deepseek-ai/dsh-client-file-upload/types'
import { brandString } from '@deepseek-ai/dsh-brand'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { sendQuickAsk, type QuickAskDeps } from '../src/client/quick-ask.ts'
import { S1, S2 } from './fixtures.ts'

const failure = new RemoteError('gateway/bad-request', 'no', {})

function deps(overrides: Partial<QuickAskDeps> = {}): QuickAskDeps {
  return {
    createSession: vi.fn(async () => ({ ok: true as const, value: { sessionId: S2 } })),
    upload: vi.fn(async (_sessionId, _file, name: string) => ({ ok: true as const, value: { receiptId: brandString<FileUploadReceiptId>(`r-${name}`) } })),
    prompt: vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } })),
    requestId: () => brandString<SessionRequestId>('req-1'),
    ...overrides,
  }
}

const signal = new AbortController().signal

describe('sendQuickAsk', () => {
  it('rejects an empty ask without calling the Host', async () => {
    const bound = deps()
    expect(await sendQuickAsk(bound, { text: '  ', files: [], target: { kind: 'session', sessionId: S1 }, signal })).toEqual({ ok: false, stage: 'empty' })
    expect(bound.prompt).not.toHaveBeenCalled()
  })

  it('queues text into an existing Session', async () => {
    const bound = deps()
    expect(await sendQuickAsk(bound, { text: ' fix it ', files: [], target: { kind: 'session', sessionId: S1 }, signal })).toEqual({ ok: true, sessionId: S1 })
    expect(bound.createSession).not.toHaveBeenCalled()
    expect(bound.prompt).toHaveBeenCalledWith({ requestId: 'req-1', sessionId: S1, mode: 'queue', content: [{ type: 'text', text: 'fix it' }] }, signal)
  })

  it('creates a Session, uploads dropped files in order, then prompts', async () => {
    const bound = deps()
    const files = [new File(['a'], 'a.txt'), new File(['b'], 'b.log')]
    expect(await sendQuickAsk(bound, { text: '', files, target: { kind: 'new', cwd: '/repo' }, signal })).toEqual({ ok: true, sessionId: S2 })
    expect(bound.createSession).toHaveBeenCalledWith('/repo')
    expect(bound.upload).toHaveBeenNthCalledWith(1, S2, files[0], 'a.txt', signal)
    expect(bound.prompt).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: S2, content: [{ type: 'file', receiptId: 'r-a.txt' }, { type: 'file', receiptId: 'r-b.log' }],
    }), signal)
  })

  it('reports the failing stage', async () => {
    const files = [new File(['a'], 'a.txt')]
    expect(await sendQuickAsk(deps({ createSession: async () => ({ ok: false, error: failure }) }),
      { text: 'x', files: [], target: { kind: 'new' }, signal })).toEqual({ ok: false, stage: 'create', error: failure })
    expect(await sendQuickAsk(deps({ upload: async () => ({ ok: false, error: failure }) }),
      { text: 'x', files, target: { kind: 'session', sessionId: S1 }, signal })).toEqual({ ok: false, stage: 'upload', error: failure })
    expect(await sendQuickAsk(deps({ prompt: async () => ({ ok: false, error: failure }) }),
      { text: 'x', files: [], target: { kind: 'session', sessionId: S1 }, signal })).toEqual({ ok: false, stage: 'prompt', error: failure })
  })
})
