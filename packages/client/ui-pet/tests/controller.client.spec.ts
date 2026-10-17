// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AnswerableApproval, PendingInteractionLike } from '../src/client/approvals.ts'
import { PetController, type PetControllerDeps } from '../src/client/controller.ts'
import type { AnswerableQuestion } from '../src/client/questions.ts'
import type { PetViewState } from '../src/client/store.ts'
import type { DesktopPetBridge } from '../src/client/surface.ts'
import type { NotificationSink } from '../src/client/notifier.ts'
import { PET_SNOOZE_MS, PetPreferenceStore } from '../src/client/preferences.ts'
import { S1, S2, sessionView, snapshot } from './fixtures.ts'

function approval(key: string): AnswerableApproval & PendingInteractionLike {
  const value: AnswerableApproval & PendingInteractionLike = {
    key, sessionId: S1, toolName: 'bash', answerable: true, kind: 'approval', answer: vi.fn(async () => {}),
  }
  return value
}

function bench(bridge?: DesktopPetBridge, sink?: NotificationSink) {
  const view = createSnapshotStore<PetViewState>({ snapshot: undefined, connected: true }, { flush: 'sync' })
  const status = createSnapshotStore<ReadonlyMap<SessionId, { pendingInteraction: PendingInteractionLike | undefined }>>(new Map(), { flush: 'sync' })
  const deps: PetControllerDeps = {
    view,
    sessionStatus: status,
    quickAsk: {
      createSession: vi.fn(async () => ({ ok: true as const, value: { sessionId: S2 } })),
      upload: vi.fn(),
      prompt: vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } })),
      requestId: () => brandString<SessionRequestId>('r'),
    },
    setVisible: vi.fn(async () => {}),
    acknowledge: vi.fn(async () => {}),
    bridge,
    openSession: vi.fn(),
    preferences: new PetPreferenceStore(undefined),
    notifications: sink,
    now: () => 1000,
  }
  return { view, status, deps, controller: new PetController(deps) }
}

describe('PetController', () => {
  it('derives questions from the same status snapshot and answers them once', async () => {
    const { status, controller } = bench()
    expect(controller.questions.getSnapshot()).toEqual([])
    const listener = vi.fn()
    const off = controller.questions.subscribe(listener)
    const asked: AnswerableQuestion & PendingInteractionLike = {
      kind: 'question', key: 'q', sessionId: S1, review: undefined, answer: vi.fn(async () => {}),
      questions: [{ id: 'q1', question: 'Which?', options: [{ label: 'a' }] }],
    }
    status.set(new Map([[S1, { pendingInteraction: asked }]]))
    expect(listener).toHaveBeenCalled()
    expect(controller.questions.getSnapshot()).toEqual([asked])
    expect(controller.approvals.getSnapshot()).toEqual([])
    expect(await controller.answerQuestion(asked, { q1: 'a' })).toBe('answered')
    off()
  })

  it('derives approvals once per status snapshot and forwards subscriptions', async () => {
    const { status, controller } = bench()
    expect(controller.approvals.getSnapshot()).toEqual([])
    const listener = vi.fn()
    const off = controller.approvals.subscribe(listener)
    const first = approval('a')
    status.set(new Map([[S1, { pendingInteraction: first }]]))
    expect(listener).toHaveBeenCalled()
    const derived = controller.approvals.getSnapshot()
    expect(derived).toEqual([first])
    expect(controller.approvals.getSnapshot()).toBe(derived)
    expect(await controller.decide(first, 'allowed-once')).toBe('decided')
    off()
  })

  it('targets the focused Session or a new one in its directory', async () => {
    const { view, controller, deps } = bench()
    expect(controller.target('last')).toEqual({ kind: 'new', cwd: undefined })
    view.set({ connected: true, snapshot: snapshot({ focusSessionId: S1, sessions: [sessionView(S1, { cwd: '/repo' })] }) })
    expect(controller.target('last')).toEqual({ kind: 'session', sessionId: S1 })
    expect(controller.target('new')).toEqual({ kind: 'new', cwd: '/repo' })
    expect(await controller.ask('hi', [], 'new', new AbortController().signal)).toEqual({ ok: true, sessionId: S2 })
    expect(deps.quickAsk.createSession).toHaveBeenCalledWith('/repo')
  })

  it('forwards hide, acknowledge, and Desktop window controls', async () => {
    const bridge: DesktopPetBridge = {
      protocolVersion: 1, role: 'pet', setInteractive: vi.fn(), setVisible: vi.fn(), openMain: vi.fn(), onQuickAsk: () => () => {},
      onOpenSession: () => () => {},
    }
    const { controller, deps, view } = bench(bridge)
    await controller.hide()
    expect(deps.setVisible).toHaveBeenCalledWith(false)
    await controller.show()
    expect(deps.setVisible).toHaveBeenLastCalledWith(true)
    await controller.acknowledge(S1)
    expect(deps.acknowledge).toHaveBeenCalledWith(S1)
    controller.openMain()
    controller.setInteractive(true)
    expect(bridge.openMain).toHaveBeenCalledWith(undefined)
    expect(bridge.setInteractive).toHaveBeenCalledWith(true)
    view.set({ connected: true, snapshot: snapshot({ focusSessionId: S1, sessions: [sessionView(S1)] }) })
    controller.openMain()
    expect(bridge.openMain).toHaveBeenLastCalledWith(S1)
    controller.openMain(S2)
    expect(bridge.openMain).toHaveBeenLastCalledWith(S2)
    const web = bench()
    web.controller.openMain()
    expect(web.deps.openSession).not.toHaveBeenCalled()
    web.controller.openMain(S2)
    expect(web.deps.openSession).toHaveBeenCalledWith(S2)
    web.controller.setInteractive(false)
  })

  it('turns notifications on only after permission and manages the snooze', async () => {
    const none = bench()
    expect(none.controller.canNotify).toBe(false)
    expect(await none.controller.setNotify(true)).toBe(false)
    let permission: 'default' | 'granted' | 'denied' = 'default'
    const request = vi.fn(async () => permission)
    const sink: NotificationSink = { permission: () => permission, request, show: vi.fn() }
    const { controller } = bench(undefined, sink)
    expect(controller.canNotify).toBe(true)
    expect(await controller.setNotify(true)).toBe(false)
    expect(controller.preferences.getSnapshot().notify).toBe(false)
    permission = 'granted'
    expect(await controller.setNotify(true)).toBe(true)
    expect(request).toHaveBeenCalledOnce()
    expect(await controller.setNotify(true)).toBe(true)
    expect(request).toHaveBeenCalledOnce()
    controller.snooze()
    expect(controller.preferences.getSnapshot().snoozeUntil).toBe(1000 + PET_SNOOZE_MS)
    controller.resume()
    expect(controller.preferences.getSnapshot().snoozeUntil).toBeUndefined()
    expect(await controller.setNotify(false)).toBe(false)
    expect(controller.preferences.getSnapshot().notify).toBe(false)
  })
})
