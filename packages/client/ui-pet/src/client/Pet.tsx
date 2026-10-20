/** Studio Pet character, bubble, approval card, and quick ask. */
import { useEffect, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent, type PointerEvent, type CSSProperties, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { PetAgentState, PetMotionView, PetPendingApproval, PetSessionView } from '@deepseek-ai/dsh-pet/types'
import { matchApproval, type AnswerableApproval, type PetDecisionResult } from './approvals.ts'
import type { PetController, QuickAskChoice } from './controller.ts'
import { petAnswerable, type AnswerableQuestion, type PetAnswerResult } from './questions.ts'
import { BUILTIN_FRAME_SET, clipFor, type PetFrameSet } from './frames.ts'
import { isSnoozed, throwEnabled, type PetPreferences } from './preferences.ts'
import type { PetDragPhase } from './surface.ts'
import { displayedState, isPetVisible, type PetViewState } from './store.ts'
import { PetMotion, type PetWalkSurface } from './PetMotion.tsx'
import { hasTravelPhases } from './useMotionPhases.ts'
import { pickPetLine, petMomentTriggers, type PetLine } from '@deepseek-ai/dsh-pet/lines'
import {
  AREA_ACTION, availableActions, balanceTier, clickArea, clickClip, clipAction, eventClip, PET_ACTIONS, petIsIdle, type PetAction,
  type PetActionRequest, type PetClickArea,
} from './motion.ts'
import type { PetBalanceReading } from './metrics-slot.ts'
import { Button, Menu, MenuItemButton, MenuSurface } from '@deepseek-ai/dsh-client-ui-primitives'
import { usePagePosition } from './usePagePosition.ts'
import { PET_BODY_ATTRIBUTE, useDesktopThrow } from './useDesktopThrow.ts'
import css from './Pet.module.css'

/** Milliseconds the approval buttons stay disabled after a card appears, against accidental clicks. */
export const APPROVAL_ARM_DELAY_MS = 800

/** Pointer travel in CSS pixels before pressing the character becomes a window drag instead of a click. */
export const PET_DRAG_THRESHOLD_PX = 4

/** Values the pet registrations inject. */
export interface PetInjected {
  /** Shared pet actions. */
  controller: PetController
  hooks: {
    /** Host pet snapshot mirror. */
    view: ObservableSnapshot<PetViewState>
    /** Answerable approvals of this Client. */
    approvals: ObservableSnapshot<readonly AnswerableApproval[]>
    /** Unanswered questions of this Client. */
    questions: ObservableSnapshot<readonly AnswerableQuestion[]>
    /** Device-local preferences. */
    preferences: ObservableSnapshot<PetPreferences>
    /** Native autonomous movement, owned by the surface registration. */
    movement: ObservableSnapshot<{ moving: boolean; direction: 'left' | 'right' }>
    /** Character pack being rendered: the built-in pack or a Host-offered development pack. */
    pack: ObservableSnapshot<PetFrameSet>
  }
}

/** Props of both pet surfaces. */
export type PetProps = PropsLocale<'pet'> & InjectFace<PetInjected> & PropsRenderSlots<'pet.panel.metrics'>

type T = PetProps['t']

/**
 * Pointer handlers that turn a primary-button press moved past the threshold into a drag,
 * and swallow the click that ends it.
 * @param onDrag - drag reporter; `undefined` disables dragging.
 * @param onClick - click action for presses that did not drag.
 * @returns props for the character button.
 */
function useCharacterDrag(onDrag: ((phase: PetDragPhase) => void) | undefined, onClick: (() => void) | undefined) {
  const press = useRef<{ readonly x: number; readonly y: number; dragging: boolean } | undefined>(undefined)
  const dragged = useRef(false)
  const finish = (): void => {
    const current = press.current
    press.current = undefined
    if (current?.dragging !== true) return
    dragged.current = true
    onDrag?.('end')
  }
  return {
    onClick: () => {
      if (dragged.current) dragged.current = false
      else onClick?.()
    },
    ...onDrag === undefined ? {} : {
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
        dragged.current = false
        if (event.button !== 0) return
        press.current = { x: event.screenX, y: event.screenY, dragging: false }
        event.currentTarget.setPointerCapture?.(event.pointerId)
      },
      onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
        const current = press.current
        if (current === undefined) return
        if (!current.dragging) {
          if (Math.hypot(event.screenX - current.x, event.screenY - current.y) < PET_DRAG_THRESHOLD_PX) return
          current.dragging = true
          onDrag('start')
        }
        onDrag('move')
      },
      onPointerUp: finish,
      onPointerCancel: finish,
      onLostPointerCapture: finish,
    },
  }
}

/**
 * Animated character for one state; reduced motion shows the first frame only.
 * @param props - state, accessible label, and the click, menu, and drag actions.
 */
