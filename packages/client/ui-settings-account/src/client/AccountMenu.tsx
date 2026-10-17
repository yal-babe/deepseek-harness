/** Sidebar account launcher and locally authoritative sign-out action. */
import { useEffect, useRef, useState } from 'react'
import {
  Toast, Menu, IconEllipsisOutlineMedium, IconPaperPlaneOutlineMedium, IconSettingsOutlineMedium, IconUserOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountSectionInjected } from './AccountSection.tsx'
import { LogoutIcon } from './LogoutIcon.tsx'
import { AccountNoticeCard } from './AccountNotice.tsx'
import css from './AccountMenu.module.css'

/** Account launcher composed by the settings shell. */
export type AccountMenuProps = PropsRuntime<'settings.launcher'> & PropsLocale<'settings.account'> & InjectFace<AccountSectionInjected>

/** The signed-in label stays empty while the profile loads.
 * @param props - sidebar geometry, settings navigation and account operations.
 * @returns account menu launcher.
 */
export function AccountMenu({
  subscribeSessionExpired, subscribeModelSignInRequired, wide, settingsShortcut, openSettings, settingsOpen,
  useAccount, signOutStudio, refreshAccount, bonusNoticeShown, bonusNoticeDismissed,
  contactUs, showStudio, t,
}: AccountMenuProps) {
  const anchor = useRef<HTMLDivElement>(null)
  // The launcher outlives the panel, so a false-to-true edge is one Settings entry:
  // re-renders, section switches and tab switches inside one open must not read again.
  const settingsWasOpen = useRef(false)
  useEffect(() => {
    if (settingsOpen && !settingsWasOpen.current) void refreshAccount()
    settingsWasOpen.current = settingsOpen
  }, [refreshAccount, settingsOpen])
  const account = useAccount(state => state)
  const modelSignedIn = account.view?.status === 'credential-stored'
  const identity = account.studio?.identity
  const signedIn = Boolean(identity)
  const [signInNotice, setSignInNotice] = useState(0)
  useEffect(() => subscribeModelSignInRequired?.(() => { setSignInNotice(value => value + 1) }), [subscribeModelSignInRequired])
  const [expiryNotice, setExpiryNotice] = useState(false)
  useEffect(() => subscribeSessionExpired?.(() => { setExpiryNotice(true) }), [subscribeSessionExpired])
  const label = identity ? identity.displayName || identity.username : t('studioLocalName')
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const [busy, setBusy] = useState(false)
  const [signOutFailed, setSignOutFailed] = useState(false)
  const requestSignOut = async () => {
    if (!signOutStudio) return
    setBusy(true)
    setSignOutFailed(false)
    try { await signOutStudio(); setOpen(false) }
    catch (_failure) { setSignOutFailed(true) }
    finally { setBusy(false) }
  }
  return <div ref={anchor} className={css.root}>
    {signInNotice > 0 && <Toast key={signInNotice} text={t('modelSignInRequired')} onDone={() => { setSignInNotice(0) }} />}
    {expiryNotice && <Toast text={t('sessionExpired')} onDone={() => { setExpiryNotice(false) }} />}
    {modelSignedIn && !account.desktopOnboardingVisible && !account.onboarding && account.notice && <AccountNoticeCard
      key={account.notice.orderId} notice={account.notice}
      anchor={anchor} title={t('bonusNoticeTitle')} closeLabel={t('close')}
      onShown={bonusNoticeShown} onDismiss={bonusNoticeDismissed} />}
    <Menu open={open} side="top" portal autoFocus className={css.anchor} listClassName={signedIn ? undefined : css.signedOutMenu}
      anchor={<button ref={trigger} type="button" className={css.trigger} data-collapsed={!wide} data-signed-out={!signedIn} aria-label={t('menu')}
        aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
        {signedIn
          ? <span className={css.avatar}><IconUserOutlineMedium size={18} /></span>
          : <IconEllipsisOutlineMedium size={14} />}
        {wide && <span className={css.label}>{label}</span>}
      </button>}
      items={[
        { id: 'settings', label: t('settings'), icon: <IconSettingsOutlineMedium size={16} />,
          ...(settingsShortcut === undefined ? {} : { shortcut: settingsShortcut }) },
        { id: 'contact', label: t('contactUs'), icon: <IconPaperPlaneOutlineMedium size={16} /> },
        ...(!signedIn ? [{ id: 'signin', label: t('studioLogin'), icon: <IconUserOutlineMedium size={16} /> }] : []),
        ...(signedIn ? [{ id: 'signout', label: t('signOut'), icon: <LogoutIcon />, disabled: busy }] : []),
      ]}
      onClose={() => { setOpen(false) }}
      onSelect={(id) => {
        if (id === 'settings') { setOpen(false); trigger.current?.focus(); openSettings() }
        else if (id === 'contact') { setOpen(false); contactUs() }
        else if (id === 'signin') { setOpen(false); showStudio?.() }
        else void requestSignOut()
      }} />
    {signOutFailed && <Toast text={t('studioFailure')} onDone={() => { setSignOutFailed(false) }} />}
  </div>
}
