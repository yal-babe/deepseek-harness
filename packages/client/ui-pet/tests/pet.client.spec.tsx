// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { AnswerableApproval } from '../src/client/approvals.ts'
import { PetController } from '../src/client/controller.ts'
import type { AnswerableQuestion } from '../src/client/questions.ts'
import { APPROVAL_ARM_DELAY_MS, PetCharacter, PetOverlay, PetWindowRoot, type PetProps } from '../src/client/Pet.tsx'
import type { PetViewState } from '../src/client/store.ts'
import type { NotificationSink } from '../src/client/notifier.ts'
import { PetPreferenceStore } from '../src/client/preferences.ts'
import { hostPending, S1, sessionView, snapshot } from './fixtures.ts'
import { JobId } from '@deepseek-ai/dsh-jobs/brand'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { FileUploadReceiptId } from '@deepseek-ai/dsh-client-file-upload/types'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'

function hook<T>(source: ObservableSnapshot<T>): SnapshotSelectorHook<T> {
  return selector => useSyncExternalStore(listener => source.subscribe(listener), () => selector(source.getSnapshot()))
}

const t: PetProps['t'] = (key, params) => params === undefined ? key : `${key}:${Object.values(params).join(',')}`

function controllerStub(view: ObservableSnapshot<PetViewState>, preferences: PetPreferenceStore, notifications?: NotificationSink) {
  const controller = new PetController({
    view,
    sessionStatus: createSnapshotStore(new Map(), { flush: 'sync' }),
    quickAsk: {
      createSession: async () => ({ ok: true, value: { sessionId: S1 } }),
      upload: async () => ({ ok: true, value: { receiptId: brandString<FileUploadReceiptId>('r') } }),
      prompt: async () => ({ ok: true, value: { accepted: true } }),
      requestId: () => brandString<SessionRequestId>('q'),
    },
    setVisible: async () => {},
    acknowledge: async () => {},
    bridge: undefined,
    preferences,
    notifications,
    now: () => Date.now(),
  })
  return Object.assign(controller, {
    decide: vi.spyOn(controller, 'decide').mockResolvedValue('decided'),
    answerQuestion: vi.spyOn(controller, 'answerQuestion').mockResolvedValue('answered'),
    ask: vi.spyOn(controller, 'ask').mockResolvedValue({ ok: true, sessionId: S1 }),
    hide: vi.spyOn(controller, 'hide').mockResolvedValue(undefined),
    acknowledge: vi.spyOn(controller, 'acknowledge').mockResolvedValue(undefined),
    openMain: vi.spyOn(controller, 'openMain').mockImplementation(() => {}),
    setInteractive: vi.spyOn(controller, 'setInteractive').mockImplementation(() => {}),
    show: vi.spyOn(controller, 'show').mockResolvedValue(undefined),
    setNotify: vi.spyOn(controller, 'setNotify').mockResolvedValue(true),
    snooze: vi.spyOn(controller, 'snooze'),
    resume: vi.spyOn(controller, 'resume'),
  })
}

function setup(
  view: PetViewState,
  approvals: readonly AnswerableApproval[] = [],
  questions: readonly AnswerableQuestion[] = [],
  notifications?: NotificationSink,
) {
  const preferences = new PetPreferenceStore(undefined)
  const viewStore = createSnapshotStore<PetViewState>(view, { flush: 'sync' })
  const approvalStore = createSnapshotStore<readonly AnswerableApproval[]>(approvals, { flush: 'sync' })
  const questionStore = createSnapshotStore<readonly AnswerableQuestion[]>(questions, { flush: 'sync' })
  const controller = controllerStub(viewStore, preferences, notifications)
  const props: PetProps = {
    t, controller, useView: hook(viewStore), useApprovals: hook(approvalStore), useQuestions: hook(questionStore),
    usePreferences: hook(preferences.snapshot),
  }
  return { props, controller, viewStore, approvalStore, questionStore, preferences }
}

function asked(questions: AnswerableQuestion['questions'], key = 'q'): AnswerableQuestion {
  return { kind: 'question', key, sessionId: S1, questions, review: undefined, answer: async () => {} }
}

const local: AnswerableApproval = { key: 'k', sessionId: S1, toolName: 'bash', callId: 'c1', answerable: true, answer: async () => {} }

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('PetCharacter', () => {
  it('cycles frames and dims when disconnected', () => {
    const { container } = render(<PetCharacter state="DISCONNECTED" label="pet" />)
    const image = container.querySelector('img')!
    const first = image.getAttribute('src')
    act(() => { vi.advanceTimersByTime(200) })
    expect(image.getAttribute('src')).not.toBe(first)
    expect(container.querySelector('[data-state="DISCONNECTED"]')).not.toBeNull()
  })

  it('shows a still frame under reduced motion', () => {
    const matchMedia = vi.fn(() => ({ matches: true }))
    vi.stubGlobal('matchMedia', matchMedia)
    const { container } = render(<PetCharacter state="WORKING" label="pet" />)
    const first = container.querySelector('img')!.getAttribute('src')
    act(() => { vi.advanceTimersByTime(1000) })
    expect(container.querySelector('img')!.getAttribute('src')).toBe(first)
    vi.unstubAllGlobals()
  })
})