export function PetCharacter({
  state, label, name, onClick, onMenu, onDrag, pack = BUILTIN_FRAME_SET, badge, action, preferences,
  paused = false, activity, onInteract, movement, walk, festivals,
}: {
  readonly state: PetAgentState
  readonly label: string
  readonly name?: string
  /** Pack to render; defaults to the built-in pack. */
  readonly pack?: PetFrameSet
  /** Visible marker under the character, e.g. for a development pack. */
  readonly badge?: string | undefined
  readonly action?: PetActionRequest | undefined
  readonly preferences?: PetPreferences | undefined
  readonly movement?: { moving: boolean; direction: 'left' | 'right' } | undefined
  readonly paused?: boolean | undefined
  readonly activity?: import('@deepseek-ai/dsh-pet/types').PetWorkActivity | undefined
  readonly onClick?: () => void
  readonly onInteract?: ((action: PetAction) => void) | undefined
  readonly onMenu?: () => void
  /** Desktop pet window only: dragging the character moves the window. */
  readonly onDrag?: (phase: PetDragPhase) => void
  /** Surface movement for walking clips. */
  readonly walk?: PetWalkSurface | undefined
  /** Festivals covering the Host's local date, for time-bound clips. */
  readonly festivals?: readonly string[] | undefined
}): ReactNode {
  const clip = clipFor(state)
  const frames = pack.frames[clip]
  const loop = pack.loops?.[clip] ?? true
  const [dragging, setDragging] = useState(false)
  const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const area = useRef<PetAction>('poke')
  useEffect(() => () => { if (clickTimer.current !== undefined) clearTimeout(clickTimer.current) }, [])
  const click = (): void => {
    if (preferences?.interactive !== true || onInteract === undefined || !playingMotion) { onClick?.(); return }
    if (clickTimer.current !== undefined) clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(() => { clickTimer.current = undefined; onInteract(area.current) }, 240)
  }
  const [failedMotion, setFailedMotion] = useState<string | undefined>(undefined)
  const pointer = useCharacterDrag(onDrag === undefined ? undefined : (phase) => {
    setDragging(phase !== 'end')
    onDrag(phase)
  }, click)
  const [index, setIndex] = useState(0)
  const playingMotion = pack.motion !== undefined && failedMotion !== pack.key
  useEffect(() => {
    setIndex(0)
    if (playingMotion) return
    let timer: ReturnType<typeof setInterval> | undefined
    const started = Date.now()
    const stop = (): void => {
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
    }
    const motion = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : undefined
    const update = (): void => {
      const frame = Math.floor((Date.now() - started) * pack.fps / 1000)
      setIndex(loop ? frame % frames.length : Math.min(frame, frames.length - 1))
      if (!loop && frame >= frames.length - 1) stop()
    }
    const resume = (): void => {
      stop()
      if (motion?.matches === true || preferences?.reducedMotion === true || document.hidden) { setIndex(0); return }
      update()
      if (loop || Date.now() - started < frames.length * 1000 / pack.fps) {
        timer = setInterval(update, Math.ceil(1000 / pack.fps))
      }
    }
    resume()
    document.addEventListener('visibilitychange', resume)
    motion?.addEventListener?.('change', resume)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', resume)
      motion?.removeEventListener?.('change', resume)
    }
  }, [frames, pack.fps, loop, playingMotion, preferences?.reducedMotion])
  const swimMotion = playingMotion && hasTravelPhases(pack.motion)
  return (
    <button type="button" className={css.character} data-state={state} data-life={petIsIdle(state) ? preferences?.life ?? 'idle' : 'work'} data-reduced={preferences?.reducedMotion === true} aria-label={label} title={name ?? label} style={{ '--pet-scale': (preferences?.size ?? 100) / 100 } as CSSProperties} {...pointer}
      onPointerUpCapture={(event) => {
        const visual = event.currentTarget.querySelector<HTMLElement>('video, [data-pet-sprite], img')
        const bounds = (visual ?? event.currentTarget).getBoundingClientRect()
        const y = (event.clientY - bounds.top) / Math.max(1, bounds.height)
        area.current = AREA_ACTION[clickArea(y)]
      }}
      onDoubleClick={() => {
        if (preferences?.interactive !== true || !playingMotion) return
        if (clickTimer.current !== undefined) clearTimeout(clickTimer.current)
        onInteract?.('headPat')
      }}
      aria-haspopup={onMenu === undefined ? undefined : 'menu'}
      onContextMenu={onMenu === undefined ? undefined : (event) => { event.preventDefault(); onMenu() }}>
      <span className={css.characterVisual} {...{ [PET_BODY_ATTRIBUTE]: '' }} data-moving={movement?.moving === true && preferences?.reducedMotion !== true && !swimMotion}
        data-direction={movement?.direction}>
        {pack.motion !== undefined && playingMotion
          ? <PetMotion motion={pack.motion} state={state} activity={activity} action={action} dragging={dragging}
            movement={movement} poster={frames[0]} walk={walk} festivals={festivals}
            preferences={preferences ?? { notify: false, snoozeUntil: undefined }} paused={paused}
            onFailure={() => { setFailedMotion(pack.key) }} />
          : <img src={frames[index % frames.length]} alt="" draggable={false} /> }
      </span>
      {badge !== undefined && <span className={css.badge}>{badge}</span>}
    </button>
  )
}

function stateLine(t: T, state: PetAgentState, focus: PetSessionView | undefined): string {
  if (state === 'WORKING' && focus?.activity !== undefined) return t(`activity.${focus.activity}`)
  return t(`state.${state}`)
}

/**
 * One approval with a delayed arm; Enter never approves. A tool the pet
 * settings restrict points to the main window instead of offering buttons.
 * @param props - Host approval, local presentation, decision callback, and main-window action.
 */
