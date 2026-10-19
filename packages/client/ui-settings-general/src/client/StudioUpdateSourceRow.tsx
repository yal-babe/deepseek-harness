/** Studio version and device-local generic update source. */
import { useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopUpdateView } from '../types.ts'
import css from './CurrentVersionRow.module.css'

interface Injected {
  hooks: { update: HostObservable<DesktopUpdateView> }
  save: (url: string) => Promise<void>
}

/** @param props - native-source observation and save operation. */
export function StudioUpdateSourceRow({ useUpdate, save, t }: InjectFace<Injected> & PropsLocale<'settings'> & PropsRuntime<'settings.general.item'>) {
  const state = useUpdate(value => value)
  const [draft, setDraft] = useState<string | undefined>(undefined)
  if (state.source === undefined) return null
  return <section className={css.row}>
    <strong>{t('studioUpdate.title', { version: state.source.version })}</strong>
    <form onSubmit={event => { event.preventDefault(); void save(draft ?? state.source?.url ?? '') }}>
      <label>{t('studioUpdate.source')}<Input value={draft ?? state.source.url ?? ''}
        onChange={event => { setDraft(event.target.value) }} placeholder="https://…/win-x64/" /></label>
      <p>{t('studioUpdate.hint')}</p>
      <Button type="submit" size="sm" variant="outline" disabled={state.sourceSaving}>{t('studioUpdate.save')}</Button>
      {state.sourceSaved && <p role="status">{t('studioUpdate.saved')}</p>}
      {state.sourceFailed && <p role="alert">{t('studioUpdate.failed')}</p>}
    </form>
  </section>
}
