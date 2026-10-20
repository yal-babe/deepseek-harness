// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { AnswerableApproval } from '../src/client/approvals.ts'
import { PetController } from '../src/client/controller.ts'
import type { AnswerableQuestion } from '../src/client/questions.ts'
import { APPROVAL_ARM_DELAY_MS, PET_BALANCE_WAIT_MS, PET_IDLE_LINE_MS, PET_LINE_MS, PetCharacter, PetOverlay, PetWindowRoot, petMenuCategories, type PetProps } from '../src/client/Pet.tsx'
import type { PetViewState } from '../src/client/store.ts'
import type { PetMotionView } from '@deepseek-ai/dsh-pet/types'
import { BUILTIN_FRAME_SET, type PetFrameSet } from '../src/client/frames.ts'
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
    openSession: () => {},
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
    drag: vi.spyOn(controller, 'drag').mockImplementation(() => {}),
    reveal: vi.spyOn(controller, 'reveal').mockImplementation(() => {}),
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
  const packStore = createSnapshotStore<PetFrameSet>(BUILTIN_FRAME_SET, { flush: 'sync' })
  const movementStore = createSnapshotStore<{ moving: boolean; direction: 'left' | 'right' }>({ moving: false, direction: 'right' }, { flush: 'sync' })
  const props: PetProps = {
    t, controller, renderSlot: () => null, useView: hook(viewStore), useApprovals: hook(approvalStore), useQuestions: hook(questionStore),
    usePreferences: hook(preferences.snapshot), usePack: hook(packStore), useMovement: hook(movementStore),
  }
  return { props, controller, viewStore, approvalStore, questionStore, preferences, packStore, movementStore }
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
  it('holds a non-looping final frame and resumes correctly after the page becomes visible', () => {
    const pack = { ...BUILTIN_FRAME_SET, loops: { ...BUILTIN_FRAME_SET.loops!, success: false } }
    const { container } = render(<PetCharacter state="SUCCESS" label="pet" pack={pack} />)
    act(() => { vi.advanceTimersByTime(2000) })
    expect(container.querySelector('img')!.getAttribute('src')).toBe(pack.frames.success.at(-1))
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    fireEvent(document, new Event('visibilitychange'))
    expect(container.querySelector('img')!.getAttribute('src')).toBe(pack.frames.success[0])
    hidden.mockReturnValue(false)
    fireEvent(document, new Event('visibilitychange'))
    expect(container.querySelector('img')!.getAttribute('src')).toBe(pack.frames.success.at(-1))
    hidden.mockRestore()
  })

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
  it('navigates the context menu with arrow keys and dismisses it outside', () => {
    const { props } = setup({ connected: true, snapshot: snapshot() })
    render(<PetOverlay {...props} />)
    fireEvent.contextMenu(screen.getByRole('button', { name: /characterLabel/u }))
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'End' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'menu.hide' }))
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'menu.quickAsk' }))
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'menu.hide' }))
    fireEvent.keyDown(menu, { key: 'Home' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'menu.quickAsk' }))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('persists a Web drag, restores it, and keeps the character origin when opening its panel', () => {
    window.localStorage.clear()
    const { props } = setup({ connected: true, snapshot: snapshot() })
    const mounted = render(<PetOverlay {...props} />)
    const character = screen.getByRole('button', { name: /characterLabel/u })
    const surface = character.parentElement!
    const startX = Number.parseFloat(surface.style.left)
    const startY = Number.parseFloat(surface.style.top)
    fireEvent.pointerDown(character, { button: 0, clientX: 100, clientY: 100, screenX: 100, screenY: 100, pointerId: 3 })
    fireEvent.pointerMove(character, { clientX: 110, clientY: 110, screenX: 110, screenY: 110 })
    fireEvent.pointerMove(character, { clientX: 50, clientY: 50, screenX: 50, screenY: 50 })
    fireEvent.pointerUp(character)
    fireEvent.click(character)
    expect(screen.queryByRole('form')).toBeNull()
    const saved = JSON.parse(window.localStorage.getItem('dsh-pet:page-position')!)
    expect(saved).toEqual({ x: startX - 50, y: startY - 50 })
    fireEvent.click(character)
    expect(surface.style.left).toBe(`${saved.x}px`)
    expect(surface.style.top).toBe(`${saved.y}px`)
    mounted.unmount()
    render(<PetOverlay {...props} />)
    expect(screen.getByRole('button', { name: /characterLabel/u }).parentElement!.style.left).toBe(`${saved.x}px`)
    window.localStorage.clear()
  })

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
    expect(screen.queryByRole('button', { name: 'openMain' })).toBeNull()
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

  it('routes a tool restricted by the pet settings to the main window', () => {
    const pending = { ...hostPending('r', S1, 'bash', 'c1'), restrictedInPet: true }
    const { props, controller } = setup({ connected: true, snapshot: snapshot({ pending: [pending] }) }, [local])
    render(<PetOverlay {...props} />)
    expect(screen.getByText('approvalRestricted')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'allowOnce' })).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: 'openMain' })[0]!)
    expect(controller.openMain).toHaveBeenCalledWith(S1)
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
    expect(controller.openMain).toHaveBeenCalledWith(S1)
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
    fireEvent.click(screen.getByRole('button', { name: 'targetLast' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'targetNew' }))
    fireEvent.click(screen.getByRole('button', { name: 'targetNew' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'targetLast' }))
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
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'menu.quickAsk' }))
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

  it('marks a development pack on both surfaces', () => {
    const { props, packStore } = setup({ connected: true, snapshot: snapshot() })
    const view = render(<PetWindowRoot {...props} onQuickAsk={() => () => {}} />)
    expect(screen.queryByText('devPack')).toBeNull()
    act(() => { packStore.set({ ...BUILTIN_FRAME_SET, key: 'dev@0.1.0', dev: true }) })
    expect(screen.getByText('devPack')).toBeDefined()
    view.unmount()
    render(<PetOverlay {...props} />)
    expect(screen.getByText('devPack')).toBeDefined()
  })

  it('drags the Desktop pet window from the character', () => {
    const capture = vi.fn()
    HTMLElement.prototype.setPointerCapture = capture
    const { props, controller } = setup({ connected: true, snapshot: snapshot() })
    render(<PetWindowRoot {...props} onQuickAsk={() => () => {}} />)
    const character = screen.getByRole('button', { name: /characterLabel/u })
    fireEvent.pointerDown(character, { button: 0, screenX: 10, screenY: 10, pointerId: 3 })
    fireEvent.pointerMove(character, { screenX: 30, screenY: 10 })
    fireEvent.pointerUp(character)
    expect(controller.drag.mock.calls).toEqual([['start'], ['move'], ['end']])
    expect(capture).toHaveBeenCalledWith(3)
  })
})

