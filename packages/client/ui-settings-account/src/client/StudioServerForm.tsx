/** Device-local server settings and an explicit, unauthenticated connectivity check. */
import { useEffect, useRef, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StudioOperations } from './StudioAccount.tsx'
import type { AccountKey } from './locales.ts'
import css from './StudioAccount.module.css'

/**
 * Render server settings without changing account credentials or synchronization consent.
 * @param props - saved address, Host operations, and localized labels.
 * @returns server configuration and the result of the latest explicit connection check.
 */
export function StudioServerForm({ origin: savedOrigin, signedIn = false, studioConfigureServer, studioTestConnection, t, onSaved }: {
  origin: string
  signedIn?: boolean
  studioConfigureServer: StudioOperations['studioConfigureServer']
  studioTestConnection: StudioOperations['studioTestConnection']
  t: (key: AccountKey) => string
  onSaved?: () => void
}) {
  const [origin, setOrigin] = useState(savedOrigin)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<'ok' | 'failed' | null>(null)
  const [connection, setConnection] = useState<'idle' | 'testing' | 'connected' | 'failed'>('idle')
  const generation = useRef(0)
  useEffect(() => {
    generation.current++
    setOrigin(savedOrigin)
    setConnection('idle')
    setOutcome(null)
    return () => { generation.current++ }
  }, [savedOrigin])
  const checkConnection = async (): Promise<void> => {
    const current = ++generation.current
    setConnection('testing')
    try {
      await studioTestConnection(origin.trim())
      if (generation.current === current) setConnection('connected')
    } catch (_unreachableServer) {
      if (generation.current === current) setConnection('failed')
    }
  }
  return <form className={css.form} onSubmit={(event) => {
    event.preventDefault()
    if (busy || connection === 'testing') return
    setBusy(true)
    setOutcome(null)
    void studioConfigureServer(origin.trim()).then(() => { setOutcome('ok'); onSaved?.() }, () => { setOutcome('failed') })
      .finally(() => { setBusy(false) })
  }}>
    <p className={css.description}>{t('studioServerDescription')}</p>
    <label>{t('studioOrigin')}<Input type="url" required value={origin} disabled={busy}
      onChange={(event) => {
        generation.current++
        setOrigin(event.target.value)
        setConnection('idle')
        setOutcome(null)
      }} /></label>
    <div className={css.connectionRow}>
      <p className={css.connectionStatus} role="status" aria-live="polite" data-state={connection}>
        {t('studioConnectionStatus')}: {t(!origin.trim() ? 'studioConnectionUnconfigured'
          : connection === 'testing' ? 'studioConnectionTesting'
            : connection === 'connected' ? 'studioConnectionConnected'
              : connection === 'failed' ? 'studioConnectionFailed' : 'studioConnectionIdle')}
      </p>
      <div className={css.actions}>
        <Button type="button" variant="outline" disabled={busy || connection === 'testing' || !origin.trim()}
          onClick={() => { void checkConnection() }}>{t('studioTestConnection')}</Button>
        <Button type="submit" variant="primary" disabled={busy || connection === 'testing' || !origin.trim()}>
          {t('studioSaveServer')}
        </Button>
      </div>
    </div>
    {signedIn && <p className={css.description}>{t('studioServerSignOut')}</p>}
    {outcome && <p className={css.description} role={outcome === 'failed' ? 'alert' : 'status'}>
      {t(outcome === 'failed' ? 'studioFailure' : 'studioDone')}
    </p>}
    {connection === 'failed' && <p className={css.description}>{t('studioConnectionHelp')}</p>}
  </form>
}
