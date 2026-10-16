/** DeepSeek account status and sign-out action inside Models settings. */
import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountSectionInjected } from './AccountSection.tsx'
import { SignOutDialog } from './SignOutDialog.tsx'
import css from './AccountSection.module.css'

/** @param props - account subscription and sign-out operations. @returns account controls for its provider row. */
export function AccountModelCard({ provider, useAccount, signOut, hasRunningAccountTasks, t }:
  PropsRuntime<'settings.models.provider-card'> & PropsLocale<'settings.account'> & InjectFace<AccountSectionInjected>) {
  const account = useAccount(value => value)
  const [impact, setImpact] = useState<boolean | 'unknown'>()
  const [busy, setBusy] = useState(false)
  if (provider.provider !== 'deepseek-account' || account.view?.status !== 'credential-stored') return null
  const request = async (): Promise<void> => {
    setBusy(true)
    try { setImpact(await hasRunningAccountTasks()) }
    catch (_taskStatusUnavailable) { setImpact('unknown') }
    finally { setBusy(false) }
  }
  return <div className={css.actions}>
    <Button variant="outline" disabled={busy} onClick={() => { void request() }}>{t('signOut')}</Button>
    {impact !== undefined && <SignOutDialog running={impact} signOut={signOut}
      close={() => { setImpact(undefined) }} t={t} />}
  </div>
}