describe('PetCharacter drag', () => {
  it('tells a click from a drag past the threshold and swallows the click that ends a drag', () => {
    HTMLElement.prototype.setPointerCapture = vi.fn()
    const onClick = vi.fn()
    const onDrag = vi.fn()
    render(<PetCharacter state="IDLE" label="pet" onClick={onClick} onDrag={onDrag} />)
    const character = screen.getByRole('button', { name: 'pet' })
    fireEvent.pointerMove(character, { screenX: 50, screenY: 50 })
    fireEvent.pointerDown(character, { button: 2, screenX: 0, screenY: 0 })
    fireEvent.pointerMove(character, { screenX: 50, screenY: 50 })
    fireEvent.pointerDown(character, { button: 0, screenX: 0, screenY: 0 })
    fireEvent.pointerMove(character, { screenX: 2, screenY: 2 })
    fireEvent.pointerUp(character)
    fireEvent.click(character)
    expect(onDrag).not.toHaveBeenCalled()
    expect(onClick).toHaveBeenCalledOnce()
    fireEvent.pointerDown(character, { button: 0, screenX: 0, screenY: 0 })
    fireEvent.pointerMove(character, { screenX: 0, screenY: 5 })
    fireEvent.pointerMove(character, { screenX: 0, screenY: 9 })
    fireEvent.pointerCancel(character)
    expect(onDrag.mock.calls).toEqual([['start'], ['move'], ['move'], ['end']])
    fireEvent.click(character)
    expect(onClick).toHaveBeenCalledOnce()
    fireEvent.click(character)
    expect(onClick).toHaveBeenCalledTimes(2)
    fireEvent.pointerDown(character, { button: 0, screenX: 0, screenY: 0 })
    fireEvent.pointerMove(character, { screenX: 9, screenY: 0 })
    fireEvent.pointerUp(character)
    fireEvent.pointerDown(character, { button: 0, screenX: 0, screenY: 0 })
    fireEvent.pointerUp(character)
    fireEvent.click(character)
    expect(onClick).toHaveBeenCalledTimes(3)
  })

  it('only clicks without a drag reporter', () => {
    render(<PetCharacter state="IDLE" label="pet" />)
    const character = screen.getByRole('button', { name: 'pet' })
    fireEvent.pointerDown(character, { button: 0 })
    fireEvent.click(character)
    expect(character).toBeDefined()
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
    // Opening the panel asks the main process to keep the whole window on screen; closing puts it back.
    expect(controller.reveal).toHaveBeenLastCalledWith(true, false)
    fireEvent.click(screen.getByRole('button', { name: /characterLabel/u }))
    expect(screen.queryByRole('form')).toBeNull()
    expect(controller.reveal).toHaveBeenLastCalledWith(false, true)
    fireEvent.click(screen.getByRole('button', { name: /characterLabel/u }))
    expect(screen.getByRole('form')).toBeTruthy()
    expect(controller.reveal).toHaveBeenCalledTimes(4)
    unmount()
    expect(fire).toBeUndefined()
  })

  it('asks Desktop to glide only for frame packs or packs with travel clips', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const { props, controller, packStore, preferences } = setup({ connected: true, snapshot: snapshot() })
    const wander = vi.spyOn(controller, 'wander').mockImplementation(() => {})
    preferences.update({ roam: true })
    render(<PetWindowRoot {...props} onQuickAsk={() => () => {}} />)
    expect(wander).toHaveBeenLastCalledWith(true, 'normal')
    const clip = (name: string) => ({ url: `/${name}.webm`, durationMs: 1000, loop: name.endsWith('loop') || name === 'idle' })
    act(() => { packStore.set({ ...BUILTIN_FRAME_SET, motion: { width: 412, height: 344, clips: { idle: clip('idle') } } }) })
    expect(wander).toHaveBeenLastCalledWith(false, 'normal')
    act(() => { packStore.set({ ...BUILTIN_FRAME_SET, motion: { width: 412, height: 344, clips: { idle: clip('idle'), swim_loop: clip('swim_loop') } } }) })
    expect(wander).toHaveBeenLastCalledWith(true, 'normal')
    vi.restoreAllMocks()
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

describe('pet panel and personalisation regressions', () => {
  it('closes without losing the quick-ask draft and focuses the character', () => {
    const { props } = setup({ connected: true, snapshot: snapshot() })
    render(<PetOverlay {...props} />)
    const character = screen.getByRole('button', { name: /characterLabel/u })
    fireEvent.click(character)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'keep this draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'closePanel' }))
    expect(screen.queryByRole('form')).toBeNull()
    expect(document.activeElement).toBe(character)
    fireEvent.click(character)
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('keep this draft')
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true })
    expect(screen.getByRole('form')).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('form')).toBeNull()
    fireEvent.click(character)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('form')).toBeNull()
  })

  it('can collapse a pending approval and reopens for a different request', () => {
    const { props, viewStore } = setup({ connected: true, snapshot: snapshot({
      primary: 'WAITING', pending: [hostPending('first', S1, 'bash')],
    }) })
    render(<PetOverlay {...props} />)
    expect(screen.getByRole('form')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'closePanel' }))
    expect(screen.queryByRole('form')).toBeNull()
    act(() => viewStore.set({ connected: true, snapshot: snapshot({
      primary: 'WAITING', pending: [hostPending('second', S1, 'bash')],
    }) }))
    expect(screen.getByRole('form')).toBeTruthy()
  })

  it('shows the custom name and shares life state changes with settings', () => {
    const { props, preferences } = setup({ connected: true, snapshot: snapshot() })
    preferences.update({ name: '小鱼', size: 150 })
    render(<PetOverlay {...props} />)
    const character = screen.getByRole('button', { name: /characterLabel/u })
    expect(character.title).toBe('小鱼')
    expect(character.style.getPropertyValue('--pet-scale')).toBe('1.5')
    fireEvent.contextMenu(character)
    fireEvent.click(screen.getByRole('menuitem', { name: 'menu.lifeRest' }))
    expect(preferences.snapshot.getSnapshot().life).toBe('rest')
    expect(character.getAttribute('data-life')).toBe('rest')
  })

  it('toggles the native shortcut without a second forced-open state', () => {
    const { props } = setup({ connected: true, snapshot: snapshot() })
    let shortcut: (() => void) | undefined
    render(<PetWindowRoot {...props} onQuickAsk={(listener) => { shortcut = listener; return () => { shortcut = undefined } }} />)
    act(() => shortcut?.())
    expect(screen.getByRole('form')).toBeTruthy()
    act(() => shortcut?.())
    expect(screen.queryByRole('form')).toBeNull()
  })
})

