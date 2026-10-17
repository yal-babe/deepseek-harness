/** Studio Pet character, bubble, approval card, and quick ask. */
import { useEffect, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { PetAgentState, PetPendingApproval, PetSessionView } from '@deepseek-ai/dsh-pet/types'
import { matchApproval, type AnswerableApproval, type PetDecisionResult } from './approvals.ts'
import type { PetController, QuickAskChoice } from './controller.ts'
import { clipFor, PET_FPS, PET_FRAMES } from './frames.ts'
import { displayedState, isPetVisible, type PetViewState } from './store.ts'
import css from './Pet.module.css'

/** Milliseconds the approval buttons stay disabled after a card appears, against accidental clicks. */
export const APPROVAL_ARM_DELAY_MS = 800

/** Values the pet registrations inject. */
export interface PetInjected {
  /** Shared pet actions. */
  controller: PetController
  hooks: {
    /** Host pet snapshot mirror. */
    view: ObservableSnapshot<PetViewState>
    /** Answerable approvals of this Client. */
    approvals: ObservableSnapshot<readonly AnswerableApproval[]>
  }
}

/** Props of both pet surfaces. */
export type PetProps = PropsLocale<'pet'> & InjectFace<PetInjected>

type T = PetProps['t']

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Animated character for one state; reduced motion shows the first frame only.
 * @param props - state and accessible label.
 */
export function PetCharacter({ state, label, onClick }: {
  readonly state: PetAgentState
  readonly label: string
  readonly onClick?: () => void
}): ReactNode {
  const frames = PET_FRAMES[clipFor(state)]
  const [index, setIndex] = useState(0)
  useEffect(() => {
    setIndex(0)
    if (prefersReducedMotion()) return undefined
    const timer = setInterval(() => { setIndex(current => (current + 1) % frames.length) }, 1000 / PET_FPS)
    return () => { clearInterval(timer) }
  }, [frames])
  return (
    <button type="button" className={css.character} data-state={state} aria-label={label} title={label} onClick={onClick}>
      <img src={frames[index % frames.length]} alt="" draggable={false} />
    </button>
  )
}

function stateLine(t: T, state: PetAgentState, focus: PetSessionView | undefined): string {
  if (state === 'WORKING' && focus?.activity !== undefined) return t(`activity.${focus.activity}`)
  return t(`state.${state}`)
}

/**
 * One approval with a delayed arm; Enter never approves.
 * @param props - Host approval, local presentation, and decision callback.
 */
export function ApprovalCard({ t, pending, local, more, decide }: {
  readonly t: T
  readonly pending: PetPendingApproval
  readonly local: AnswerableApproval | undefined
  readonly more: number
  readonly decide: (approval: AnswerableApproval, outcome: 'allowed-once' | 'rejected') => Promise<PetDecisionResult>
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
      {local === undefined
        ? <div className={css.note}>{t('approvalElsewhere')}</div>
        : (
          <div className={css.actions}>
            <button type="button" disabled={!armed} onClick={() => { answer(local, 'rejected') }} onKeyDown={swallowEnter}>{t('reject')}</button>
            <button type="button" className={css.primary} disabled={!armed} onClick={() => { answer(local, 'allowed-once') }} onKeyDown={swallowEnter}>{t('allowOnce')}</button>
          </div>
        )}
      {result === 'already-settled' && <div className={css.note}>{t('alreadySettled')}</div>}
      {result === 'failed' && <div className={css.note}>{t('decisionFailed')}</div>}
      {more > 0 && <div className={css.note}>{t('pendingMore', { count: String(more) })}</div>}
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
              <button type="button" aria-label={t('removeFile', { name: file.name })}
                onClick={() => { setFiles(current => current.filter((_, at) => at !== index)) }}>×</button>
            </li>
          ))}
        </ul>
      )}
      <div className={css.askRow}>
        <select value={choice} aria-label={t('quickAskLabel')} onChange={(event) => { setChoice(event.target.value === 'new' ? 'new' : 'last') }}>
          <option value="last">{t('targetLast')}</option>
          <option value="new">{t('targetNew')}</option>
        </select>
        <span className={css.status} role="status">
          {status === 'sending' ? t('sending') : status === 'sent' ? t('sent') : status === 'failed' ? t('sendFailed') : dragging ? t('dropHint') : ''}
        </span>
        <button type="submit" className={css.primary} disabled={status === 'sending'}>{t('send')}</button>
      </div>
    </form>
  )
}

