/** Studio login dialog uses the same Host-owned account controls as Settings. */
import { IconCloseOutlineRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StudioOperations, StudioSnapshot } from './StudioAccount.tsx'
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
  return (
    <Modal open headless title={t('studioLogin')} onClose={onClose} className={css.dialog as string}>
      <div className={css.content}>
        <div className={css.header}>
          <h2 className={css.title}>{t('studioLogin')}</h2>
          <button type="button" className={css.close} aria-label={t('close')} onClick={onClose}>
            <IconCloseOutlineRegular size={14} />
          </button>
        </div>
        <StudioSignIn
          key={`${snapshot.state?.origin}:${snapshot.state?.identity?.id}`}
          origin={snapshot.state?.origin}
          onLocal={onClose}
          onSignedIn={onClose}
          t={t}
          {...operations}
        />
      </div>
    </Modal>
  )
}