it('follows the injected native movement snapshot', () => {
  const { props, movementStore } = setup({ connected: true, snapshot: snapshot() })
  const view = render(<PetWindowRoot {...props} onQuickAsk={() => () => {}} />)
  act(() => { movementStore.set({ moving: true, direction: 'left' }) })
  expect(view.container.querySelector('[data-moving="true"][data-direction="left"]')).toBeTruthy()
  act(() => { movementStore.set({ moving: false, direction: 'left' }) })
  expect(view.container.querySelector('[data-moving="true"]')).toBeNull()
})

describe('category menu', () => {
  const clip = (name: string) => ({ url: `/${name}.webm`, durationMs: 1000, loop: name === 'idle' })
  const label = (zh: string, en: string) => ({ zh, en })
  const motion: PetMotionView = {
    width: 412, height: 344,
    clips: { idle: clip('idle'), head_pat: clip('head_pat'), click_shy: { ...clip('click_shy'), label: label('害羞惊讶', 'Shy surprise') } },
    categories: [
      { id: 'interact', label: label('互动', 'Interactions'), weight: 0, life: [], clips: ['head_pat', 'click_shy', 'absent'] },
      { id: 'empty', label: label('空', 'Empty'), weight: 0, life: [], clips: ['absent'] },
    ],
  }

  it('names categories and clips from the pack in the dictionary language and drops absent clips', () => {
    expect(petMenuCategories(motion, key => key === 'locale' ? 'en' : key)).toEqual([
      { id: 'interact', label: 'Interactions', clips: [{ clip: 'head_pat', label: 'menu.headPat' }, { clip: 'click_shy', label: 'Shy surprise' }] },
    ])
    expect(petMenuCategories(motion, t)[0]?.label).toBe('互动')
    expect(petMenuCategories(undefined, t)).toEqual([])
  })

  it('drills from actions to a category to a clip, goes back, and plays the chosen clip', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const { props, packStore } = setup({ connected: true, snapshot: snapshot() })
    packStore.set({ ...BUILTIN_FRAME_SET, motion })
    const view = render(<PetOverlay {...props} />)
    fireEvent.contextMenu(screen.getByRole('button', { name: /characterLabel/u }))
    expect(screen.queryByRole('menuitem', { name: 'menu.headPat' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'menu.actions' }))
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['menu.back', '互动'])
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'menu.back' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '互动' }))
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['menu.back', 'menu.headPat', '害羞惊讶'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'menu.back' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'menu.back' }))
    expect(screen.getByRole('menuitem', { name: 'menu.quickAsk' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'menu.actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '互动' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '害羞惊讶' }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(view.container.querySelector('[data-pet-clip]')?.getAttribute('data-pet-clip')).toBe('click_shy')
    vi.restoreAllMocks()
  })
})