export function ApprovalCard({ t, pending, local, more, decide, openMain }: {
  readonly t: T
  readonly pending: PetPendingApproval
  readonly local: AnswerableApproval | undefined
  readonly more: number
  readonly decide: (approval: AnswerableApproval, outcome: 'allowed-once' | 'rejected') => Promise<PetDecisionResult>
  readonly openMain: () => void
}): ReactNode {
  const [armed, setArmed] = useState(false)
  const [result, setResult] = useState<PetDecisionResult | undefined>(undefined)
  useEffect(() => {
    setArmed(false)
    setResult(undefined)
    const timer = setTimeout(() => { setArmed(true) }, APPROVAL_ARM_DELAY_MS)
    return () => { clearTimeout(timer) }
  }, [pending.id])
  const answer = (approval: AnswerableApproval, outcome: 'allowed-once' | 'rejected'): void => {
    void decide(approval, outcome).then(setResult)
  }
  const swallowEnter = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'Enter') event.preventDefault()
  }
  return (
    <div className={css.approval} role="alertdialog" aria-label={t('approvalTitle', { toolName: pending.toolName })}>
      <div className={css.approvalTitle}>{t('approvalTitle', { toolName: pending.toolName })}</div>
      {pending.reason !== undefined && <div className={css.approvalReason}>{pending.reason}</div>}
      {pending.restrictedInPet
        ? (
          <div className={css.actions}>
            <span className={css.note}>{t('approvalRestricted')}</span>
            <Button size="sm" type="button" onClick={openMain}>{t('openMain')}</Button>
          </div>
        )
        : local === undefined
          ? <div className={css.note}>{t('approvalElsewhere')}</div>
          : (
            <div className={css.actions}>
              <Button size="sm" type="button" disabled={!armed} onClick={() => { answer(local, 'rejected') }} onKeyDown={swallowEnter}>{t('reject')}</Button>
              <Button size="sm" type="button" className={css.primary} disabled={!armed} onClick={() => { answer(local, 'allowed-once') }} onKeyDown={swallowEnter}>{t('allowOnce')}</Button>
            </div>
          )}
      {result === 'already-settled' && <div className={css.note}>{t('alreadySettled')}</div>}
      {result === 'failed' && <div className={css.note}>{t('decisionFailed')}</div>}
      {more > 0 && <div className={css.note}>{t('pendingMore', { count: String(more) })}</div>}
    </div>
  )
}

/**
 * One `ask_user_question` request. Single-choice option questions are answered
 * here after the same arm delay as approvals; anything else points to the main window.
 * @param props - copy, request, answer callback, and main-window action.
 */
export function QuestionCard({ t, question, answer, openMain }: {
  readonly t: T
  readonly question: AnswerableQuestion
  readonly answer: (question: AnswerableQuestion, selections: Readonly<Record<string, string>>) => Promise<PetAnswerResult>
  readonly openMain: () => void
}): ReactNode {
  const [armed, setArmed] = useState(false)
  const [selections, setSelections] = useState<Readonly<Record<string, string>>>({})
  const [result, setResult] = useState<PetAnswerResult | undefined>(undefined)
  useEffect(() => {
    setArmed(false)
    setSelections({})
    setResult(undefined)
    const timer = setTimeout(() => { setArmed(true) }, APPROVAL_ARM_DELAY_MS)
    return () => { clearTimeout(timer) }
  }, [question.key])
  const quick = petAnswerable(question)
  const complete = question.questions.every(item => selections[item.id] !== undefined)
  const submit = (next: Readonly<Record<string, string>>): void => {
    void answer(question, next).then(setResult)
  }
  const choose = (id: string, label: string): void => {
    const next = { ...selections, [id]: label }
    setSelections(next)
    // A single question submits on its one click; several questions wait for the submit button.
    if (question.questions.length === 1) submit(next)
  }
  return (
    <div className={css.approval} role="alertdialog" aria-label={t('questionTitle')}>
      <div className={css.approvalTitle}>{t('questionTitle')}</div>
      {question.questions.map(item => (
        <div key={item.id} className={css.question}>
          <div className={css.approvalReason}>{item.header !== undefined ? `${item.header}: ${item.question}` : item.question}</div>
          {quick && (
            <div className={css.options}>
              {item.options?.map(option => (
                <Button size="sm" key={option.label} type="button" title={option.description} disabled={!armed || result === 'answered'}
                  aria-pressed={selections[item.id] === option.label}
                  onClick={() => { choose(item.id, option.label) }}>{option.label}</Button>
              ))}
            </div>
          )}
        </div>
      ))}
      {!quick && (
        <div className={css.actions}>
          <span className={css.note}>{t('questionInMain')}</span>
          <Button size="sm" type="button" onClick={openMain}>{t('openMain')}</Button>
        </div>
      )}
      {quick && question.questions.length > 1 && (
        <div className={css.actions}>
          <Button size="sm" type="button" className={css.primary} disabled={!armed || !complete || result === 'answered'}
            onClick={() => { submit(selections) }}>{t('questionSubmit')}</Button>
        </div>
      )}
      {result === 'answered' && <div className={css.note}>{t('questionAnswered')}</div>}
      {result === 'failed' && <div className={css.note}>{t('questionFailed')}</div>}
    </div>
  )
}

type SendStatus = 'idle' | 'sending' | 'sent' | 'failed'

/**
 * Quick prompt with file drop.
 * @param props - copy, controller, and an autofocus request counter.
 */
export function QuickAsk({ t, controller, focusRequest }: {
  readonly t: T
  readonly controller: PetController
  readonly focusRequest: number
}): ReactNode {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<readonly File[]>([])
  const [choice, setChoice] = useState<QuickAskChoice>('last')
  const [targetMenu, setTargetMenu] = useState(false)
  const [status, setStatus] = useState<SendStatus>('idle')
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (focusRequest > 0) input.current?.focus()
  }, [focusRequest])
  const submit = (event?: FormEvent): void => {
    event?.preventDefault()
    if (status === 'sending') return
    setStatus('sending')
    void controller.ask(text, files, choice, new AbortController().signal).then((outcome) => {
      if (outcome.ok) {
        setText('')
        setFiles([])
        setStatus('sent')
      } else {
        setStatus(outcome.stage === 'empty' ? 'idle' : 'failed')
      }
    })
  }
  const onDrop = (event: DragEvent<HTMLFormElement>): void => {
    event.preventDefault()
    setDragging(false)
    const dropped = [...event.dataTransfer.files]
    if (dropped.length > 0) setFiles(current => [...current, ...dropped])
  }
  return (
    <form
      className={css.quickAsk}
      data-dragging={dragging}
      aria-label={t('quickAskLabel')}
      onSubmit={submit}
      onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
      onDragLeave={() => { setDragging(false) }}
      onDrop={onDrop}
    >
      <textarea
        ref={input}
        value={text}
        rows={2}
        placeholder={t('quickAskPlaceholder')}
        aria-label={t('quickAskLabel')}
        onChange={(event) => { setText(event.target.value); if (status !== 'sending') setStatus('idle') }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) submit(event)
        }}
      />
      {files.length > 0 && (
        <ul className={css.files}>
          {files.map((file, index) => (
            <li key={`${file.name}-${String(index)}`}>
              <span>{file.name}</span>
              <Button size="sm" type="button" aria-label={t('removeFile', { name: file.name })}
                onClick={() => { setFiles(current => current.filter((_, at) => at !== index)) }}>×</Button>
            </li>
          ))}
        </ul>
      )}
      <div className={css.askRow}>
        <Menu open={targetMenu} side="top" compact autoFocus selectedId={choice}
          anchor={<Button size="sm" aria-haspopup="menu" aria-expanded={targetMenu}
            onClick={() => { setTargetMenu(current => !current) }}>{t(choice === 'new' ? 'targetNew' : 'targetLast')}</Button>}
          items={[{ id: 'last', label: t('targetLast') }, { id: 'new', label: t('targetNew') }]}
          onSelect={(id) => { setChoice(id === 'new' ? 'new' : 'last'); setTargetMenu(false) }}
          onClose={() => { setTargetMenu(false) }} />
        <span className={css.status} role="status">
          {status === 'sending' ? t('sending') : status === 'sent' ? t('sent') : status === 'failed' ? t('sendFailed') : dragging ? t('dropHint') : ''}
        </span>
        <Button size="sm" type="submit" className={css.primary} disabled={status === 'sending'}>{t('send')}</Button>
      </div>
    </form>
  )
}

