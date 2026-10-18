/** Settings page of the Studio Pet (`settings.section`, id `pet`). */
import { useState, type FormEvent, type ReactNode } from 'react'
import { Button, Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { PET_CHARACTER_SOURCE } from './credits.ts'
import type { PetFrameSet } from './frames.ts'
import { autonomousPackClips, PET_ACTIONS } from './motion.ts'
import type { PetPreferences } from './preferences.ts'
import { addRestrictedTool, removeRestrictedTool, type PetSettingsFields, type PetSettingsSwitch, type PetSettingsWriteState } from './settings.ts'
import css from './PetSettingsSection.module.css'

/** Values the settings page registration injects. */
export interface PetSettingsInjected {
  hooks: {
    /** Host `pet` entry form. */
    form: ObservableSnapshot<ConfigFormSnapshot<PetSettingsFields>>
    /** Write outcome of this page. */
    write: ObservableSnapshot<PetSettingsWriteState>
    /** Device-local preferences. */
    preferences: ObservableSnapshot<PetPreferences>
    /** Character pack the Host offers, whose pack-only clips the allowlist covers. */
    pack: ObservableSnapshot<PetFrameSet>
  }
  /** Whether this document runs inside the Desktop app. */
  desktop: boolean
  /** Whether this platform can show system notifications. */
  canNotify: boolean
  /**
   * Write one Host switch.
   * @param field - boolean field.
   * @param value - requested value.
   */
  setSwitch(field: PetSettingsSwitch, value: boolean): Promise<boolean>
  /**
   * Replace the restricted-tool list.
   * @param tools - complete list.
   */
  setRestrictedTools(tools: readonly string[]): Promise<boolean>
  /**
   * Turn device notifications on or off (asks for permission when turning on).
   * @param on - requested value.
   */
  setDeviceNotify(on: boolean): Promise<boolean>
  /** Device-local animation and interaction controls. */
  setPreferences(patch: Partial<PetPreferences>): void
}

/** Props of the settings page. */
export type PetSettingsProps = PropsRuntime<'settings.section'> & PropsLocale<'pet'> & InjectFace<PetSettingsInjected>

type T = PetSettingsProps['t']

function Row({ title, hint, children }: {
  readonly title: string
  readonly hint?: string | undefined
  readonly children: ReactNode
}): ReactNode {
  return (
    <div className={css.row}>
      <div>
        <div className={css.title}>{title}</div>
        {hint !== undefined && <div className={css.description}>{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function ToolList({ t, tools, disabled, onChange }: {
  readonly t: T
  readonly tools: readonly string[]
  readonly disabled: boolean
  readonly onChange: (tools: readonly string[]) => void
}): ReactNode {
  const [draft, setDraft] = useState('')
  const next = addRestrictedTool(tools, draft)
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (next === undefined) return
    onChange(next)
    setDraft('')
  }
  return (
    <div className={css.tools}>
      {tools.length === 0
        ? <div className={css.description}>{t('settings.noTools')}</div>
        : (
          <ul className={css.toolList}>
            {tools.map(tool => (
              <li key={tool}>
                <code>{tool}</code>
                <Button size="sm" disabled={disabled} aria-label={t('settings.removeTool', { name: tool })}
                  onClick={() => { onChange(removeRestrictedTool(tools, tool)) }}>×</Button>
              </li>
            ))}
          </ul>
        )}
      <form className={css.addTool} onSubmit={submit}>
        <Input value={draft} aria-label={t('settings.toolName')} placeholder={t('settings.toolPlaceholder')} disabled={disabled}
          onChange={(event) => { setDraft(event.target.value) }} />
        <Button type="submit" size="sm" variant="outline" disabled={disabled || next === undefined}>{t('settings.addTool')}</Button>
      </form>
    </div>
  )
}

/**
 * Render the pet settings: visibility, notification categories, the
 * restricted-tool list, and the character credit. Host fields show the accepted value; a refused write
 * leaves it unchanged and shows a failure line.
 * @param props - injected form, writers, and copy.
 * @returns the section element tree.
 */
export function PetSettingsSection(props: PetSettingsProps): ReactNode {
  const { t, desktop, canNotify } = props
  const form = props.useForm(value => value)
  const write = props.useWrite(value => value)
  const preferences = props.usePreferences(value => value)
  const motion = props.usePack(value => value.motion)
  const packClips = autonomousPackClips(motion)
  const language = t('locale') === 'en' ? 'en' : 'zh'
  const deviceNotify = preferences.notify
  const credit = (
    <>
      <h3 className={css.group}>{t('settings.credit')}</h3>
      <div className={css.note}>
        {t('settings.creditText')} <a href={PET_CHARACTER_SOURCE} target="_blank" rel="noopener noreferrer">{PET_CHARACTER_SOURCE}</a>
      </div>
    </>
  )
  if (form.status === 'unavailable') return <div className={css.section}><div className={css.description}>{t('settings.unavailable')}</div>{credit}</div>
  const value = form.value
  const locked = value === undefined || !form.writable || write.busy
  const toggle = (field: PetSettingsSwitch, label: string): ReactNode => (
    <Switch checked={value?.[field] === true} label={label} disabled={locked}
      onChange={(next) => { void props.setSwitch(field, next) }} />
  )
  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('settings.title')}</h2>
      <h3 className={css.group}>{t('settings.general')}</h3>
      <Row title={t('settings.visible')} hint={t('settings.visibleHint')}>{toggle('visible', t('settings.visible'))}</Row>
      <div className={css.note}>{desktop ? t('settings.modeDesktop') : t('settings.modeBrowser')}</div>
      <Row title={t('settings.name')}>
        <Input aria-label={t('settings.name')} value={preferences.name ?? ''} placeholder={t('defaultName')} maxLength={48}
          onChange={(event) => { props.setPreferences({ name: Array.from(event.target.value).slice(0, 24).join('') }) }} />
      </Row>
      <Row title={t('settings.size')}>
        <label><input type="range" aria-label={t('settings.size')} min={50} max={200} step={5} value={preferences.size ?? 100}
          onChange={(event) => { props.setPreferences({ size: Number(event.target.value) }) }} /> {preferences.size ?? 100}%</label>
        <Button size="sm" variant="ghost" onClick={() => { props.setPreferences({ size: 100 }) }}>{t('settings.resetSize')}</Button>
      </Row>
      <h3 className={css.group}>{t('settings.behavior')}</h3>
      <Row title={t('settings.life')}>
        <div className={css.activity} role="group" aria-label={t('settings.life')}>
          {(['idle', 'rest', 'play'] as const).map(life => <Button key={life} size="sm"
            variant={(preferences.life ?? 'idle') === life ? 'outline' : 'ghost'} aria-pressed={(preferences.life ?? 'idle') === life}
            onClick={() => { props.setPreferences({ life }) }}>{t(`life.${life}`)}</Button>)}
        </div>
      </Row>
      <Row title={t('settings.activity')}>
        <div className={css.activity} role="group" aria-label={t('settings.activity')}>
          {(['quiet', 'normal', 'lively'] as const).map(level => <Button key={level} size="sm"
            variant={(preferences.activity ?? 'normal') === level ? 'outline' : 'ghost'}
            aria-pressed={(preferences.activity ?? 'normal') === level}
            onClick={() => { props.setPreferences({ activity: level }) }}>{t(`settings.${level}`)}</Button>)}
        </div>
      </Row>
      <details><summary>{t('settings.randomActions')}</summary>
        {PET_ACTIONS.map(action => <Row key={action} title={t(`menu.${action}`)}>
          <Switch checked={(preferences.actions ?? PET_ACTIONS).includes(action)} label={t(`menu.${action}`)}
            onChange={(checked) => { const selected = preferences.actions ?? PET_ACTIONS
              props.setPreferences({ actions: checked ? [...selected, action] : selected.filter(item => item !== action) }) }} />
        </Row>)}
        {packClips.length > 0 && <div className={css.title}>{t('settings.packClips')}</div>}
        {packClips.map((clip) => {
          const label = motion?.clips[clip]?.label?.[language] ?? clip
          return <Row key={clip} title={label}>
            <Switch checked={(preferences.clips ?? packClips).includes(clip)} label={label}
              onChange={(checked) => { const selected = preferences.clips ?? packClips
                props.setPreferences({ clips: checked ? [...selected, clip] : selected.filter(item => item !== clip) }) }} />
          </Row>
        })}
      </details>
      <Row title={t('settings.interactive')} hint={t('settings.interactiveHint')}>
        <Switch checked={preferences.interactive === true} label={t('settings.interactive')}
          onChange={(interactive) => { props.setPreferences({ interactive }) }} />
      </Row>
      <Row title={t('settings.roam')} hint={t('settings.roamHint')}>
        <Switch checked={preferences.roam === true} label={t('settings.roam')}
          onChange={(roam) => { props.setPreferences({ roam }) }} />
      </Row>
      <Row title={t('settings.lines')} hint={t('settings.linesHint')}>
        <Switch checked={preferences.lines !== false} label={t('settings.lines')}
          onChange={(lines) => { props.setPreferences({ lines }) }} />
      </Row>
      <Row title={t('settings.throw')} hint={t('settings.throwHint')}>
        <Switch checked={preferences.throw !== false} label={t('settings.throw')}
          onChange={(value) => { props.setPreferences({ throw: value }) }} />
      </Row>
      <Row title={t('settings.effects')}>
        <Switch checked={preferences.effects !== false} label={t('settings.effects')}
          onChange={(effects) => { props.setPreferences({ effects }) }} />
      </Row>
      <Row title={t('settings.reducedMotion')}>
        <Switch checked={preferences.reducedMotion === true} label={t('settings.reducedMotion')}
          onChange={(reducedMotion) => { props.setPreferences({ reducedMotion }) }} />
      </Row>
      <h3 className={css.group}>{t('settings.notifications')}</h3>
      <Row title={t('settings.deviceNotify')} hint={canNotify ? t('settings.deviceNotifyHint') : t('settings.notifyUnsupported')}>
        <Switch checked={deviceNotify} label={t('settings.deviceNotify')} disabled={!canNotify}
          onChange={(next) => { void props.setDeviceNotify(next) }} />
      </Row>
      <Row title={t('settings.notifyWaiting')}>{toggle('notifyWaiting', t('settings.notifyWaiting'))}</Row>
      <Row title={t('settings.notifySuccess')}>{toggle('notifySuccess', t('settings.notifySuccess'))}</Row>
      <Row title={t('settings.notifyError')}>{toggle('notifyError', t('settings.notifyError'))}</Row>
      <h3 className={css.group}>{t('settings.approvals')}</h3>
      <Row title={t('settings.restrictTools')} hint={t('settings.restrictToolsHint')}>{toggle('restrictTools', t('settings.restrictTools'))}</Row>
      {value?.restrictTools === true && (
        <ToolList t={t} tools={value.restrictedTools} disabled={locked} onChange={(tools) => { void props.setRestrictedTools(tools) }} />
      )}
      {credit}
      {write.failed && <div className={css.error} role="alert">{t('settings.saveFailed')}</div>}
    </div>
  )
}