describe('local lines', () => {
  const lines = { formatVersion: 2 as const, lines: {
    'greet.morning': [{ zh: '早上好', en: 'Good morning' }],
    'greet.noon': [{ zh: '午安', en: 'Good noon' }],
    'festival.national-day': [{ zh: '国庆快乐', en: 'Happy National Day' }],
  } }
  const morning = { date: '2026-10-19', slot: 'morning' as const, dayKind: 'workday' as const }

  it('speaks a line when the slot or festival changes, hides it after a while, and skips busy changes', () => {
    const { props, packStore, viewStore } = setup({ connected: true, snapshot: snapshot({ moment: morning }) })
    render(<PetOverlay {...props} />)
    expect(document.querySelector('[data-pet-line]')).toBeNull()
    act(() => { packStore.set({ ...BUILTIN_FRAME_SET, lines }) })
    expect(screen.getByRole('status').textContent).toBe('早上好')
    act(() => { vi.advanceTimersByTime(PET_LINE_MS) })
    expect(document.querySelector('[data-pet-line]')).toBeNull()
    act(() => { viewStore.set({ connected: true, snapshot: snapshot({ revision: 2, moment: morning }) }) })
    expect(document.querySelector('[data-pet-line]')).toBeNull()
    act(() => { viewStore.set({ connected: true, snapshot: snapshot({ revision: 3, moment: { ...morning, festival: { id: 'national-day', phase: 'during' } } }) }) })
    expect(screen.getByRole('status').textContent).toBe('国庆快乐')
    act(() => { viewStore.set({ connected: true, snapshot: snapshot({ revision: 4, primary: 'WORKING', moment: { ...morning, slot: 'noon' } }) }) })
    expect(document.querySelector('[data-pet-line]')).toBeNull()
    act(() => { viewStore.set({ connected: true, snapshot: snapshot({ revision: 5, moment: { ...morning, slot: 'noon' } }) }) })
    expect(document.querySelector('[data-pet-line]')).toBeNull()
  })

  const taskLines = { formatVersion: 2 as const, lines: {
    'turn.success': [{ zh: '搞定', en: 'Done' }],
    'turn.error': [{ zh: '出错了', en: 'Oops' }],
    'approval.waiting': [{ zh: '等你点头', en: 'Your call' }],
    'idle.long': [{ zh: '好闲', en: 'So idle' }],
  } }
  const line = () => document.querySelector('[data-pet-line]')?.textContent

  it('speaks task results, holds the approval line while it waits, and honors the lines switch', () => {
    const { props, packStore, viewStore, preferences } = setup({ connected: true, snapshot: snapshot() })
    packStore.set({ ...BUILTIN_FRAME_SET, lines: taskLines })
    render(<PetOverlay {...props} />)
    act(() => { viewStore.set({ connected: true, snapshot: snapshot({ revision: 2, primary: 'SUCCESS' }) }) })
    expect(line()).toBe('搞定')
    act(() => { viewStore.set({ connected: true, snapshot: snapshot({ revision: 3, primary: 'ERROR' }) }) })
    expect(line()).toBe('出错了')
    act(() => { viewStore.set({ connected: true, snapshot: snapshot({ revision: 4, primary: 'WORKING' }) }) })
    expect(line()).toBeUndefined()
    act(() => { viewStore.set({ connected: true, snapshot: snapshot({ revision: 5, primary: 'WAITING', pending: [hostPending('p', S1, 'bash')] }) }) })
    fireEvent.click(screen.getByRole('button', { name: 'closePanel' }))
    act(() => { vi.advanceTimersByTime(PET_LINE_MS * 2) })
    expect(line()).toBe('等你点头')
    act(() => { viewStore.set({ connected: true, snapshot: snapshot({ revision: 6, primary: 'WORKING' }) }) })
    expect(line()).toBeUndefined()
    act(() => { preferences.update({ lines: false }) })
    act(() => { viewStore.set({ connected: true, snapshot: snapshot({ revision: 7, primary: 'SUCCESS' }) }) })
    expect(line()).toBeUndefined()
  })

  it('speaks one idle line per long idle stretch and plays a whisper clip the pack has', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const clip = (name: string) => ({ url: `/${name}.webm`, durationMs: 1000, loop: name === 'idle' })
    const motion: PetMotionView = { width: 412, height: 344, clips: { idle: clip('idle'), whisper_a: clip('whisper_a') }, events: { whisper: ['whisper_a'] } }
    const { props, packStore } = setup({ connected: true, snapshot: snapshot() })
    packStore.set({ ...BUILTIN_FRAME_SET, lines: taskLines, motion })
    const view = render(<PetOverlay {...props} />)
    act(() => { vi.advanceTimersByTime(PET_IDLE_LINE_MS - 1) })
    expect(line()).toBeUndefined()
    act(() => { vi.advanceTimersByTime(1) })
    expect(line()).toBe('好闲')
    expect(view.container.querySelector('[data-pet-clip]')?.getAttribute('data-pet-clip')).toBe('whisper_a')
    act(() => { vi.advanceTimersByTime(PET_LINE_MS) })
    act(() => { vi.advanceTimersByTime(PET_IDLE_LINE_MS) })
    expect(line()).toBeUndefined()
    vi.restoreAllMocks()
  })
})