/**
 * Bubble content: focused Session line, approval card, quick ask, and controls.
 * @param props - pet props plus the quick-ask focus counter.
 */
export function PetPanel({ t, controller, useView, useApprovals, focusRequest }: PetProps & { readonly focusRequest: number }): ReactNode {
  const view = useView(value => value)
  const approvals = useApprovals(value => value)
  const state = displayedState(view)
  const snapshot = view.snapshot
  const focus = snapshot?.sessions.find(entry => entry.sessionId === snapshot.focusSessionId)
  const pending = snapshot?.pending ?? []
  const first = pending[0]
  return (
    <div className={css.panel}>
      <div className={css.line}>
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
          decide={(approval, outcome) => controller.decide(approval, outcome)} />
      )}
      <QuickAsk t={t} controller={controller} focusRequest={focusRequest} />
      <div className={css.controls}>
        <button type="button" onClick={() => { controller.openMain() }}>{t('openMain')}</button>
        <button type="button" onClick={() => { void controller.hide() }}>{t('hide')}</button>
      </div>
    </div>
  )
}

function usePanel(props: PetProps): { open: boolean; toggle: () => void; state: PetAgentState; visible: boolean; waiting: boolean } {
  const view = props.useView(value => value)
  const [open, setOpen] = useState(false)
  const state = displayedState(view)
  const waiting = (view.snapshot?.pending.length ?? 0) > 0
  const focus = view.snapshot?.focusSessionId
  const toggle = (): void => {
    setOpen(current => !current)
    if (focus !== undefined && view.snapshot?.sessions.some(entry => entry.sessionId === focus && entry.unseenResult) === true) {
      void props.controller.acknowledge(focus)
    }
  }
  return { open: open || waiting, toggle, state, visible: isPetVisible(view), waiting }
}

/**
 * In-page character anchored to the bottom-right corner of the Web shell.
 * @param props - pet props.
 */
export function PetOverlay(props: PetProps): ReactNode {
  const { open, toggle, state, visible } = usePanel(props)
  if (!visible) return null
  return (
    <div className={css.overlay} data-surface="page">
      {open && <PetPanel {...props} focusRequest={0} />}
      <PetCharacter state={state} label={props.t('characterLabel', { state: props.t(`state.${state}`) })} onClick={toggle} />
    </div>
  )
}

/**
 * Whole-document root inside the Desktop pet window: transparent, click-through
 * outside the character and bubble, and synced to the Host visibility.
 * @param props - pet props plus the Desktop quick-ask subscription.
 */
export function PetWindowRoot(props: PetProps & { readonly onQuickAsk: (listener: () => void) => () => void }): ReactNode {
  const { open, toggle, state, visible } = usePanel(props)
  const [focusRequest, setFocusRequest] = useState(0)
  const [forced, setForced] = useState(false)
  const { controller, onQuickAsk } = props
  const visibleNow = useRef(visible)
  visibleNow.current = visible
  useEffect(() => onQuickAsk(() => {
    // The shortcut is also the way back after "hide": it re-shows the pet through the Host setting.
    if (!visibleNow.current) void controller.show()
    setForced(true)
    setFocusRequest(current => current + 1)
  }), [onQuickAsk, controller])
  useEffect(() => { controller.setInteractive(false) }, [controller])
  const interactive = (on: boolean): void => { controller.setInteractive(on) }
  if (!visible) return null
  return (
    <div className={css.window} data-surface="window">
      <div className={css.windowStack} onMouseEnter={() => { interactive(true) }} onMouseLeave={() => { interactive(false) }}>
        {(open || forced) && <PetPanel {...props} focusRequest={focusRequest} />}
        <PetCharacter state={state} label={props.t('characterLabel', { state: props.t(`state.${state}`) })}
          onClick={() => { if (forced) setForced(false); else toggle() }} />
      </div>
    </div>
  )
}
