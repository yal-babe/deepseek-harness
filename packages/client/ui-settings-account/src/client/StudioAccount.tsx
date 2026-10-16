/** Studio account controls consume Host-owned state independently of model accounts. */
import { useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  StudioState,
  StudioPreviewRow,
  StudioDevice,
  StudioHistoryItem,
  StudioHistoryView,
  StudioProjectBinding,
  StudioTokenActivity,
  StudioRestoredPlugin,
  StudioContinuationResult,
} from '@deepseek-ai/dsh-studio-cloud/types'
import type { AccountKey } from './locales.ts'
import { StudioLoginDialog } from './StudioLoginDialog.tsx'
import css from './StudioAccount.module.css'

/** Safe state shared by the settings section and sidebar dialog. */
export interface StudioSnapshot {
  state: StudioState | null
  visible: boolean
  error: boolean
  preview?: StudioPreviewRow[]
  devices?: StudioDevice[]
  histories?: StudioHistoryItem[]
  history?: StudioHistoryView
  projects?: StudioProjectBinding[]
  tokenActivity?: StudioTokenActivity
  restoredPlugins?: StudioRestoredPlugin[]
  continuation?: StudioContinuationResult
}
/** Account-only actions with explicit fields; no arbitrary cloud routes cross this interface. */
export type StudioAccountAction =
  | { kind: 'invite'; origin: string; allowHttp: boolean; token: string; username: string; password: string }
  | { kind: 'forgot'; origin: string; allowHttp: boolean; email: string }
  | { kind: 'reset'; origin: string; allowHttp: boolean; token: string; password: string }
  | { kind: 'verify'; origin: string; allowHttp: boolean; token: string }
  | { kind: 'bind'; email: string; password: string }
/** Host calls and framework-bound snapshots for Studio account surfaces. */
export interface StudioInjected {
  hooks: { studio: HostObservable<StudioSnapshot> }
  studioLogin: (origin: string, login: string, password: string, device: string, allowHttp: boolean) => Promise<void>
  studioLogout: () => Promise<void>
  studioChangePassword: (current: string, next: string) => Promise<void>
  studioRefresh: () => Promise<void>
  studioPreview: () => Promise<void>
  studioSelect: (choices: { id: string; source: 'local' | 'cloud'; version: number }[]) => Promise<void>
  studioPause: (paused: boolean) => Promise<void>
  studioAction: (action: StudioAccountAction) => Promise<void>
  studioDevices: () => Promise<void>
  studioRevoke: (id: string) => Promise<void>
  studioHistories: () => Promise<void>
  studioReadHistory: (id: string) => Promise<void>
  studioProjects: () => Promise<void>
  studioBindProject: (id: string, localId: string) => Promise<void>
  studioUnbindProject: (id: string) => Promise<void>
  studioForkHistory: (id: string, workspaceId: string, preset?: string) => Promise<StudioContinuationResult>
  studioTokenActivity: () => Promise<void>
  studioRestoredPlugins: () => Promise<void>
  studioUpdateProfile: (displayName: string) => Promise<void>
  studioClose: () => void
}
export type StudioOperations = Pick<
  StudioInjected,
  | 'studioLogin'
  | 'studioLogout'
  | 'studioChangePassword'
  | 'studioRefresh'
  | 'studioPreview'
  | 'studioSelect'
  | 'studioPause'
  | 'studioAction'
  | 'studioDevices'
  | 'studioRevoke'
  | 'studioHistories'
  | 'studioReadHistory'
  | 'studioProjects'
  | 'studioBindProject'
  | 'studioUnbindProject'
  | 'studioForkHistory'
  | 'studioTokenActivity'
  | 'studioRestoredPlugins'
  | 'studioUpdateProfile'
>
type Operations = StudioOperations
/**
 * Render Studio login without transferring a cloud token to browser storage.
 * @param props - safe account state, localized copy and Host operations.
 * @returns account form or account status.
 */
