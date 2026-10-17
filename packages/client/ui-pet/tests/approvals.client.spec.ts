// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { PendingApproval } from '@deepseek-ai/dsh-client-ui-approval/src/client/contract/slots.ts'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { collectApprovals, matchApproval, PetApprovalBridge, type AnswerableApproval } from '../src/client/approvals.ts'
import { hostPending, S1, S2 } from './fixtures.ts'

function pending(sessionId = S1, callId?: string, signal?: AbortSignal): PendingApproval {
  return new PendingApproval(sessionId, {
    toolName: 'bash',
    ...(callId === undefined ? {} : { callId: ToolCallId(callId) }),
    ...(signal === undefined ? {} : { signal }),
  })
}

describe('collectApprovals', () => {
  it('keeps answerable approvals and skips other interactions', () => {
    const open = pending()
    const settled = pending(S2)
    settled.delegate()
    void settled.result.catch(() => {})
    const approvals = collectApprovals([
      { pendingInteraction: open },
      { pendingInteraction: settled },
      { pendingInteraction: { kind: 'question' } },
      { pendingInteraction: { kind: 'approval' } },
      { pendingInteraction: undefined },
    ])
    expect(approvals).toEqual([open])
  })
})

describe('matchApproval', () => {
  it('matches by Session and call id, falling back to the tool name', () => {
    const byCall = pending(S1, 'c1')
    const other = pending(S1, 'c2')
    const noCall = pending(S2)
    expect(matchApproval(hostPending('r', S1, 'bash', 'c1'), [other, byCall])).toBe(byCall)
    expect(matchApproval(hostPending('r', S2, 'bash'), [byCall, noCall])).toBe(noCall)
    expect(matchApproval(hostPending('r', S2, 'write'), [noCall])).toBeUndefined()
    expect(matchApproval(hostPending('r', S1, 'bash', 'c9'), [byCall])).toBeUndefined()
  })
})

describe('PetApprovalBridge', () => {
  it('decides once and reports a settled request afterwards', async () => {
    const request = pending()
    const bridge = new PetApprovalBridge()
    expect(await bridge.decide(request, 'allowed-once')).toBe('decided')
    await expect(request.result).resolves.toBe('allowed-once')
    expect(await bridge.decide(request, 'rejected')).toBe('already-settled')
  })

  it('reports in-flight for a double click on the same request', async () => {
    let release!: () => void
    const slow: AnswerableApproval = {
      key: 'k', sessionId: S1, toolName: 'bash', answerable: true,
      answer: () => new Promise<void>((resolve) => { release = resolve }),
    }
    const bridge = new PetApprovalBridge()
    const first = bridge.decide(slow, 'allowed-once')
    expect(await bridge.decide(slow, 'allowed-once')).toBe('in-flight')
    release()
    expect(await first).toBe('decided')
  })

  it('separates a lost race from a real failure', async () => {
    const bridge = new PetApprovalBridge()
    const state = { answerable: true }
    const lost: AnswerableApproval = {
      key: 'lost', sessionId: S1, toolName: 'bash',
      get answerable() { return state.answerable },
      answer: () => { state.answerable = false; return Promise.reject(new Error('already settled')) },
    }
    expect(await bridge.decide(lost, 'rejected')).toBe('already-settled')
    const broken: AnswerableApproval = {
      key: 'broken', sessionId: S1, toolName: 'bash', answerable: true,
      answer: () => Promise.reject(new Error('transport')),
    }
    expect(await bridge.decide(broken, 'rejected')).toBe('failed')
  })

  it('main window and pet window race: the first answer wins and the other window is dismissed', async () => {
    // The Gateway forwards one waterfall to every owner Client; the first result
    // settles it and the others receive `cancel`, which aborts their request signal.
    const mainWindowCancel = new AbortController()
    const petWindowCancel = new AbortController()
    const inMain = pending(S1, 'c1', mainWindowCancel.signal)
    const inPet = pending(S1, 'c1', petWindowCancel.signal)
    const hostOutcome = Promise.race([
      inMain.result.then((outcome) => { petWindowCancel.abort(new Error('settled elsewhere')); return { from: 'main', outcome } }),
      inPet.result.then((outcome) => { mainWindowCancel.abort(new Error('settled elsewhere')); return { from: 'pet', outcome } }),
    ])
    void inMain.result.catch(() => {})
    void inPet.result.catch(() => {})
    const petBridge = new PetApprovalBridge()
    expect(await petBridge.decide(inPet, 'rejected')).toBe('decided')
    await expect(hostOutcome).resolves.toEqual({ from: 'pet', outcome: 'rejected' })
    expect(inMain.answerable).toBe(false)
    expect(collectApprovals([{ pendingInteraction: inMain }])).toEqual([])
    await expect(inMain.answer('allowed-once')).rejects.toThrow(/already settled/u)
    expect(await new PetApprovalBridge().decide(inMain, 'allowed-once')).toBe('already-settled')
  })
})