describe('PetOverlay', () => {
  it('leaves only a restore handle when the Host hides the pet', () => {
    const { props, controller } = setup({ connected: true, snapshot: snapshot({ visible: false }) })
    render(<PetOverlay {...props} />)
    expect(screen.queryByRole('button', { name: /characterLabel/u })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'showPet' }))
    expect(controller.show).toHaveBeenCalled()
  })

  it('opens the bubble on click and acknowledges an unseen result', () => {
    const { props, controller } = setup({
      connected: true,
      snapshot: snapshot({
        primary: 'WORKING', focusSessionId: S1,
        sessions: [sessionView(S1, { state: 'WORKING', activity: 'test', title: 'Fix CI', progress: { completed: 1, total: 3 }, unseenResult: true })],
        jobs: [{ jobId: JobId('j'), owner: S1, label: 'x', kind: 'shell', startedAt: 1 }],
      }),
    })
    render(<PetOverlay {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /characterLabel/u }))
    expect(screen.getByText('activity.test')).toBeTruthy()
    expect(screen.getByText('Fix CI')).toBeTruthy()
    expect(screen.getByText('progress:1,3')).toBeTruthy()
    expect(screen.getByText('jobs:1')).toBeTruthy()
    expect(controller.acknowledge).toHaveBeenCalledWith(S1)
    fireEvent.click(screen.getByText('openMain'))
    fireEvent.click(screen.getByText('hide'))
    expect(controller.openMain).toHaveBeenCalled()
    expect(controller.hide).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /characterLabel/u }))
    expect(screen.queryByText('openMain')).toBeNull()
  })

  it('arms approval buttons after the delay, ignores Enter, and reports the decision', async () => {
    const { props, controller } = setup({
      connected: true,
      snapshot: snapshot({ primary: 'WAITING', pending: [{ ...hostPending('r1', S1, 'bash', 'c1'), reason: 'rm -rf build' }, hostPending('r2', S1, 'write')] }),
    }, [local])
    controller.decide.mockResolvedValueOnce('already-settled')
    render(<PetOverlay {...props} />)
    expect(screen.getByText('rm -rf build')).toBeTruthy()
    expect(screen.getByText('pendingMore:1')).toBeTruthy()
    const allow = screen.getByText('allowOnce') as HTMLButtonElement
    expect(allow.disabled).toBe(true)
    act(() => { vi.advanceTimersByTime(APPROVAL_ARM_DELAY_MS) })
    expect(allow.disabled).toBe(false)
    const enter = fireEvent.keyDown(allow, { key: 'Enter' })
    expect(enter).toBe(false)
    expect(fireEvent.keyDown(allow, { key: 'a' })).toBe(true)
    expect(controller.decide).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(allow) })
    expect(controller.decide).toHaveBeenCalledWith(local, 'allowed-once')
    expect(screen.getByText('alreadySettled')).toBeTruthy()
    controller.decide.mockResolvedValueOnce('failed')
    await act(async () => { fireEvent.click(screen.getByText('reject')) })
    expect(screen.getByText('decisionFailed')).toBeTruthy()
  })

  it('does not acknowledge a focused Session without an unseen result', () => {
    const { props, controller } = setup({ connected: true, snapshot: snapshot({ focusSessionId: S1, sessions: [sessionView(S1)] }) })
    render(<PetOverlay {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /characterLabel/u }))
    expect(controller.acknowledge).not.toHaveBeenCalled()
  })

  it('points to the main window when this Client cannot answer', () => {
    const { props } = setup({ connected: true, snapshot: snapshot({ pending: [hostPending('r', S1, 'bash', 'zz')] }) }, [local])
    render(<PetOverlay {...props} />)
    expect(screen.getByText('approvalElsewhere')).toBeTruthy()
  })
})