describe('balance and click responses', () => {
  const clip = (name: string) => ({ url: `/${name}.webm`, durationMs: 1000, loop: name === 'idle' })
  const names = ['idle', 'balance_full', 'balance_steady', 'balance_empty', 'head_pat', 'poke', 'click_bounce', 'tail']
  const motion: PetMotionView = {
    width: 412, height: 344, clips: Object.fromEntries(names.map(name => [name, clip(name)])),
    events: { balance: [['balance_full'], ['balance_full'], ['balance_steady'], ['balance_steady'], ['balance_steady'], ['balance_empty']] },
    clicks: { body: ['poke', 'click_bounce'] },
  }
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('asks the metrics owners for a balance, animates the most used reading, and times out without one', () => {
    const slot = vi.fn((_name: string, _props: Record<string, unknown>) => null)
    const { props, packStore } = setup({ connected: true, snapshot: snapshot() })
    packStore.set({ ...BUILTIN_FRAME_SET, motion })
    const view = render(<PetOverlay {...props} renderSlot={slot as unknown as PetProps['renderSlot']} />)
    const latest = () => slot.mock.calls.at(-1)![1] as { balanceRequest: number; reportBalance: (readings: unknown[]) => void }
    expect(latest().balanceRequest).toBe(0)
    fireEvent.contextMenu(screen.getByRole('button', { name: /characterLabel/u }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'menu.balance' }))
    expect(latest().balanceRequest).toBe(1)
    act(() => { latest().reportBalance([{ usedPercent: 50, label: 'DeepSeek ¥10' }, { usedPercent: 100, label: 'Codex 100%' }]) })
    expect(view.container.querySelector('[data-pet-clip]')?.getAttribute('data-pet-clip')).toBe('balance_empty')
    expect(document.querySelector('[data-pet-line]')?.textContent).toBe('Codex 100%')
    fireEvent.ended(view.container.querySelector('video')!)
    fireEvent.contextMenu(screen.getByRole('button', { name: /characterLabel/u }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'menu.balance' }))
    expect(latest().balanceRequest).toBe(2)
    act(() => { vi.advanceTimersByTime(PET_BALANCE_WAIT_MS) })
    expect(document.querySelector('[data-pet-line]')?.textContent).toBe('balanceUnavailable')
    act(() => { latest().reportBalance([{ usedPercent: 0, label: 'late' }]) })
    expect(document.querySelector('[data-pet-line]')?.textContent).toBe('balanceUnavailable')
  })

  it('offers the balance only for packs with balance tiers and reports an empty reading', () => {
    const slot = vi.fn((_name: string, _props: Record<string, unknown>) => null)
    const { props, packStore } = setup({ connected: true, snapshot: snapshot() })
    const withoutEvents = { ...motion }
    delete withoutEvents.events
    packStore.set({ ...BUILTIN_FRAME_SET, motion: withoutEvents })
    render(<PetOverlay {...props} renderSlot={slot as unknown as PetProps['renderSlot']} />)
    fireEvent.contextMenu(screen.getByRole('button', { name: /characterLabel/u }))
    expect(screen.queryByRole('menuitem', { name: 'menu.balance' })).toBeNull()
    fireEvent.contextMenu(screen.getByRole('button', { name: /characterLabel/u }))
    act(() => { packStore.set({ ...BUILTIN_FRAME_SET, motion }) })
    fireEvent.contextMenu(screen.getByRole('button', { name: /characterLabel/u }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'menu.balance' }))
    act(() => { (slot.mock.calls.at(-1)![1].reportBalance as (readings: unknown[]) => void)([]) })
    expect(document.querySelector('[data-pet-line]')?.textContent).toBe('balanceUnavailable')
  })

  it('answers an interactive body click with a pack click response', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const { props, packStore, preferences } = setup({ connected: true, snapshot: snapshot() })
    packStore.set({ ...BUILTIN_FRAME_SET, motion })
    preferences.update({ interactive: true })
    const view = render(<PetOverlay {...props} />)
    const character = screen.getByRole('button', { name: /characterLabel/u })
    const playing = () => view.container.querySelector('[data-pet-clip]')?.getAttribute('data-pet-clip')
    fireEvent.pointerUp(character, { clientY: 0.5 })
    fireEvent.click(character)
    act(() => { vi.advanceTimersByTime(300) })
    expect(playing()).toBe('poke')
    // Clicks closer together than the interaction cooldown are dropped, as before.
    fireEvent.ended(view.container.querySelector('video')!)
    act(() => { vi.advanceTimersByTime(1200) })
    fireEvent.pointerUp(character, { clientY: 0.5 })
    fireEvent.click(character)
    act(() => { vi.advanceTimersByTime(300) })
    expect(playing()).toBe('click_bounce')
    fireEvent.ended(view.container.querySelector('video')!)
    act(() => { vi.advanceTimersByTime(1200) })
    fireEvent.pointerUp(character, { clientY: 0.9 })
    fireEvent.click(character)
    act(() => { vi.advanceTimersByTime(300) })
    expect(playing()).toBe('tail')
  })
})