export function StudioForm({
  snapshot,
  t,
  ...operations
}: Operations & { snapshot: StudioSnapshot; t: (key: AccountKey) => string }) {
  const [origin, setOrigin] = useState(snapshot.state?.origin ?? '')
  const [mode, setMode] = useState<'login' | 'invite' | 'forgot' | 'reset' | 'verify'>('login')
  const [mail, setMail] = useState('')
  const [token, setToken] = useState('')
  const [succeeded, setSucceeded] = useState(false)
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [nextPassword, setNextPassword] = useState('')
  const [device, setDevice] = useState('')
  const [allowHttp, setAllowHttp] = useState(false)
  const [choices, setChoices] = useState<Record<string, 'local' | 'cloud'>>({})
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [editingName, setEditingName] = useState(snapshot.state?.identity?.displayName ?? '')
  const [bindingWorkspaces, setBindingWorkspaces] = useState<Record<string, string>>({})
  const [forkWorkspaces, setForkWorkspaces] = useState<Record<string, string>>({})
  const state = snapshot.state
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setFailed(false)
    setSucceeded(false)
    try {
      await action()
      setPassword('')
      setNextPassword('')
      setToken('')
      setSucceeded(true)
    } catch (_failure) {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={css.form}>
      <p className={css.description}>{t('studioDescription')}</p>
      {succeeded && (
        <p role="status" className={css.description}>
          {t('studioDone')}
        </p>
      )}
      {(failed || snapshot.error) && (
        <p role="alert" className={css.description}>
          {t('studioFailure')}
        </p>
      )}
      {state?.identity ? (
        <>
          <div className={css.account}>
            <span>{state.identity.displayName || state.identity.username}</span>
            <span className={css.origin}>{state.origin}</span>
          </div>
          {!state.identity.mustChangePassword && (
            <div className={css.actions}>
              <Input
                placeholder={t('studioDisplayName')}
                value={editingName}
                onChange={(event) => {
                  setEditingName(event.target.value)
                }}
              />
              <Button
                variant="outline"
                disabled={busy || !editingName.trim() || editingName.trim() === (state.identity.displayName || state.identity.username)}
                onClick={() => void run(() => operations.studioUpdateProfile(editingName.trim()))}
              >
                {t('studioUpdateProfile')}
              </Button>
            </div>
          )}
          {state.identity.mustChangePassword ? (
            <>
              <p className={css.description}>{t('studioPasswordRequired')}</p>
              <label>
                {t('studioPassword')}
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value)
                  }}
                />
              </label>
              <label>
                {t('studioNewPassword')}
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={nextPassword}
                  onChange={(event) => {
                    setNextPassword(event.target.value)
                  }}
                />
              </label>
              <Button
                disabled={busy || !password || nextPassword.length < 12}
                onClick={() => void run(() => operations.studioChangePassword(password, nextPassword))}
              >
                {t('studioChangePassword')}
              </Button>
            </>
          ) : (
            <>
              <p className={css.description}>
                {t(
                  state.phase === 'unsupported'
                    ? 'studioUnsupported'
                    : state.phase === 'ready'
                      ? 'studioReady'
                      : state.phase === 'conflict'
                        ? 'studioConflict'
                        : 'studioPreviewRequired',
                )}
              </p>
              {state.quotaBytes !== null && (
                <p className={css.description}>
                  {t('studioStorage')}: {((state.usedBytes ?? 0) / 1048576).toFixed(1)} /{' '}
                  {(state.quotaBytes / 1048576).toFixed(1)} MB
                </p>
              )}
            </>
          )}
          {!state.identity.mustChangePassword && state.phase !== 'unsupported' && (
            <>
              <div className={css.actions}>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setConsent(false)
                    setChoices({})
                    void run(operations.studioPreview)
                  }}
                >
                  {t('studioPreview')}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || (state.phase !== 'ready' && state.phase !== 'paused')}
                  onClick={() => void run(() => operations.studioPause(state.phase === 'ready'))}
                >
                  {t(state.phase === 'ready' ? 'studioPause' : 'studioResume')}
                </Button>
              </div>
              {snapshot.preview && (
                <div className={css.form}>
                  <p className={css.description}>{t('studioConsentDescription')}</p>
                  {snapshot.preview.map(row => (
                    <div key={row.id} className={css.preview}>
                      <label className={css.consent}>
                        <input
                          type="checkbox"
                          disabled={!row.supported}
                          checked={choices[row.id] !== undefined}
                          onChange={(event) => {
                            setChoices((previous) => {
                              const next = { ...previous }
                              if (event.target.checked) next[row.id] = row.local !== null ? 'local' : 'cloud'
                              else Reflect.deleteProperty(next, row.id)
                              return next
                            })
                          }}
                        />
                        {row.id}
                        {row.conflict ? ` · ${t('studioConflict')}` : ''}
                      </label>
                      <select
                        aria-label={`${t('studioSource')}: ${row.id}`}
                        disabled={choices[row.id] === undefined}
                        value={choices[row.id] ?? (row.local !== null ? 'local' : 'cloud')}
                        onChange={(event) => {
                          setChoices(previous => ({
                            ...previous,
                            [row.id]: event.target.value === 'local' ? 'local' : 'cloud',
                          }))
                        }}
                      >
                        {row.local !== null && <option value="local">{t('studioLocal')}</option>}
                        {row.cloud !== null && <option value="cloud">{t('studioCloud')}</option>}
                      </select>
                      <details>
                        <summary>{t('studioValues')}</summary>
                        <pre>{row.local}</pre>
                        <pre>{row.cloud}</pre>
                      </details>
                    </div>
                  ))}
                  <label className={css.consent}>
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(event) => {
                        setConsent(event.target.checked)
                      }}
                    />
                    {t('studioConsent')}
                  </label>
                  <Button
                    variant="primary"
                    disabled={busy || !consent || !Object.keys(choices).length}
                    onClick={() =>
                      void run(() =>
                        operations.studioSelect(
                          (snapshot.preview ?? []).flatMap((row) => {
                            const source = choices[row.id]
                            return source === undefined ? [] : [{ id: row.id, version: row.version, source }]
                          }),
                        ),
                      )
                    }
                  >
                    {t('studioConfirm')}
                  </Button>
                </div>
              )}
            </>
          )}
          {!state.identity.mustChangePassword && (
            <>
              <details>
                <summary>{t('studioEmailActions')}</summary>
                <div className={css.form}>
                  <label>
                    {t('studioEmail')}
                    <Input
                      type="email"
                      autoComplete="email"
                      value={mail}
                      onChange={(event) => {
                        setMail(event.target.value)
                      }}
                    />
                  </label>
                  <label>
                    {t('studioPassword')}
                    <Input
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value)
                      }}
                    />
                  </label>
                  <Button
                    disabled={busy || !mail || !password}
                    onClick={() => void run(() => operations.studioAction({ kind: 'bind', email: mail, password }))}
                  >
                    {t('studioBindEmail')}
                  </Button>
                </div>
              </details>
              <Button variant="outline" disabled={busy} onClick={() => void run(operations.studioDevices)}>
                {t('studioDevices')}
              </Button>
              {snapshot.devices?.map(item => (
                <div key={item.id} className={css.preview}>
                  <span>
                    {item.deviceName}
                    {item.current ? ` · ${t('studioThisDevice')}` : ''}
                  </span>
                  <span className={css.description}>{item.lastSeen}</span>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void run(() => operations.studioRevoke(item.id))}
                  >
                    {t('studioRevoke')}
                  </Button>
                </div>
              ))}
            </>
          )}
          {!state.identity.mustChangePassword && (
            <>
              <Button variant="outline" disabled={busy} onClick={() => void run(operations.studioProjects)}>
                {t('studioProjects')}
              </Button>
              {snapshot.projects && (
                <div className={css.form}>
                  {snapshot.projects.length === 0 ? (
                    <p className={css.description}>{t('studioNoProjects')}</p>
                  ) : (
                    snapshot.projects.map(proj => (
                      <div key={proj.id} className={css.preview}>
                        <span>{proj.title}</span>
                        {proj.localId ? (
                          <div className={css.actions}>
                            <span className={css.description}>
                              {t('studioBoundWorkspace')}: {proj.localId}
                            </span>
                            <Button
                              variant="outline"
                              disabled={busy}
                              onClick={() => void run(() => operations.studioUnbindProject(proj.id))}
                            >
                              {t('studioUnbindProject')}
                            </Button>
                          </div>
                        ) : (
                          <div className={css.actions}>
                            <Input
                              placeholder={t('studioWorkspaceSelect')}
                              value={bindingWorkspaces[proj.id] ?? ''}
                              onChange={(event) => {
                                const val = event.target.value
                                setBindingWorkspaces(prev => ({ ...prev, [proj.id]: val }))
                              }}
                            />
                            <Button
                              variant="outline"
                              disabled={busy || !bindingWorkspaces[proj.id]?.trim()}
                              onClick={() => {
                                const target = bindingWorkspaces[proj.id]?.trim()
                                if (target) void run(() => operations.studioBindProject(proj.id, target))
                              }}
                            >
                              {t('studioBindProject')}
                            </Button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
              <Button variant="outline" disabled={busy} onClick={() => void run(operations.studioHistories)}>
                {t('studioHistories')}
              </Button>
              {snapshot.histories?.map(item => (
                <div key={item.id} className={css.preview}>
                  <span>{item.title}</span>
                  <div className={css.actions}>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => void run(() => operations.studioReadHistory(item.id))}
                    >
                      {t('studioReadHistory')}
                    </Button>
                    <Input
                      placeholder={t('studioWorkspaceSelect')}
                      value={forkWorkspaces[item.id] ?? ''}
                      onChange={(event) => {
                        const val = event.target.value
                        setForkWorkspaces(prev => ({ ...prev, [item.id]: val }))
                      }}
                    />
                    <Button
                      variant="outline"
                      disabled={busy || !forkWorkspaces[item.id]?.trim()}
                      onClick={() => {
                        const target = forkWorkspaces[item.id]?.trim()
                        if (target) {
                          void run(async () => {
                            await operations.studioForkHistory(item.id, target)
                          })
                        }
                      }}
                    >
                      {t('studioForkHistory')}
                    </Button>
                  </div>
                </div>
              ))}
              {snapshot.continuation && (
                <p role="status" className={css.description}>
                  {t('studioForkSuccess')}: {snapshot.continuation.sessionId}
                </p>
              )}
              {snapshot.history && (
                <article className={css.history} aria-label={t('studioReadHistory')}>
                  <p className={css.description}>{t('studioReadOnly')}</p>
                  {snapshot.history.missing.length > 0 && (
                    <p role="alert">
                      {t('studioMissingAttachments')}: {snapshot.history.missing.map(item => item.name).join(', ')}
                    </p>
                  )}
                  {snapshot.history.messages.map(message => (
                    <div key={message.id} className={css.preview}>
                      <span className={css.description}>{message.role}</span>
                      <p className={css.historyText}>{message.content}</p>
                    </div>
                  ))}
                </article>
              )}
              <Button variant="outline" disabled={busy} onClick={() => void run(operations.studioTokenActivity)}>
                {t('studioTokenActivity')}
              </Button>
              {snapshot.tokenActivity && (
                <div className={css.preview}>
                  <p className={css.description}>
                    {t('studioTotalTokens')}: {snapshot.tokenActivity.totalTokens.toLocaleString()}
                  </p>
                  <p className={css.description}>
                    {t('studioInputTokens')}: {snapshot.tokenActivity.inputTokens.toLocaleString()} ·{' '}
                    {t('studioOutputTokens')}: {snapshot.tokenActivity.outputTokens.toLocaleString()}
                  </p>
                  <p className={css.description}>
                    {t('studioTurnsCount')}: {snapshot.tokenActivity.turnsCount} ·{' '}
                    {t('studioSessionsCount')}: {snapshot.tokenActivity.sessionsCount}
                  </p>
                </div>
              )}
              <Button variant="outline" disabled={busy} onClick={() => void run(operations.studioRestoredPlugins)}>
                {t('studioRestoredPlugins')}
              </Button>
              {snapshot.restoredPlugins && (
                <div className={css.form}>
                  {snapshot.restoredPlugins.map(plugin => (
                    <div key={plugin.moduleName} className={css.preview}>
                      <span>
                        {plugin.moduleName} {plugin.version ? `@ ${plugin.version}` : ''}
                      </span>
                      <span className={css.description}>
                        {plugin.installed ? t('studioPluginInstalled') : t('studioPluginMissing')} ·{' '}
                        {plugin.enabled ? t('studioPluginEnabled') : t('studioPluginDisabled')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          <div className={css.actions}>
            <Button variant="outline" disabled={busy} onClick={() => void run(operations.studioRefresh)}>
              {t('retry')}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void run(operations.studioLogout)}>
              {t('signOut')}
            </Button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void run(async () => {
              if (mode === 'login') await operations.studioLogin(origin, login, password, device, allowHttp)
              else if (mode === 'invite')
                await operations.studioAction({ kind: 'invite', origin, allowHttp, token, username: login, password })
              else if (mode === 'forgot')
                await operations.studioAction({ kind: 'forgot', origin, allowHttp, email: mail })
              else if (mode === 'reset')
                await operations.studioAction({ kind: 'reset', origin, allowHttp, token, password })
              else await operations.studioAction({ kind: 'verify', origin, allowHttp, token })
            })
          }}
          className={css.form}
        >
          <label>
            {t('studioOrigin')}
            <Input
              type="url"
              autoComplete="url"
              value={origin}
              onChange={(event) => {
                setOrigin(event.target.value)
              }}
              required
            />
          </label>
          {(mode === 'login' || mode === 'invite') && (
            <label>
              {t('studioUsername')}
              <Input
                autoComplete="username"
                value={login}
                onChange={(event) => {
                  setLogin(event.target.value)
                }}
                required
              />
            </label>
          )}
          {(mode === 'login' || mode === 'invite' || mode === 'reset') && (
            <label>
              {t('studioPassword')}
              <Input
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value)
                }}
                required
              />
            </label>
          )}
          {mode === 'login' && (
            <label>
              {t('studioDevice')}
              <Input
                value={device}
                onChange={(event) => {
                  setDevice(event.target.value)
                }}
                required
              />
            </label>
          )}
          {mode === 'forgot' && (
            <label>
              {t('studioEmail')}
              <Input
                type="email"
                autoComplete="email"
                value={mail}
                onChange={(event) => {
                  setMail(event.target.value)
                }}
                required
              />
            </label>
          )}
          {(mode === 'invite' || mode === 'reset' || mode === 'verify') && (
            <label>
              {t('studioMailToken')}
              <Input
                value={token}
                onChange={(event) => {
                  setToken(event.target.value)
                }}
                required
              />
            </label>
          )}
          <label className={css.consent}>
            <input
              type="checkbox"
              checked={allowHttp}
              onChange={(event) => {
                setAllowHttp(event.target.checked)
              }}
            />
            {t('studioAllowHttp')}
          </label>
          <Button type="submit" variant="primary" disabled={busy || !origin}>
            {t(
              mode === 'login'
                ? 'signIn'
                : mode === 'invite'
                  ? 'studioInvite'
                  : mode === 'forgot'
                    ? 'studioForgot'
                    : mode === 'reset'
                      ? 'studioReset'
                      : 'studioVerify',
            )}
          </Button>
          <div className={css.actions}>
            {(['login', 'invite', 'forgot', 'reset', 'verify'] as const)
              .filter(item => item !== mode)
              .map(item => (
                <Button
                  key={item}
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setMode(item)
                    setFailed(false)
                    setSucceeded(false)
                    setPassword('')
                    setToken('')
                  }}
                >
                  {t(
                    item === 'login'
                      ? 'signIn'
                      : item === 'invite'
                        ? 'studioInvite'
                        : item === 'forgot'
                          ? 'studioForgot'
                          : item === 'reset'
                            ? 'studioReset'
                            : 'studioVerify',
                  )}
                </Button>
              ))}
          </div>
        </form>
      )}
    </div>
  )
}
/** Studio settings section props supplied through the settings slot. */
export type StudioSectionProps = PropsRuntime<'settings.section'> &
  PropsLocale<'settings.account'> &
  InjectFace<StudioInjected>
/** @param props - framework Studio snapshot and operations. @returns cloud account settings. */
export function StudioSection({ useStudio, t, ...operations }: StudioSectionProps) {
  const snapshot = useStudio(value => value)
  return (
    <section className={css.section}>
      <h2>{t('studioNav')}</h2>
      <StudioForm
        key={`${snapshot.state?.origin}:${snapshot.state?.identity?.id}`}
        snapshot={snapshot}
        t={t}
        {...operations}
      />
    </section>
  )
}
/** Overlay props supplied through the shell slot. */
export type StudioOverlayProps = PropsRuntime<'shell.overlay'> &
  PropsLocale<'settings.account'> &
  InjectFace<StudioInjected>
/** @param props - framework Studio snapshot and operations. @returns the explicitly opened account dialog. */
export function StudioOverlay({ useStudio, t, ...operations }: StudioOverlayProps) {
  const snapshot = useStudio(value => value)
  return snapshot.visible ? (
    <StudioLoginDialog snapshot={snapshot} t={t} {...operations} onClose={operations.studioClose} />
  ) : null
}
