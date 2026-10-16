/** Codex and Antigravity quota cards aligned with Management Center QuotaBody fields. */

import { useState, type ReactNode } from 'react'
import { Button, Modal, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AntigravityQuotaView, CodexQuotaView, QuotaWindowView } from '@deepseek-ai/dsh-api-provider-quota/types'
import type { AccountKey } from './locales.ts'
import { formatGmt8 } from './formatGmt8.ts'
import type { QuotaSnapshot } from './quota-store.ts'
import css from './AccountSection.module.css'

/** @param props - quota snapshot, copy, and redeem. */
export function QuotaCards({ quota, t, onRetry, onConsume, onNoticeDone, children }: {
  quota: QuotaSnapshot
  t: (key: AccountKey) => string
  onRetry: () => void
  onConsume: () => Promise<void>
  onNoticeDone: () => void
  children?: ReactNode
}): ReactNode {
  const [confirm, setConfirm] = useState(false)
  const [modelsOpen, setModelsOpen] = useState<'codex' | 'antigravity' | null>(null)
  const codex = quota.codex
  const antigravity = quota.antigravity
  const modelView = modelsOpen === 'antigravity' ? antigravity : codex
  const models = modelView?.models ?? []
  return <>
    <div className={css.quotaStack}>
      {children}
      <CodexCard view={codex} loading={quota.status === 'loading' && codex === null} t={t}
        consumeBusy={quota.consumeBusy}
        onRetry={onRetry}
        onConsume={() => { setConfirm(true) }}
        onModels={() => { setModelsOpen('codex') }} />
      <AntigravityCard view={antigravity} loading={quota.status === 'loading' && antigravity === null} t={t}
        onRetry={onRetry} onModels={() => { setModelsOpen('antigravity') }} />
    </div>
    {confirm && <Modal open title={t('resetConfirmTitle')} closeLabel={t('close')} onClose={() => { setConfirm(false) }}>
      <p className={css.resetConfirm}>{t('resetConfirmDescription')}</p>
      <div className={css.actions}>
        <Button variant="outline" onClick={() => { setConfirm(false) }}>{t('cancel')}</Button>
        <Button variant="primary" disabled={quota.consumeBusy} onClick={() => {
          setConfirm(false)
          void onConsume()
        }}>{t('resetConfirm')}</Button>
      </div>
    </Modal>}
    {modelsOpen && <Modal open title={t('modelsTitle')} closeLabel={t('close')} onClose={() => { setModelsOpen(null) }}>
      {modelView?.provider === 'codex' && modelView.modelsFromCatalog === true
        ? <p className={css.secondary}>{t('modelsCatalog')}</p>
        : modelView?.modelsError !== undefined ? <p className={css.secondary}>{t('modelsUnavailable')}</p> : null}
      {models.length === 0
        ? modelView?.modelsError === undefined && <p className={css.secondary}>{t('modelsEmpty')}</p>
        : <ul className={css.modelList}>
          {models.map(model => <li key={model.id}>{model.name ?? model.id}</li>)}
        </ul>}
    </Modal>}
    {quota.notice !== null && <Toast text={t(quota.notice.textKey)}
      onDone={onNoticeDone}
      {...quota.notice.kind === 'ok' ? { tone: 'success' as const } : {}} />}
  </>
}

function CodexCard({ view, loading, t, consumeBusy, onRetry, onConsume, onModels }: {
  view: CodexQuotaView | null
  loading: boolean
  t: (key: AccountKey) => string
  consumeBusy: boolean
  onRetry: () => void
  onConsume: () => void
  onModels: () => void
}): ReactNode {
  const available = view?.resetCreditsAvailableCount ?? 0
  return <article className={css.quotaCard} aria-label={t('codexTitle')}>
    <h3 className={css.quotaTitle}>{t('codexTitle')}</h3>
    {loading ? <p className={css.secondary}>{t('loading')}</p>
      : view === null ? <Failed t={t} onRetry={onRetry} />
        : view.status === 'unsigned' ? <p className={css.secondary}>{t('goModelsSignIn')}</p>
          : <>
            {view.status === 'failed' && <Failed t={t} onRetry={onRetry} />}
            <Row label={t('plan')} value={planLabel(view.planType, t)} />
            <Row label={t('subscriptionUntil')}
              value={view.subscriptionActiveUntilMs === null ? t('subscriptionNotProvided') : formatGmt8(view.subscriptionActiveUntilMs)} />
            {view.creditsUnlimited ? <Row label={t('creditBalance')} value={t('creditsUnlimited')} />
              : view.creditBalance !== null ? <Row label={t('creditBalance')} value={view.creditBalance} /> : null}
            <Row label={t('resetCredits')} value={String(available)} />
            {view.resetCredits.map(credit => credit.expiresAtMs === null ? null : (
              <Row key={credit.id} label={t('resetExpiry')} value={formatGmt8(credit.expiresAtMs)} />
            ))}
            {view.windows.map(window => <WindowBar key={window.id} window={window} t={t} />)}
            <div className={css.quotaActions}>
              <Button variant="outline" onClick={onModels}>{t('models')}</Button>
              <Button variant="outline" className={css.resetButton} disabled={available <= 0 || consumeBusy}
                onClick={onConsume}>{t('resetQuota')}</Button>
            </div>
          </>}
  </article>
}

