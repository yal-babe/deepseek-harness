/** Optional Studio identity form; model-provider authorization belongs in Settings. */
import { useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StudioOperations } from './StudioAccount.tsx'
import type { AccountKey } from './locales.ts'
import css from './StudioAccount.module.css'

/**
 * Render login and email recovery without exposing invitation, device naming, or provider authorization.
 * @param props - Host-owned identity actions and localized labels.
 * @returns a Studio sign-in form with an explicit local-only continuation when requested.
 */
export function StudioSignIn({ origin: initialOrigin = '', studioLogin, studioAction, onLocal, onSignedIn, t }: {
  origin?: string | undefined
  studioLogin: StudioOperations['studioLogin']
  studioAction: StudioOperations['studioAction']
  onLocal?: () => void
  onSignedIn?: () => void
  t: (key: AccountKey) => string
}) {
  const origin = initialOrigin
  const [mode, setMode] = useState<'login' | 'forgot'>('login')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<'failed' | 'sent' | null>(null)
  return <form className={css.signIn} onSubmit={(event) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setOutcome(null)
    void (async () => {
      try {
        if (mode === 'login') {
          // Empty device names are resolved by the Host using the operating-system hostname.
          await studioLogin(origin.trim(), login.trim(), password, '', true)
          setPassword('')
          onSignedIn?.()
        } else {
          await studioAction({ kind: 'forgot', origin: origin.trim(), allowHttp: true, email: login.trim() })
          setOutcome('sent')
        }
      } catch (_failure) { setOutcome('failed') }
      finally { setBusy(false) }
    })()
  }}>
    <p className={css.description}>{t(mode === 'login' ? 'studioLocalDescription' : 'studioRecoveryDescription')}</p>
    {!origin && <p role="status" className={css.description}>{t('studioServerMissing')}</p>}
    <label>{t(mode === 'login' ? 'studioUsername' : 'studioEmail')}<Input type={mode === 'login' ? 'text' : 'email'}
      autoComplete={mode === 'login' ? 'username' : 'email'} required value={login}
      onChange={(event) => { setLogin(event.target.value) }} /></label>
    {mode === 'login' && <label>{t('studioPassword')}<Input type="password" autoComplete="current-password" required
      value={password} onChange={(event) => { setPassword(event.target.value) }} /></label>}
    {outcome && <p role={outcome === 'failed' ? 'alert' : 'status'} className={css.description}>
      {t(outcome === 'failed' ? 'studioFailure' : 'studioRecoverySent')}
    </p>}
    <Button type="submit" variant="primary" disabled={busy || !origin.trim()}>
      {t(mode === 'login' ? 'signIn' : 'studioForgot')}
    </Button>
    <div className={css.loginLinks}>
      <Button variant="ghost" disabled={busy} onClick={() => {
        setMode(mode === 'login' ? 'forgot' : 'login'); setLogin(''); setPassword(''); setOutcome(null)
      }}>{t(mode === 'login' ? 'studioForgot' : 'studioBackToLogin')}</Button>
      {onLocal && <Button variant="ghost" disabled={busy} onClick={onLocal}>{t('studioContinueLocal')}</Button>}
    </div>
  </form>
}