/**
 * Bubble content: focused Session line, approval card, quick ask, and controls.
 * @param props - pet props plus the quick-ask focus counter.
 */
export function PetPanel(
  {
    t, controller, useView, useApprovals, useQuestions, focusRequest, onClose, panelVisible = true, renderSlot,
    balanceRequest, reportBalance,
  }:
  PetProps & {
    readonly focusRequest: number
    readonly onClose?: () => void
    readonly panelVisible?: boolean
    /** Counter of balance requests, passed to the metrics owners. */
    readonly balanceRequest?: number
    /** Receives the metrics owners' balance readings. */
    readonly reportBalance?: (readings: readonly PetBalanceReading[]) => void
  },
): ReactNode {
  const view = useView(value => value)
  const approvals = useApprovals(value => value)
  const question = useQuestions(value => value[0])
  const state = displayedState(view)
  const snapshot = view.snapshot
  const focus = snapshot?.sessions.find(entry => entry.sessionId === snapshot.focusSessionId)
  const pending = snapshot?.pending ?? []
  const first = pending[0]
  return (
    <div className={css.panel}>
      <div className={css.line}>
        {onClose && <Button size="sm" type="button" aria-label={t('closePanel')} onClick={onClose}>×</Button>}
        <strong>{stateLine(t, state, focus)}</strong>
        {focus !== undefined && <span className={css.meta}>{focus.title ?? focus.project ?? ''}</span>}
        {focus?.progress !== undefined && (
          <span className={css.meta}>{t('progress', { completed: String(focus.progress.completed), total: String(focus.progress.total) })}</span>
        )}
        {snapshot !== undefined && snapshot.jobs.length > 0 && (
          <span className={css.meta}>{t('jobs', { count: String(snapshot.jobs.length) })}</span>
        )}
      </div>
      {first !== undefined && (
        <ApprovalCard t={t} pending={first} local={matchApproval(first, approvals)} more={pending.length - 1}
          decide={(approval, outcome) => controller.decide(approval, outcome)} openMain={() => { controller.openMain(first.sessionId) }} />
      )}
      {first === undefined && question !== undefined && (
        <QuestionCard t={t} question={question} openMain={() => { controller.openMain(question.sessionId) }}
          answer={(target, selections) => controller.answerQuestion(target, selections)} />
      )}
      {renderSlot('pet.panel.metrics', {
        visible: panelVisible, sessionId: focus?.sessionId, taskState: state,
        ...balanceRequest === undefined ? {} : { balanceRequest }, ...reportBalance === undefined ? {} : { reportBalance },
      })}
      <QuickAsk t={t} controller={controller} focusRequest={focusRequest} />
      <div className={css.controls}>
        <Button size="sm" type="button" onClick={() => { controller.openMain() }}>{t('openMain')}</Button>
        <Button size="sm" type="button" onClick={() => { void controller.hide() }}>{t('hide')}</Button>
      </div>
    </div>
  )
}

/** One right-click menu action. */
export type PetMenuAction = PetAction | 'actions' | 'balance' | 'lifeIdle' | 'lifeRest' | 'lifePlay' | 'quickAsk' | 'openMain' | 'notifyOn'
  | 'notifyOff' | 'snooze' | 'resume' | 'hide'

/** One action category of the menu, with its clips, in display language. */
export interface PetMenuCategory {
  readonly id: string
  readonly label: string
  readonly clips: readonly { readonly clip: string; readonly label: string }[]
}

/**
 * Menu categories from the pack's motion description: named actions use the
 * Client dictionary, other clips the pack label, and absent clips are left out.
 * @param motion - available character media.
 * @param t - dictionary lookup; its `locale` entry selects the pack label language.
 * @returns non-empty categories in pack order.
 */
export function petMenuCategories(motion: PetMotionView | undefined, t: T): readonly PetMenuCategory[] {
  const language = t('locale') === 'en' ? 'en' : 'zh'
  return (motion?.categories ?? []).map(category => ({
    id: category.id,
    label: category.label[language],
    clips: category.clips.filter(clip => motion?.clips[clip] !== undefined).map((clip) => {
      const action = clipAction(clip)
      return { clip, label: action !== undefined ? t(`menu.${action}`) : motion?.clips[clip]?.label?.[language] ?? clip }
    }),
  })).filter(category => category.clips.length > 0)
}