function AntigravityCard({ view, loading, t, onRetry, onModels }: {
  onModels: () => void
  view: AntigravityQuotaView | null
  loading: boolean
  t: (key: AccountKey) => string
  onRetry: () => void
}): ReactNode {
  return <article className={css.quotaCard} aria-label={t('antigravityTitle')}>
    <h3 className={css.quotaTitle}>{t('antigravityTitle')}</h3>
    {loading ? <p className={css.secondary}>{t('loading')}</p>
      : view === null || view.status === 'failed' ? <Failed t={t} onRetry={onRetry} />
        : view.status === 'unsigned' ? <p className={css.secondary}>{t('goModelsSignIn')}</p>
          : <>
            <Row label={t('plan')} value={antigravityPlan(view.plan, view.tierId, t)} />
            {view.groups.map(group => <div key={group.id} className={css.quotaGroup}>
              <span className={css.quotaGroupLabel}>{group.label ?? group.id}</span>
              {group.buckets.map(bucket => <WindowBar key={bucket.id} window={bucket} t={t} />)}
            </div>)}
            <div className={css.quotaActions}>
              <Button variant="outline" onClick={onModels}>{t('models')}</Button>
            </div>
          </>}
  </article>
}

function Failed({ t, onRetry }: { t: (key: AccountKey) => string; onRetry: () => void }): ReactNode {
  return <div className={css.quotaFailed}>
    <span className={css.secondary}>{t('quotaLoadFailed')}</span>
    <Button variant="outline" onClick={onRetry}>{t('quotaRetry')}</Button>
  </div>
}

function Row({ label, value }: { label: string; value: string }): ReactNode {
  return <div className={css.quotaRow}><span className={css.secondary}>{label}</span><span>{value}</span></div>
}

function WindowBar({ window, t }: { window: QuotaWindowView; t: (key: AccountKey) => string }): ReactNode {
  const remaining = window.remainingPercent
  return <div className={css.window}>
    <div className={css.windowMeta}>
      <span>{windowLabel(window, t)}</span>
      <span>{remaining === null ? t('balanceUnavailable') : `${String(Math.round(remaining))}%`}</span>
    </div>
    <div className={css.windowTrack} aria-hidden="true">
      <div className={css.windowFill} style={{ width: remaining === null ? '0%' : `${String(Math.max(0, Math.min(100, remaining)))}%` }} />
    </div>
    {window.resetAtMs !== null && <span className={css.secondary}>{t('resetsAt')} {formatGmt8(window.resetAtMs)}</span>}
  </div>
}

function windowLabel(window: QuotaWindowView, t: (key: AccountKey) => string): string {
  const kind = windowKind(window.kind, t)
  if (window.group === 'codeReview') return `${t('windowCodeReview')} · ${kind}`
  if (window.group === 'additional' && window.featureName !== null && window.featureName.length > 0) {
    return `${window.featureName} · ${kind}`
  }
  return kind
}

function windowKind(kind: QuotaWindowView['kind'], t: (key: AccountKey) => string): string {
  if (kind === 'fiveHour' || kind === '5h') return t('windowFiveHour')
  if (kind === 'weekly') return t('windowWeekly')
  if (kind === 'monthly') return t('windowMonthly')
  return t('windowUnknown')
}

function planLabel(planType: string | null, t: (key: AccountKey) => string): string {
  if (planType === null) return t('planUnknown')
  const id = planType.toLowerCase()
  if (id === 'plus') return t('planPlus')
  if (id === 'pro') return t('planPro')
  if (id === 'prolite' || id === 'self_serve_business_prolite') return t('planProlite')
  if (id === 'team') return t('planTeam')
  if (id === 'free') return t('planFree')
  return planType
}

function antigravityPlan(
  plan: AntigravityQuotaView['plan'],
  tierId: string | null,
  t: (key: AccountKey) => string,
): string {
  if (plan === 'free') return t('planFree')
  if (plan === 'pro') return t('planPro')
  if (plan === 'ultra') return t('planUltra')
  if (plan === 'ultra-lite') return t('planUltraLite')
  return tierId ?? t('planUnknown')
}
