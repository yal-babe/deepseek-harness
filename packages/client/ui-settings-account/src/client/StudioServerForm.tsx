/** Server configuration shared by Settings and the account dialog. */
import { useEffect, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StudioOperations } from './StudioAccount.tsx'
import type { AccountKey } from './locales.ts'
import css from './StudioAccount.module.css'

/** Shared device-local server configuration form, independent of the sign-in fields.
 * @param props - saved address and configuration writer.
 * @returns the server configuration controls.
 */
export function StudioServerForm({ origin: savedOrigin, signedIn = false, studioConfigureServer, t, onSaved }: {
  origin: string
  signedIn?: boolean
  studioConfigureServer: StudioOperations['studioConfigureServer']
  t: (key: AccountKey) => string
  onSaved?: () => void
}) {
  const [origin, setOrigin] = useState(savedOrigin)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<'ok' | 'failed' | null>(null)
  useEffect(() => { setOrigin(savedOrigin) }, [savedOrigin])
  return <form className={css.form} onSubmit={(event) => {
    event.preventDefault(); setBusy(true); setOutcome(null)
    void studioConfigureServer(origin.trim()).then(() => { setOutcome('ok'); onSaved?.() }, () => { setOutcome('failed') })
      .finally(() => { setBusy(false) })
  }}>
    <p className={css.description}>{t('studioServerDescription')}</p>
    <label>{t('studioOrigin')}<Input type="url" required value={origin}
      onChange={(event) => { setOrigin(event.target.value) }} /></label>
    {signedIn && <p className={css.description}>{t('studioServerSignOut')}</p>}
    {outcome && <p role={outcome === 'failed' ? 'alert' : 'status'}>
      {t(outcome === 'failed' ? 'studioFailure' : 'studioDone')}
    </p>}
    <Button type="submit" variant="primary" disabled={busy || !origin.trim()}>{t('studioSaveServer')}</Button>
  </form>
}