/**
 * Right-click menu of the character. Escape or a click on an item closes it;
 * the Actions item opens category and clip levels with a way back.
 * @param props - copy, action handler, optional categories with clip handler, and close callback.
 */
export function PetMenu({ t, actions, onAction, categories = [], onClip, onClose }: {
  readonly t: T
  readonly actions: readonly PetMenuAction[]
  readonly onAction: (action: PetMenuAction) => void
  readonly categories?: readonly PetMenuCategory[]
  readonly onClip?: (clip: string) => void
  readonly onClose: () => void
}): ReactNode {
  const menuRef = useRef<HTMLDivElement>(null)
  // undefined: top level; '': category list; otherwise the open category id.
  const [level, setLevel] = useState<string | undefined>(undefined)
  const category = categories.find(entry => entry.id === level)
  useEffect(() => { menuRef.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus() }, [level])
  useEffect(() => {
    const outside = (event: globalThis.PointerEvent): void => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) onClose()
    }
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])
  return (
    <MenuSurface ref={menuRef} className={css.menu} role="menu" aria-label={t('menuLabel')}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : event.key === 'ArrowDown' ? (index + 1) % buttons.length
            : event.key === 'ArrowUp' ? (index + buttons.length - 1) % buttons.length : undefined
        if (next !== undefined) { event.preventDefault(); buttons[next]?.focus() }
      }}>
      {level === undefined && actions.map(action => (
        <MenuItemButton key={action} onSelect={() => { if (action === 'actions') setLevel(''); else { onClose(); onAction(action) } }}>{t(`menu.${action}`)}</MenuItemButton>
      ))}
      {level !== undefined && (
        <MenuItemButton key="back" onSelect={() => { setLevel(category === undefined ? undefined : '') }}>{t('menu.back')}</MenuItemButton>
      )}
      {level === '' && categories.map(entry => (
        <MenuItemButton key={entry.id} onSelect={() => { setLevel(entry.id) }}>{entry.label}</MenuItemButton>
      ))}
      {category?.clips.map(entry => (
        <MenuItemButton key={entry.clip} onSelect={() => { onClose(); onClip?.(entry.clip) }}>{entry.label}</MenuItemButton>
      ))}
    </MenuSurface>
  )
}

interface PanelState {
  readonly open: boolean
  readonly toggle: () => void
  readonly close: () => void
  readonly state: PetAgentState
  readonly visible: boolean
  readonly waiting: boolean
  readonly focusRequest: number
  readonly menu: boolean
  readonly setMenu: (open: boolean) => void
  readonly act: (action: PetMenuAction) => void
  readonly actions: (desktop: boolean) => readonly PetMenuAction[]
  readonly categories: readonly PetMenuCategory[]
  readonly playClip: (clip: string) => void
  readonly action: PetActionRequest | undefined
  readonly interact: (action: PetAction) => void
  readonly balanceRequest: number
  readonly reportBalance: (readings: readonly PetBalanceReading[]) => void
  /** Line the pet speaks now, in the dictionary language. */
  readonly line: string | undefined
}

/** Milliseconds a balance request waits for a reading before the pet says none is available. */
export const PET_BALANCE_WAIT_MS = 15000

/** Built-in interaction of a body area, reversed. */
const ACTION_AREA: ReadonlyMap<PetAction, PetClickArea> = new Map(
  Object.entries(AREA_ACTION).map(([area, action]) => [action, area as PetClickArea]),
)

