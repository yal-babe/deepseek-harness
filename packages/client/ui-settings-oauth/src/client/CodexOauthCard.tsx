/** Codex and Antigravity sign-in controls on a Models provider card. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { OAuthAttemptView } from '@deepseek-ai/dsh-llm-oauth-bridge/types'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { OauthKey } from './locales.ts'
import styles from './CodexOauthCard.module.css'

/** Host operations injected into the Cordis-free OAuth account card. */
export interface CodexOauthInjected {
  /** Live attempt projection for this card's credential record. */
  hooks: { oauth: HostObservable<OAuthAttemptView> }
  /** @returns after the Host has claimed or refused the attempt. */
  start: () => Promise<void>
  /** @returns after cancellation is requested. */
  cancel: () => Promise<void>
  /** @returns after the local credential record is removed. */
  signOut: () => Promise<void>
  /**
   * @param value - typed text or chosen option id.
   * @returns after the prompt is handed to the flow.
   */
  answerPrompt: (value: string) => Promise<void>
  /** @returns after the decline is handed to the flow. */
  declinePrompt: () => Promise<void>
  /**
   * @param url - authorization URL from the current attempt.
   * @returns false when the browsing context was blocked.
   */
  openAuthorizeUrl: (url: string) => boolean
}

/** Composed OAuth account card props. */
export type CodexOauthCardProps =
  PropsRuntime<'settings.models.provider-card'>
  & PropsLocale<'settings.oauth'>
  & InjectFace<CodexOauthInjected>

/** Routes this card renders Sign in for. */
export const OAUTH_CARD_PROVIDERS = new Set(['openai-codex', 'antigravity'])

/**
 * Whether opening the authorize URL reached a browsing context.
 * @param handle - `window.open` return; Electron denies this and still opens the system browser.
 * @param protocol - document protocol; Desktop application pages use `dsh-app:`.
 * @returns true when the URL was handed to a browser.
 */
export function authorizeBrowsingContextOpened(handle: Window | null, protocol: string): boolean {
  return handle !== null || protocol === 'dsh-app:'
}

/**
 * Whether the card should keep Open sign-in page and Cancel instead of a paste
 * form. Codex races a loopback callback against a paste prompt; the authorize
 * URL is the path that completes login.
 * @param view - live attempt projection.
 * @returns true when an in-flight attempt still has an authorize URL.
 */
function awaitingBrowser(
  view: OAuthAttemptView,
): view is OAuthAttemptView & { authorizeUrl: string } {
  return view.inFlight && view.authorizeUrl !== undefined
    && (view.status === 'waiting-browser' || view.status === 'prompting')
}

function statusCopy(view: OAuthAttemptView, t: (key: OauthKey) => string, provider: string): string {
  const antigravity = provider === 'antigravity'
  if (view.inFlight && view.status === 'idle') return t('signingIn')
  if (awaitingBrowser(view)) return view.message ?? t('statusWaiting')
  switch (view.status) {
    case 'idle':
      return view.credentialConfigured
        ? t(antigravity ? 'statusAuthorizedAntigravity' : 'statusAuthorized')
        : t(antigravity ? 'statusIdleAntigravity' : 'statusIdle')
    case 'waiting-browser':
      return view.message ?? t('statusWaiting')
    case 'prompting':
      return view.prompt?.message ?? view.message ?? t('statusPrompting')
    case 'authorized':
      return t(antigravity ? 'statusAuthorizedAntigravity' : 'statusAuthorized')
    case 'failed':
      return view.error ?? t('statusFailed')
    case 'cancelled':
      return t('statusCancelled')
    default: {
      const exhausted: never = view.status
      return exhausted
    }
  }
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback
}

/**
 * Render Codex or Antigravity sign-in controls on the matching account row.
 * @param props - directory row, live attempt, and Host actions.
 * @returns the controls, or nothing on other provider rows of the same family.
 */
