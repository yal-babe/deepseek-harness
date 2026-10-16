/** Static DSH Studio account preview; it never starts Host authorization. */

import type { ReactNode } from 'react'
import { Button, IconCloseOutlineRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccountKey } from './locales.ts'
import css from './SignInDialog.module.css'

/**
 * @param props - locale copy and dismiss.
 * @returns a preview dialog that does not call any Remote.
 */
export function StudioLoginDialog({ t, onClose }: {
  t: (key: AccountKey) => string
  onClose: () => void
}): ReactNode {
  return <Modal open headless title={t('studioPreviewTitle')} onClose={onClose} className={css.dialog as string}>
    <div className={css.content}>
      <div className={css.header}>
        <h2 className={css.title}>{t('studioPreviewTitle')}</h2>
        <button type="button" className={css.close} aria-label={t('close')} onClick={onClose}>
          <IconCloseOutlineRegular size={14} />
        </button>
      </div>
      <p className={css.description}>{t('studioPreviewDescription')}</p>
    </div>
    <div className={css.actions}>
      <Button variant="primary" className={css.primaryButton} onClick={onClose}>{t('studioPreviewClose')}</Button>
    </div>
  </Modal>
}