function usePanel(props: PetProps): PanelState {
  const preferences = props.usePreferences(value => value)
  const motion = props.usePack(pack => pack.motion)
  const hasMotion = motion !== undefined
  const view = props.useView(value => value)
  const [open, setOpen] = useState(false)
  const [focusRequest, setFocusRequest] = useState(0)
  const [menu, setMenu] = useState(false)
  const [action, setAction] = useState<PetActionRequest | undefined>(undefined)
  const state = displayedState(view)
  const questionKey = props.useQuestions(value => value[0]?.key)
  const pendingId = view.snapshot?.pending[0]?.id
  const pendingKey = pendingId !== undefined ? `approval:${pendingId}` : questionKey !== undefined ? `question:${questionKey}` : undefined
  const waiting = pendingKey !== undefined
  const [dismissed, setDismissed] = useState<typeof pendingKey>(undefined)
  const shown = open || waiting && dismissed !== pendingKey
  const close = (): void => { setOpen(false); setDismissed(pendingKey); document.querySelector<HTMLButtonElement>('[data-pet-root] button[data-state]')?.focus() }
  useEffect(() => {
    if (!shown || menu) return
    const escape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return
      event.preventDefault(); setOpen(false); setDismissed(pendingKey)
      document.querySelector<HTMLButtonElement>('[data-pet-root] button[data-state]')?.focus()
    }
    const outside = (event: globalThis.PointerEvent): void => {
      if (event.target instanceof Element && event.target.closest('[data-pet-root]')) return
      setOpen(false); setDismissed(pendingKey)
    }
    document.addEventListener('keydown', escape)
    document.addEventListener('pointerdown', outside)
    return () => { document.removeEventListener('keydown', escape); document.removeEventListener('pointerdown', outside) }
  }, [shown, menu, pendingKey])
  const focus = view.snapshot?.focusSessionId
  const toggle = (): void => {
    if (shown) close(); else setOpen(true)
    if (focus !== undefined && view.snapshot?.sessions.some(entry => entry.sessionId === focus && entry.unseenResult) === true) {
      void props.controller.acknowledge(focus)
    }
  }
  const lastClick = useRef<string | undefined>(undefined)
  const play = (clip: string, interrupt: boolean): void => {
    const named = clipAction(clip)
    setAction(previous => ({
      ...named === undefined ? { clip } : { action: named }, serial: (previous?.serial ?? 0) + 1, ...interrupt ? { interrupt } : {},
    }))
  }
  const interact = (action: PetAction): void => {
    const area = ACTION_AREA.get(action)
    if (area === undefined || motion?.clicks?.[area] === undefined) {
      setAction(previous => ({ action, serial: (previous?.serial ?? 0) + 1 }))
      return
    }
    lastClick.current = clickClip(motion, area, Math.random, lastClick.current)
    play(lastClick.current, false)
  }
  const speech = usePetLines(props, { state, quiet: shown || menu, waiting: pendingKey, whisper: (clip) => { play(clip, false) } })
  const [balanceRequest, setBalanceRequest] = useState(0)
  const balanceDeadline = useRef(0)
  useEffect(() => {
    if (balanceRequest === 0) return
    const timer = setTimeout(() => {
      if (balanceDeadline.current === 0) return
      balanceDeadline.current = 0
      speech.say(props.t('balanceUnavailable'))
    }, PET_BALANCE_WAIT_MS)
    return () => { clearTimeout(timer) }
  }, [balanceRequest])
  const reportBalance = (readings: readonly PetBalanceReading[]): void => {
    if (balanceDeadline.current === 0 || Date.now() > balanceDeadline.current) return
    balanceDeadline.current = 0
    const urgent = readings.filter(reading => Number.isFinite(reading.usedPercent))
      .reduce<PetBalanceReading | undefined>(
        (most, reading) => most === undefined || reading.usedPercent > most.usedPercent ? reading : most, undefined)
    if (urgent === undefined) { speech.say(props.t('balanceUnavailable')); return }
    const clip = eventClip(motion, 'balance', balanceTier(urgent.usedPercent), Math.random)
    if (clip !== undefined) play(clip, true)
    speech.say(urgent.label)
  }
  const act = (action: PetMenuAction): void => {
    if (PET_ACTIONS.includes(action as PetAction)) {
      setAction(previous => ({ action: action as PetAction, serial: (previous?.serial ?? 0) + 1, interrupt: true }))
    } else if (action === 'balance') {
      balanceDeadline.current = Date.now() + PET_BALANCE_WAIT_MS
      setBalanceRequest(current => current + 1)
    } else if (action === 'lifeIdle' || action === 'lifeRest' || action === 'lifePlay') {
      props.controller.setPreferences({ life: action === 'lifeRest' ? 'rest' : action === 'lifePlay' ? 'play' : 'idle' })
    } else if (action === 'quickAsk') {
      toggle()
      if (!shown) setFocusRequest(current => current + 1)
    } else if (action === 'openMain') {
      props.controller.openMain()
    } else if (action === 'notifyOn' || action === 'notifyOff') {
      void props.controller.setNotify(action === 'notifyOn')
    } else if (action === 'snooze') {
      props.controller.snooze()
    } else if (action === 'resume') {
      props.controller.resume()
    } else {
      void props.controller.hide()
    }
  }
  const categories = petMenuCategories(motion, props.t)
  const playClip = (clip: string): void => { play(clip, true) }
  const actions = (desktop: boolean): readonly PetMenuAction[] => {
    const list: PetMenuAction[] = ['quickAsk', 'lifeIdle', 'lifeRest', 'lifePlay']
    if (hasMotion && petIsIdle(state) && !open && !waiting) {
      list.push(...categories.length > 0 ? ['actions' as const] : availableActions(motion))
      if (motion?.events?.balance !== undefined) list.push('balance')
    }
    if (desktop) list.push('openMain')
    if (props.controller.canNotify) {
      list.push(preferences.notify ? 'notifyOff' : 'notifyOn')
      if (preferences.notify) list.push(isSnoozed(preferences, Date.now()) ? 'resume' : 'snooze')
    }
    list.push('hide')
    return list
  }
  return {
    open: shown, toggle, close, state, visible: isPetVisible(view), waiting, focusRequest, menu, setMenu, act, actions,
    categories, playClip, action, interact, balanceRequest, reportBalance, line: speech.line,
  }
}

/** How long a spoken line stays in the bubble, in milliseconds. */
export const PET_LINE_MS = 8000

/** Continuous idle time after which the pet speaks one idle line, in milliseconds. */
export const PET_IDLE_LINE_MS = 20 * 60 * 1000

interface SpokenLine {
  readonly text: PetLine | string
  /** Kept until its cause ends (a waiting approval) instead of timing out. */
  readonly hold: boolean
  readonly serial: number
}

/**
 * Lines the pet speaks from the pack's local table, never from a model:
 * the time-of-day slot or festival when it changes (including the first
 * moment after start) while idle, `turn.success` or `turn.error` when a task
 * ends, `approval.waiting` while an approval or question waits, and
 * `idle.long` once per long idle stretch, with a pack whisper clip when the
 * pack has one. A trigger while a panel or menu is open is skipped, never
 * queued; the `lines` preference turns all of them off.
 * @param props - pet props.
 * @param context - displayed state, whether a panel or menu is open, the waiting request, and the whisper clip player.
 * @returns the line in the dictionary language while it is shown, and a way to say a ready-made text.
 */
