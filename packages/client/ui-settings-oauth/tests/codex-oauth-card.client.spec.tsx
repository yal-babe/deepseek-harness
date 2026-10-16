// @vitest-environment jsdom
/** Codex OAuth card renders sign-in controls only on the openai-codex row. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { OAuthAttemptView } from '@deepseek-ai/dsh-llm-oauth-bridge/types'
import type { ProviderDirectoryEntry } from '@deepseek-ai/dsh-client-ui-settings-models/client'
import {
  authorizeBrowsingContextOpened,
  CodexOauthCard,
  type CodexOauthCardProps,
} from '../src/client/CodexOauthCard.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const entry: ProviderDirectoryEntry = {
  provider: 'openai-codex',
  displayName: 'ChatGPT (Codex)',
  settingsNs: 'llm-pi-ai',
  settingsPath: ['providers', 'openai-codex'],
  active: true,
}

const idle: OAuthAttemptView = { status: 'idle', inFlight: false, credentialConfigured: false }

function renderCard(view: OAuthAttemptView, extra: Partial<CodexOauthCardProps> = {}, provider = entry) {
  const start = vi.fn(async () => undefined)
  const cancel = vi.fn(async () => undefined)
  const signOut = vi.fn(async () => undefined)
  const answerPrompt = vi.fn(async () => undefined)
  const declinePrompt = vi.fn(async () => undefined)
  const openAuthorizeUrl = vi.fn((_url: string) => true)
  const props = {
    provider,
    configured: true,
    keyConfigured: view.credentialConfigured,
    t: (key: keyof typeof en) => en[key],
    useOauth: (select: (value: OAuthAttemptView) => OAuthAttemptView) => select(view),
    start,
    cancel,
    signOut,
    answerPrompt,
    declinePrompt,
    openAuthorizeUrl,
    ...extra,
  } as CodexOauthCardProps
  const rendered = render(<CodexOauthCard {...props} />)
  return { ...rendered, start, cancel, signOut, answerPrompt, declinePrompt, openAuthorizeUrl }
}

it('renders nothing on other llm-pi-ai provider rows', () => {
  const { openAuthorizeUrl } = renderCard({
    ...idle,
    status: 'waiting-browser',
    authorizeUrl: 'https://auth.example/start',
  }, {}, { ...entry, provider: 'openai' })
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.queryByRole('button')).toBeNull()
  expect(openAuthorizeUrl).not.toHaveBeenCalled()
})

it('shows Sign in while idle and unsigned', () => {
  const { start } = renderCard(idle)
  expect(screen.getByRole('status').textContent).toBe(en.statusIdle)
  fireEvent.click(screen.getByRole('button', { name: en.signIn }))
  expect(start).toHaveBeenCalledOnce()
})

it('shows Cancel and signing-in copy while the attempt is in flight', () => {
  const { cancel } = renderCard({ ...idle, inFlight: true })
  expect(screen.getByRole('status').textContent).toBe(en.signingIn)
  const button = screen.getByRole('button', { name: en.cancel })
  expect(button.hasAttribute('disabled')).toBe(false)
  fireEvent.click(button)
  expect(cancel).toHaveBeenCalledOnce()
})

it('shows Sign out once a credential is stored', () => {
  const { signOut } = renderCard({ status: 'authorized', inFlight: false, credentialConfigured: true })
  expect(screen.getByRole('img', { name: en.statusAuthorized })).toBeTruthy()
  expect(screen.queryByText(en.statusAuthorized)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.signOut }))
  expect(signOut).toHaveBeenCalledOnce()
})

it('opens the authorize URL automatically and from the explicit action', () => {
  const waiting = {
    status: 'waiting-browser' as const,
    inFlight: true,
    credentialConfigured: false,
    authorizeUrl: 'https://auth.example/start',
    message: 'Continue in your browser',
  }
  const { openAuthorizeUrl, rerender } = renderCard(waiting)
  expect(screen.getByRole('status').textContent).toBe('Continue in your browser')
  expect(openAuthorizeUrl).toHaveBeenCalledExactlyOnceWith('https://auth.example/start')
  rerender(<CodexOauthCard {...{
    provider: entry,
    configured: true,
    keyConfigured: false,
    t: (key: keyof typeof en) => en[key],
    useOauth: (select: (value: OAuthAttemptView) => OAuthAttemptView) => select(waiting),
    start: async () => undefined,
    cancel: async () => undefined,
    signOut: async () => undefined,
    answerPrompt: async () => undefined,
    declinePrompt: async () => undefined,
    openAuthorizeUrl: (url: string) => { openAuthorizeUrl(url); return true },
  } as CodexOauthCardProps} />)
  expect(openAuthorizeUrl).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: en.openLink }))
  expect(openAuthorizeUrl).toHaveBeenCalledTimes(2)
})

it('keeps Open sign-in page when a paste prompt still has an authorize URL', () => {
  const { openAuthorizeUrl, cancel } = renderCard({
    status: 'prompting',
    inFlight: true,
    credentialConfigured: false,
    authorizeUrl: 'https://auth.example/start',
    message: 'A browser window should open. Complete login to finish.',
    prompt: {
      kind: 'text',
      message: 'Complete login in your browser, or paste the authorization code / redirect URL here:',
      placeholder: 'http://localhost:1455/auth/callback',
    },
  })
  expect(screen.getByRole('status').textContent).toBe('A browser window should open. Complete login to finish.')
  expect(openAuthorizeUrl).toHaveBeenCalledExactlyOnceWith('https://auth.example/start')
  expect(screen.queryByPlaceholderText('http://localhost:1455/auth/callback')).toBeNull()
  expect(screen.queryByRole('button', { name: en.answer })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.cancel }))
  expect(cancel).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: en.openLink }))
  expect(openAuthorizeUrl).toHaveBeenCalledTimes(2)
})

it('answers a text prompt and declines it', async () => {
  const { answerPrompt, declinePrompt } = renderCard({
    status: 'prompting',
    inFlight: true,
    credentialConfigured: false,
    prompt: { kind: 'text', message: 'Paste the code', placeholder: 'code' },
  })
  expect(screen.getByRole('status').textContent).toBe('Paste the code')
  fireEvent.change(screen.getByPlaceholderText('code'), { target: { value: 'typed' } })
  fireEvent.click(screen.getByRole('button', { name: en.answer }))
  await waitFor(() => { expect(answerPrompt).toHaveBeenCalledExactlyOnceWith('typed') })
  fireEvent.click(screen.getByRole('button', { name: en.decline }))
  await waitFor(() => { expect(declinePrompt).toHaveBeenCalledOnce() })
})

it('answers a select prompt from the offered options', () => {
  const { answerPrompt } = renderCard({
    status: 'prompting',
    inFlight: true,
    credentialConfigured: false,
    prompt: { kind: 'select', message: 'Account', options: [{ id: 'work', label: 'Work' }] },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Work' }))
  expect(answerPrompt).toHaveBeenCalledExactlyOnceWith('work')
})

it('selects browser login when Codex offers browser and device-code methods', async () => {
  const { answerPrompt } = renderCard({
    status: 'prompting',
    inFlight: true,
    credentialConfigured: false,
    prompt: {
      kind: 'select',
      message: 'Select OpenAI Codex login method:',
      options: [
        { id: 'browser', label: 'Browser login (default)' },
        { id: 'device_code', label: 'Device code login (headless)' },
      ],
    },
  })
  await waitFor(() => { expect(answerPrompt).toHaveBeenCalledExactlyOnceWith('browser') })
})

it('shows a Host failure when auto-selecting browser login fails', async () => {
  const answerPrompt = vi.fn(async () => { throw new Error('oauth/rejected') })
  renderCard({
    status: 'prompting',
    inFlight: true,
    credentialConfigured: false,
    prompt: {
      kind: 'select',
      message: 'Select OpenAI Codex login method:',
      options: [
        { id: 'browser', label: 'Browser login (default)' },
        { id: 'device_code', label: 'Device code login (headless)' },
      ],
    },
  }, { answerPrompt })
  await waitFor(() => { expect(screen.getByRole('status').textContent).toBe('oauth/rejected') })
})

it('treats a denied window.open as opened on the Desktop application origin', () => {
  expect(authorizeBrowsingContextOpened(null, 'http:')).toBe(false)
  expect(authorizeBrowsingContextOpened(null, 'dsh-app:')).toBe(true)
  expect(authorizeBrowsingContextOpened({} as Window, 'http:')).toBe(true)
})

it('masks a secret prompt and uses the dictionary placeholder', () => {
  renderCard({
    status: 'prompting',
    inFlight: true,
    credentialConfigured: false,
    prompt: { kind: 'secret', message: 'Token' },
  })
  expect(screen.getByPlaceholderText(en.promptPlaceholder).getAttribute('type')).toBe('password')
})

it('reports failed, cancelled, and default waiting or prompting copy', () => {
  renderCard({ status: 'failed', inFlight: false, credentialConfigured: false, error: 'exchange failed' })
  expect(screen.getByRole('status').textContent).toBe('exchange failed')
  cleanup()
  renderCard({ status: 'failed', inFlight: false, credentialConfigured: false })
  expect(screen.getByRole('status').textContent).toBe(en.statusFailed)
  cleanup()
  renderCard({ status: 'cancelled', inFlight: false, credentialConfigured: false })
  expect(screen.getByRole('status').textContent).toBe(en.statusCancelled)
  cleanup()
  renderCard({ status: 'waiting-browser', inFlight: true, credentialConfigured: false })
  expect(screen.getByRole('status').textContent).toBe(en.statusWaiting)
  cleanup()
  renderCard({
    status: 'waiting-browser',
    inFlight: true,
    credentialConfigured: false,
    message: 'Continue in your browser',
  })
  expect(screen.getByRole('status').textContent).toBe('Continue in your browser')
  cleanup()
  renderCard({
    status: 'idle',
    inFlight: false,
    credentialConfigured: false,
    authorizeUrl: 'https://auth.example/start',
  })
  expect(screen.getByRole('button', { name: en.openLink })).toBeTruthy()
  cleanup()
  renderCard({ status: 'prompting', inFlight: true, credentialConfigured: false })
  expect(screen.getByRole('status').textContent).toBe(en.statusPrompting)
  cleanup()
  renderCard({ status: 'nope' as OAuthAttemptView['status'], inFlight: false, credentialConfigured: false })
  expect(screen.getByRole('status').textContent).toBe('nope')
})

it('treats an idle stored credential as signed in', () => {
  renderCard({ status: 'idle', inFlight: false, credentialConfigured: true })
  expect(screen.getByRole('img', { name: en.statusAuthorized })).toBeTruthy()
  expect(screen.queryByText(en.statusAuthorized)).toBeNull()
  expect(screen.getByRole('button', { name: en.signOut })).toBeTruthy()
})

it('renders Antigravity idle and authorized copy on the antigravity row', () => {
  const antigravity = { ...entry, provider: 'antigravity', displayName: 'Antigravity Account', settingsNs: 'llm-antigravity', settingsPath: [] as const }
  renderCard(idle, {}, antigravity)
  expect(screen.getByRole('status').textContent).toBe(en.statusIdleAntigravity)
  cleanup()
  renderCard({ status: 'idle', inFlight: false, credentialConfigured: true }, {}, antigravity)
  expect(screen.getByRole('img', { name: en.statusAuthorizedAntigravity })).toBeTruthy()
  expect(screen.queryByText(en.statusAuthorizedAntigravity)).toBeNull()
  cleanup()
  renderCard({ status: 'authorized', inFlight: false, credentialConfigured: true }, {}, antigravity)
  expect(screen.getByRole('img', { name: en.statusAuthorizedAntigravity })).toBeTruthy()
  expect(screen.queryByText(en.statusAuthorizedAntigravity)).toBeNull()
})

it('shows a Host start failure instead of staying idle', async () => {
  const start = vi.fn(async () => { throw new Error('oauth/rejected') })
  renderCard(idle, { start })
  fireEvent.click(screen.getByRole('button', { name: en.signIn }))
  await waitFor(() => { expect(screen.getByRole('status').textContent).toBe('oauth/rejected') })
})

it('shows dictionary fallback when start rejects a non-Error', async () => {
  const start = vi.fn(async () => { throw 'nope' })
  renderCard(idle, { start })
  fireEvent.click(screen.getByRole('button', { name: en.signIn }))
  await waitFor(() => { expect(screen.getByRole('status').textContent).toBe(en.actionFailed) })
})

it('reports a blocked browsing context on auto-open', () => {
  renderCard({
    status: 'waiting-browser',
    inFlight: true,
    credentialConfigured: false,
    authorizeUrl: 'https://auth.example/start',
  }, { openAuthorizeUrl: () => false })
  expect(screen.getByRole('status').textContent).toBe(en.popupBlocked)
})

it('clears a blocked-popup notice when the attempt leaves waiting-browser', () => {
  const waiting = {
    status: 'waiting-browser' as const,
    inFlight: true,
    credentialConfigured: false,
    authorizeUrl: 'https://auth.example/start',
  }
  const { rerender, openAuthorizeUrl } = renderCard(waiting, { openAuthorizeUrl: () => false })
  expect(screen.getByRole('status').textContent).toBe(en.popupBlocked)
  rerender(<CodexOauthCard {...{
    provider: entry,
    configured: true,
    keyConfigured: false,
    t: (key: keyof typeof en) => en[key],
    useOauth: (select: (value: OAuthAttemptView) => OAuthAttemptView) => select({
      status: 'failed', inFlight: false, credentialConfigured: false, error: 'exchange failed',
    }),
    start: async () => undefined,
    cancel: async () => undefined,
    signOut: async () => undefined,
    answerPrompt: async () => undefined,
    declinePrompt: async () => undefined,
    openAuthorizeUrl,
  } as CodexOauthCardProps} />)
  expect(screen.getByRole('status').textContent).toBe('exchange failed')
})