describe('QuestionCard', () => {
  const branch = { id: 'q1', question: 'Which branch?', options: [{ label: 'main' }, { label: 'dev', description: 'unstable' }] }

  it('opens the bubble and answers a single question with one armed click', async () => {
    const question = asked([branch])
    const { props, controller } = setup({ connected: true, snapshot: snapshot() }, [], [question])
    render(<PetOverlay {...props} />)
    expect(screen.getByText('questionTitle', { selector: 'div' })).toBeTruthy()
    const main = screen.getByText('main') as HTMLButtonElement
    expect(main.disabled).toBe(true)
    act(() => { vi.advanceTimersByTime(APPROVAL_ARM_DELAY_MS) })
    await act(async () => { fireEvent.click(main) })
    expect(controller.answerQuestion).toHaveBeenCalledWith(question, { q1: 'main' })
    expect(screen.getByText('questionAnswered')).toBeTruthy()
    expect(main.disabled).toBe(true)
  })

  it('collects several choices before submitting and reports a lost answer', async () => {
    const question = asked([{ ...branch, header: 'Git' }, { id: 'q2', question: 'Run tests?', options: [{ label: 'yes' }] }])
    const { props, controller } = setup({ connected: true, snapshot: snapshot() }, [], [question])
    controller.answerQuestion.mockResolvedValueOnce('failed')
    render(<PetOverlay {...props} />)
    expect(screen.getByText('Git: Which branch?')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(APPROVAL_ARM_DELAY_MS) })
    const submit = screen.getByText('questionSubmit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.click(screen.getByText('dev'))
    expect(screen.getByText('dev').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByText('yes'))
    expect(controller.answerQuestion).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(submit) })
    expect(controller.answerQuestion).toHaveBeenCalledWith(question, { q1: 'dev', q2: 'yes' })
    expect(screen.getByText('questionFailed')).toBeTruthy()
  })

  it('sends free-text questions to the main window and yields to approvals', () => {
    const { props, controller } = setup({ connected: true, snapshot: snapshot() }, [], [asked([{ id: 'q', question: 'Why?' }])])
    render(<PetOverlay {...props} />)
    expect(screen.getByText('questionInMain')).toBeTruthy()
    fireEvent.click(screen.getAllByText('openMain')[0]!)
    expect(controller.openMain).toHaveBeenCalled()
    cleanup()
    const busy = setup({ connected: true, snapshot: snapshot({ pending: [hostPending('r', S1, 'bash', 'c1')] }) }, [local], [asked([branch])])
    render(<PetOverlay {...busy.props} />)
    expect(screen.queryByText('Which branch?')).toBeNull()
  })
})

describe('QuickAsk', () => {
  it('sends text and dropped files, then clears them', async () => {
    const { props, controller } = setup({ connected: true, snapshot: snapshot({ pending: [hostPending('r', S1, 'x')] }) })
    render(<PetOverlay {...props} />)
    const form = screen.getByRole('form')
    const file = new File(['a'], 'a.txt')
    fireEvent.dragOver(form)
    expect(screen.getByText('dropHint')).toBeTruthy()
    fireEvent.dragLeave(form)
    fireEvent.drop(form, { dataTransfer: { files: [] } })
    fireEvent.drop(form, { dataTransfer: { files: [file, new File(['b'], 'b.txt')] } })
    fireEvent.click(screen.getByLabelText('removeFile:b.txt'))
    expect(screen.queryByText('b.txt')).toBeNull()
    const box = screen.getAllByLabelText('quickAskLabel')[1] as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'run tests' } })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'new' } })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'last' } })
    await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }) })
    expect(controller.ask).toHaveBeenCalledWith('run tests', [file], 'last', expect.any(AbortSignal))
    expect(screen.getByText('sent')).toBeTruthy()
    expect(box.value).toBe('')
    expect(screen.queryByText('a.txt')).toBeNull()
  })

  it('shows failures, keeps Shift+Enter for new lines, and ignores empty asks', async () => {
    const { props, controller } = setup({ connected: true, snapshot: snapshot({ pending: [hostPending('r', S1, 'x')] }) })
    render(<PetOverlay {...props} />)
    const box = screen.getAllByLabelText('quickAskLabel')[1] as HTMLTextAreaElement
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(controller.ask).not.toHaveBeenCalled()
    controller.ask.mockResolvedValueOnce({ ok: false, stage: 'empty' })
    await act(async () => { fireEvent.click(screen.getByText('send')) })
    expect(screen.getByRole('status').textContent).toBe('')
    controller.ask.mockResolvedValueOnce({ ok: false, stage: 'prompt' })
    await act(async () => { fireEvent.submit(screen.getByRole('form')) })
    expect(screen.getByText('sendFailed')).toBeTruthy()
    let release!: (value: { ok: true; sessionId: typeof S1 }) => void
    controller.ask.mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
    await act(async () => { fireEvent.submit(screen.getByRole('form')) })
    expect(screen.getByText('sending')).toBeTruthy()
    fireEvent.change(box, { target: { value: 'typing while sending' } })
    await act(async () => { fireEvent.submit(screen.getByRole('form')) })
    expect(controller.ask).toHaveBeenCalledTimes(3)
    await act(async () => { release({ ok: true, sessionId: S1 }) })
    fireEvent.change(box, { target: { value: 'again' } })
    expect(screen.getByRole('status').textContent).toBe('')
  })
})