function usePetLines(props: PetProps, { state, quiet, waiting, whisper }: {
  readonly state: PetAgentState
  readonly quiet: boolean
  readonly waiting: string | undefined
  readonly whisper: (clip: string) => void
}): { readonly line: string | undefined; readonly say: (text: string) => void } {
  const table = props.usePack(pack => pack.lines)
  const motion = props.usePack(pack => pack.motion)
  const enabled = props.usePreferences(preferences => preferences.lines !== false)
  const moment = props.useView(view => view.snapshot?.moment)
  const key = moment === undefined ? undefined : `${moment.slot}:${moment.festival?.id ?? ''}:${moment.festival?.phase ?? ''}`
  const [spoken, setSpoken] = useState<SpokenLine | undefined>(undefined)
  const last = useRef<{ key?: string; line?: PetLine }>({})
  const idle = petIsIdle(state)
  const show = (text: PetLine | string, hold = false): void => {
    setSpoken(previous => ({ text, hold, serial: (previous?.serial ?? 0) + 1 }))
  }
  const speak = (triggers: readonly string[], hold = false): boolean => {
    if (table === undefined) return false
    const pick = pickPetLine(table, triggers, Math.random, last.current.line)
    if (pick === undefined) return false
    last.current.line = pick.line
    show(pick.line, hold)
    return true
  }
  useEffect(() => {
    // Wait for the pack's table, which may arrive after the first snapshot.
    if (key === undefined || moment === undefined || table === undefined || key === last.current.key) return
    last.current.key = key
    if (enabled && idle && !quiet && waiting === undefined) speak(petMomentTriggers(moment))
  }, [key, table])
  const previousState = useRef(state)
  useEffect(() => {
    if (previousState.current === state) return
    previousState.current = state
    // Any other state change ends the line shown; the waiting effect below speaks for a new request.
    if (!enabled || quiet || (state !== 'SUCCESS' && state !== 'ERROR') || !speak([state === 'SUCCESS' ? 'turn.success' : 'turn.error'])) {
      setSpoken(undefined)
    }
  }, [state])
  useEffect(() => {
    if (waiting === undefined) setSpoken(current => current?.hold === true ? undefined : current)
    else if (enabled) speak(['approval.waiting'], true)
  }, [waiting])
  useEffect(() => {
    if (!enabled || !idle || quiet || waiting !== undefined || table === undefined) return
    const timer = setTimeout(() => {
      if (!speak(['idle.long'])) return
      const candidates = (motion?.events?.whisper ?? []).filter(name => motion?.clips[name] !== undefined)
      const clip = candidates[Math.min(candidates.length - 1, Math.floor(Math.random() * candidates.length))]
      if (clip !== undefined) whisper(clip)
    }, PET_IDLE_LINE_MS)
    return () => { clearTimeout(timer) }
  }, [enabled, idle, quiet, waiting, table, motion])
  useEffect(() => {
    if (spoken === undefined || spoken.hold) return
    const timer = setTimeout(() => { setSpoken(undefined) }, PET_LINE_MS)
    return () => { clearTimeout(timer) }
  }, [spoken])
  useEffect(() => {
    if (!enabled) setSpoken(undefined)
    else if (quiet) setSpoken(current => current?.hold === true ? current : undefined)
  }, [quiet, enabled])
  const language = props.t('locale') === 'en' ? 'en' : 'zh'
  return {
    line: spoken === undefined ? undefined : typeof spoken.text === 'string' ? spoken.text : spoken.text[language],
    say: (text) => { show(text) },
  }
}

/** Compact, event-derived status when the full panel is collapsed; a spoken local line takes its place while shown. */
function PetStatus({ state, useView, t, line }: Pick<PetProps, 'useView' | 't'> & {
  state: PetAgentState
  line?: string | undefined
}): ReactNode {
  const focus = useView(view => view.snapshot?.sessions.find(session => session.sessionId === view.snapshot?.focusSessionId))
  if (line !== undefined) return <div className={css.statusBubble} role="status" data-pet-line="">{line}</div>
  if (petIsIdle(state)) return null
  return <div className={css.statusBubble} role="status">{stateLine(t, state, focus)}</div>
}

/** Follow the system reduced-motion setting. */
function useSystemReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true)
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const changed = (): void => { setReduced(query?.matches === true) }
    query?.addEventListener?.('change', changed)
    return () => { query?.removeEventListener?.('change', changed) }
  }, [])
  return reduced
}

/**
 * Whether idle wandering glides the whole character: a frame-only pack bobs while it glides, a motion pack needs
 * its travel clips (`swim_*`). Packs without them move only through walking clips with measured travel.
 * @param pack - active pack.
 * @returns whether gliding is available.
 */
function glides(pack: PetFrameSet): boolean {
  return pack.motion === undefined || hasTravelPhases(pack.motion)
}

/**
 * In-page character anchored to the bottom-right corner of the Web shell.
 * @param props - pet props.
 */
export function PetOverlay(props: PetProps): ReactNode {
  const {
    open, toggle, close, state, visible, focusRequest, menu, setMenu, act, actions, categories, playClip, action, interact,
    balanceRequest, reportBalance, line,
  } = usePanel(props)
  const pack = props.usePack(current => current)
  const preferences = props.usePreferences(current => current)
  const festivals = props.useView(view => view.snapshot?.moment?.festivals)
  const activity = props.useView(view =>
    view.snapshot?.sessions.find(session => session.sessionId === view.snapshot?.focusSessionId)?.activity)
  const systemReduced = useSystemReducedMotion()
  const roaming = visible && preferences.roam === true && preferences.reducedMotion !== true && petIsIdle(state) && !open && !menu
  // Gliding needs the travel clips (or a frame-only pack); otherwise only walking clips move the character.
  const position = usePagePosition(roaming && glides(pack) && preferences.life !== 'rest', preferences.size ?? 100,
    preferences.activity ?? 'normal',
    throwEnabled(preferences, systemReduced))
  const walk: PetWalkSurface = {
    allowed: roaming && !systemReduced && !position.flying, room: position.room, travel: position.travel,
  }
  if (!visible) {
    // Only a Host snapshot can hide the pet. Web has no tray or global shortcut, so leave a small handle to bring it back.
    return (
      <div className={css.overlay} data-surface="page">
        <button type="button" className={css.restore} aria-label={props.t('showPet')} title={props.t('showPet')}
          onClick={() => { void props.controller.show() }}>🐋</button>
      </div>
    )
  }
  return (
    <div className={`${css.overlay} ${css.positioned}`} data-surface="page" data-pet-root="" data-below={position.below} style={{ ...position.style, '--pet-scale': (preferences.size ?? 100) / 100 } as CSSProperties}
      onPointerDownCapture={(event) => { position.begin(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect()) }}
      onPointerMoveCapture={(event) => { position.track(event.clientX, event.clientY) }}>
      <div className={css.pagePanels}>
        {!open && <PetStatus state={state} useView={props.useView} t={props.t} line={line} />}
        <div hidden={!open} className={css.panelMount}>
          <PetPanel {...props} focusRequest={focusRequest} onClose={close} panelVisible={open} balanceRequest={balanceRequest}
            reportBalance={reportBalance} />
        </div>
        {menu && <PetMenu t={props.t} actions={actions(false)} onAction={act} categories={categories} onClip={playClip}
          onClose={() => { setMenu(false) }} />}
      </div>
      <PetCharacter state={state} name={preferences.name?.trim() || props.t('defaultName')} label={props.t('characterLabel', { name: preferences.name?.trim() || props.t('defaultName'), state: props.t(`state.${state}`) })} onClick={toggle}
        onMenu={() => { setMenu(!menu) }} onDrag={position.drag} walk={walk} movement={{ moving: position.wandering, direction: position.direction }} onInteract={interact} action={action} preferences={preferences} paused={open || menu} activity={activity} pack={pack} badge={pack.dev ? props.t('devPack') : undefined}
        festivals={festivals} />
    </div>
  )
}