export function CodexOauthCard({
  provider, t, useOauth, start, cancel, signOut, answerPrompt, declinePrompt, openAuthorizeUrl,
}: CodexOauthCardProps): ReactNode {
  const view = useOauth(value => value)
  const [promptValue, setPromptValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | undefined>(undefined)
  const [popupBlocked, setPopupBlocked] = useState(false)
  const openedUrl = useRef<string | undefined>(undefined)
  const answeredBrowser = useRef(false)
  const waiting = awaitingBrowser(view)
  useEffect(() => {
    if (!OAUTH_CARD_PROVIDERS.has(provider.provider)) return
    if (!awaitingBrowser(view)) {
      setPopupBlocked(false)
      if (view.status !== 'prompting') answeredBrowser.current = false
      if (!view.inFlight) openedUrl.current = undefined
      return
    }
    if (openedUrl.current === view.authorizeUrl) return
    openedUrl.current = view.authorizeUrl
    setPopupBlocked(!openAuthorizeUrl(view.authorizeUrl))
  }, [provider.provider, waiting, view, openAuthorizeUrl])
  useEffect(() => { setPromptValue('') }, [view.prompt?.message, view.prompt?.kind])
  useEffect(() => {
    if (!OAUTH_CARD_PROVIDERS.has(provider.provider)) return
    if (view.status !== 'prompting' || view.prompt?.kind !== 'select' || answeredBrowser.current) return
    const ids = new Set(view.prompt.options.map(option => option.id))
    if (!ids.has('browser') || !ids.has('device_code')) return
    answeredBrowser.current = true
    void answerPrompt('browser').catch((error: unknown) => {
      setActionError(messageOf(error, t('actionFailed')))
    })
  }, [provider.provider, view.status, view.prompt, answerPrompt, t])
  if (!OAUTH_CARD_PROVIDERS.has(provider.provider)) return null

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setActionError(undefined)
    try { await action() }
    catch (error: unknown) { setActionError(messageOf(error, t('actionFailed'))) }
    finally { setBusy(false) }
  }
  const failed = view.status === 'failed' || actionError !== undefined
  const prompting = view.status === 'prompting' && view.prompt !== undefined && !waiting
  const prompt = view.prompt
  const authorizeUrl = view.authorizeUrl
  const showPopupBlocked = popupBlocked && waiting && actionError === undefined
  const notice = actionError
    ?? (showPopupBlocked ? t('popupBlocked') : statusCopy(view, t, provider.provider))

  return (
    <div className={styles['card']}>
      <div className={styles['identity']}>
        <span className={styles['name']}>{provider.displayName}</span>
        {view.credentialConfigured && !view.inFlight && !failed
          ? <span className={styles['connected']} role="img" aria-label={notice} />
          : <p className={failed || showPopupBlocked ? styles['error'] : styles['status']} role="status">{notice}</p>}
      </div>
      {prompting && prompt !== undefined ? (
        <div className={styles['prompt']}>
          {prompt.kind === 'select' ? (
            <div className={styles['options']}>
              {prompt.options.map(option => (
                <Button
                  key={option.id}
                  variant="outline"
                  size="md"
                  disabled={busy}
                  onClick={() => { void run(() => answerPrompt(option.id)) }}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          ) : (
            <Input
              type={prompt.kind === 'secret' ? 'password' : 'text'}
              value={promptValue}
              placeholder={prompt.placeholder ?? t('promptPlaceholder')}
              disabled={busy}
              onChange={(event) => { setPromptValue(event.target.value) }}
            />
          )}
          <div className={styles['actions']}>
            {prompt.kind !== 'select' ? (
              <Button
                variant="primary"
                size="md"
                disabled={busy || promptValue.length === 0}
                onClick={() => { void run(() => answerPrompt(promptValue)) }}
              >
                {t('answer')}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="md"
              disabled={busy}
              onClick={() => { void run(() => declinePrompt()) }}
            >
              {t('decline')}
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles['actions']}>
          {view.inFlight ? (
            <Button variant="ghost" size="md" onClick={() => { void run(cancel) }}>
              {t('cancel')}
            </Button>
          ) : view.credentialConfigured ? (
            <Button variant="outline" size="md" disabled={busy} onClick={() => { void run(signOut) }}>
              {t('signOut')}
            </Button>
          ) : (
            <Button variant="primary" size="md" disabled={busy} onClick={() => { void run(start) }}>
              {t('signIn')}
            </Button>
          )}
          {authorizeUrl === undefined ? null : (
            <Button
              variant={view.inFlight ? 'primary' : 'outline'}
              size="md"
              onClick={() => { setPopupBlocked(!openAuthorizeUrl(authorizeUrl)) }}
            >
              {t('openLink')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