describe('PetMenu', () => {
  it('opens on right-click in the page, offers quick ask and hide, and closes on Escape', () => {
    const { props, controller } = setup({ connected: true, snapshot: snapshot() })
    render(<PetOverlay {...props} />)
    const character = screen.getByRole('button', { name: /characterLabel/u })
    expect(fireEvent.contextMenu(character)).toBe(false)
    expect(screen.queryByText('menu.openMain')).toBeNull()
    expect(document.activeElement).toBe(screen.getByText('menu.quickAsk'))
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'a' })
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.contextMenu(character)
    fireEvent.contextMenu(character)
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.contextMenu(character)
    fireEvent.click(screen.getByText('menu.quickAsk'))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(screen.getAllByLabelText('quickAskLabel')[1])
    fireEvent.contextMenu(character)
    fireEvent.click(screen.getByText('menu.hide'))
    expect(controller.hide).toHaveBeenCalled()
  })

  it('offers the main window inside the Desktop pet window', () => {
    const { props, controller } = setup({ connected: true, snapshot: snapshot() })
    render(<PetWindowRoot {...props} onQuickAsk={() => () => {}} />)
    fireEvent.contextMenu(screen.getByRole('button', { name: /characterLabel/u }))
    fireEvent.click(screen.getByText('menu.openMain'))
    expect(controller.openMain).toHaveBeenCalled()
  })
})

describe('PetMenu notifications', () => {
  it('offers notification and do-not-disturb toggles when the platform can notify', () => {
    const sink: NotificationSink = { permission: () => 'granted', request: async () => 'granted', show: vi.fn() }
    const { props, controller, preferences } = setup({ connected: true, snapshot: snapshot() }, [], [], sink)
    render(<PetOverlay {...props} />)
    const character = screen.getByRole('button', { name: /characterLabel/u })
    fireEvent.contextMenu(character)
    expect(screen.queryByText('menu.snooze')).toBeNull()
    fireEvent.click(screen.getByText('menu.notifyOn'))
    expect(controller.setNotify).toHaveBeenLastCalledWith(true)
    act(() => { preferences.update({ notify: true }) })
    fireEvent.contextMenu(character)
    fireEvent.click(screen.getByText('menu.snooze'))
    expect(controller.snooze).toHaveBeenCalled()
    fireEvent.contextMenu(character)
    fireEvent.click(screen.getByText('menu.resume'))
    expect(controller.resume).toHaveBeenCalled()
    fireEvent.contextMenu(character)
    fireEvent.click(screen.getByText('menu.notifyOff'))
    expect(controller.setNotify).toHaveBeenLastCalledWith(false)
  })
})

describe('PetWindowRoot', () => {
  it('passes clicks through outside the pet and opens on the global shortcut', () => {
    const { props, controller } = setup({ connected: false, snapshot: undefined })
    let fire: (() => void) | undefined
    const onQuickAsk = vi.fn((listener: () => void) => { fire = listener; return () => { fire = undefined } })
    const { container, unmount } = render(<PetWindowRoot {...props} onQuickAsk={onQuickAsk} />)
    expect(controller.setInteractive).toHaveBeenLastCalledWith(false)
    const stack = container.querySelector('[data-surface="window"] > div')!
    fireEvent.mouseEnter(stack)
    expect(controller.setInteractive).toHaveBeenLastCalledWith(true)
    fireEvent.mouseLeave(stack)
    expect(controller.setInteractive).toHaveBeenLastCalledWith(false)
    expect(screen.queryByRole('form')).toBeNull()
    act(() => { fire?.() })
    expect(screen.getByRole('form')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getAllByLabelText('quickAskLabel')[1])
    fireEvent.click(screen.getByRole('button', { name: /characterLabel/u }))
    expect(screen.queryByRole('form')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /characterLabel/u }))
    expect(screen.getByRole('form')).toBeTruthy()
    unmount()
    expect(fire).toBeUndefined()
  })

  it('renders nothing while hidden and re-shows the pet on the quick-ask shortcut', () => {
    const { props, controller, viewStore } = setup({ connected: true, snapshot: snapshot({ visible: false }) })
    let fire: (() => void) | undefined
    const { container } = render(<PetWindowRoot {...props} onQuickAsk={(listener) => { fire = listener; return () => {} }} />)
    expect(container.innerHTML).toBe('')
    act(() => { fire?.() })
    expect(controller.show).toHaveBeenCalledOnce()
    act(() => { viewStore.set({ connected: true, snapshot: snapshot({ visible: true }) }) })
    expect(screen.getByRole('form')).toBeTruthy()
    act(() => { fire?.() })
    expect(controller.show).toHaveBeenCalledOnce()
  })
})