/**
 * Whole-document root inside the Desktop pet window: transparent, click-through
 * outside the character and bubble, and synced to the Host visibility.
 * @param props - pet props plus the Desktop quick-ask subscription.
 */
export function PetWindowRoot(props: PetProps & { readonly onQuickAsk: (listener: () => void) => () => void }): ReactNode {
  const {
    open, toggle, close, state, visible, focusRequest: menuFocus, menu, setMenu, act, actions, categories, playClip, action,
    interact, balanceRequest, reportBalance, line,
  } = usePanel(props)
  const { controller, onQuickAsk } = props
  const movement = props.useMovement(value => value)
  const pack = props.usePack(current => current)
  const preferences = props.usePreferences(current => current)
  const festivals = props.useView(view => view.snapshot?.moment?.festivals)
  const activity = props.useView(view =>
    view.snapshot?.sessions.find(session => session.sessionId === view.snapshot?.focusSessionId)?.activity)
  const shortcutAction = useRef(act)
  shortcutAction.current = act
  const systemReduced = useSystemReducedMotion()
  const thrower = useDesktopThrow(controller, controller.canThrow && throwEnabled(preferences, systemReduced), preferences.size ?? 100)
  const walk: PetWalkSurface = {
    allowed: controller.canWalk && preferences.roam === true && preferences.reducedMotion !== true && !systemReduced && !thrower.flying
      && movement.moving !== true,
    room: thrower.room,
    travel: (dx, final) => { controller.travel(dx, final) },
  }
  const passive = !open && !menu
  const showing = open || menu || line !== undefined || !petIsIdle(state)
  useEffect(() => { controller.reveal(showing, passive) }, [controller, showing, passive, state, line])
  const drag = (phase: PetDragPhase): void => {
    if (phase === 'start') { close(); setMenu(false) }
    thrower.drag(phase)
  }
  const glide = glides(pack)
  const visibleNow = useRef(visible)
  visibleNow.current = visible
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const update = (): void => {
      const allowed = visible && preferences.roam === true && preferences.reducedMotion !== true && glide
        && petIsIdle(state) && preferences.life !== 'rest' && !open && !menu && !document.hidden && query?.matches !== true
      controller.wander(allowed, preferences.activity ?? 'normal')
    }
    update()
    query?.addEventListener?.('change', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      query?.removeEventListener?.('change', update)
      document.removeEventListener('visibilitychange', update)
      controller.wander(false)
    }
  }, [controller, visible, preferences.roam, preferences.reducedMotion, state, open, menu, preferences.life, preferences.activity, glide])
  useEffect(() => onQuickAsk(() => {
    // The shortcut is also the way back after "hide": it re-shows the pet through the Host setting.
    if (!visibleNow.current) void controller.show()
    shortcutAction.current('quickAsk')
  }), [onQuickAsk, controller])
  useEffect(() => { if (!open && !menu) controller.setInteractive(false) }, [controller, open, menu])
  const interactive = (on: boolean): void => { controller.setInteractive(on) }
  if (!visible) return null
  return (
    <div className={css.window} data-surface="window" data-pet-root="" style={{ '--pet-character-height': `${112 * (preferences.size ?? 100) / 100}px` } as CSSProperties}>
      <div className={css.windowStack} onMouseEnter={() => { interactive(true) }} onMouseMove={() => { interactive(true) }}
        onMouseLeave={() => { interactive(false) }} onPointerMoveCapture={(event) => { thrower.track(event) }}>
        <div className={css.desktopPanels}>
          {!open && <PetStatus state={state} useView={props.useView} t={props.t} line={line} />}
          <div hidden={!open} className={css.panelMount}>
            <PetPanel {...props} focusRequest={menuFocus} onClose={close} panelVisible={open} balanceRequest={balanceRequest}
              reportBalance={reportBalance} />
          </div>
          {menu && <PetMenu t={props.t} actions={actions(true)} onAction={act} categories={categories} onClip={playClip}
            onClose={() => { setMenu(false) }} />}
        </div>
        <PetCharacter state={state} name={preferences.name?.trim() || props.t('defaultName')} label={props.t('characterLabel', { name: preferences.name?.trim() || props.t('defaultName'), state: props.t(`state.${state}`) })}
          onClick={toggle} onMenu={() => { setMenu(!menu) }}
          movement={movement} onDrag={drag} walk={walk} onInteract={interact} action={action} preferences={preferences} paused={open || menu} activity={activity} pack={pack} badge={pack.dev ? props.t('devPack') : undefined}
          festivals={festivals} />
      </div>
    </div>
  )
}
