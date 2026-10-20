/** Studio login dialog uses the same Host-owned account controls as Settings. */
import { useState } from 'react'
import { Button, IconCloseOutlineRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StudioOperations, StudioSnapshot } from './StudioAccount.tsx'
import { StudioServerForm } from './StudioServerForm.tsx'
import { StudioSignIn } from './StudioSignIn.tsx'
import type { AccountKey } from './locales.ts'
import css from './SignInDialog.module.css'

/** @param props - safe Studio snapshot and Host operations. @returns the Studio account dialog. */
export function StudioLoginDialog({
  t,
  onClose,
  snapshot,
  ...operations
}: StudioOperations & {
  t: (key: AccountKey) => string
  onClose: () => void
  snapshot: StudioSnapshot
}) {
  const [configure, setConfigure] = useState(false)
  return (
    <Modal open headless title={t(configure ? 'studioServerConfig' : 'studioLogin')} onClose={onClose} className={css.dialog as string}>
      <div className={css.content}>
        <div className={css.header}>
          <h2 className={css.title}>{t(configure ? 'studioServerConfig' : 'studioLogin')}</h2>
          <button type="button" className={css.close} aria-label={t('close')} onClick={onClose}>
            <IconCloseOutlineRegular size={14} />
          </button>
        </div>
        {configure ? <>
          <StudioServerForm origin={snapshot.state?.origin ?? ''} signedIn={!!snapshot.state?.identity}
            studioConfigureServer={operations.studioConfigureServer} studioTestConnection={operations.studioTestConnection} t={t} onSaved={() => { setConfigure(false) }} />
          <Button variant="ghost" onClick={() => { setConfigure(false) }}>{t('studioBackToLogin')}</Button>
        </> : <><StudioSignIn
          key={`${snapshot.state?.origin}:${snapshot.state?.identity?.id}`}
          origin={snapshot.state?.origin}
          onLocal={onClose}
          onSignedIn={onClose}
          t={t}
          {...operations}
        />
        <Button variant="ghost" onClick={() => { setConfigure(true) }}>{t('studioServerConfig')}</Button>
        {snapshot.error && <Button variant="outline" onClick={() => { void operations.studioRefresh().catch((_failure: unknown) => { /* The connection error and retry action remain visible. */ }) }}>{t('studioRetry')}</Button>}
        </>}
      </div>
    </Modal>
  )
}
