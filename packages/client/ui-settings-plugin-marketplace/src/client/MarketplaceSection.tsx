/** Plugin marketplace settings section: Hub browse, installed list, custom install, Codex source. */

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import {
  Button, Input, Modal, Tag, Toast, MarkdownText, PluginArtworkSubagent, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  CatalogCompatibility,
  CatalogEntry,
  CatalogKind,
  CatalogSort,
  CatalogSource,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  COMMUNITY_CATEGORY_FULL_KEYS,
  COMMUNITY_CATEGORY_IDS,
  COMMUNITY_CATEGORY_KEYS,
} from './categories.ts'
import { formatCount, formatUpdated } from './format.ts'
import type { MarketplaceLocaleKey } from './locales.ts'
import type { MarketplaceState, MarketplaceStore } from './store.ts'
import css from './MarketplaceSection.module.css'

/** Registration-side business face for the section. */
export interface MarketplaceSectionInjected {
  controller: MarketplaceStore
  hooks: {
    snapshot: MarketplaceStore['store']
  }
}

/** Props the renderer binds for the section. */
export type MarketplaceSectionProps =
  PropsLocale<'settings.marketplace'>
  & InjectFace<MarketplaceSectionInjected>

const SORTS: readonly CatalogSort[] = ['stars', 'forks', 'updated', 'added']
const KINDS: readonly CatalogKind[] = ['skill', 'mcp', 'hook']

/**
 * Render the Hub-style marketplace page with a Codex source.
 * @param props - locale seat and injected controller.
 */
export function MarketplaceSection({
  t,
  controller,
  useSnapshot,
}: MarketplaceSectionProps): ReactNode {
  const state = useSnapshot(value => value)
  const tabsId = useId()

  useEffect(() => {
    controller.load()
  }, [controller])

  const pages = useMemo(() => {
    if (state.result === null) return 1
    return Math.max(1, Math.ceil(state.result.total / state.result.pageSize))
  }, [state.result])

  const detail = state.detail
  const installedCount = state.result?.installedCount ?? 0

  return (
    <div className={css.section}>
      <div className={css.header}><h2 className={css.heading}>{t('title')}</h2>
        <p className={css.intro}>{t('subtitle')}</p></div>
      <div className={css.tabs} role="tablist" aria-label={t('title')}>
        <SectionTab
          id={`${tabsId}-market`}
          active={state.tab === 'market'}
          label={t('tabMarket')}
          onSelect={() => { controller.setTab('market') }}
        />
        <SectionTab
          id={`${tabsId}-installed`}
          active={state.tab === 'installed'}
          label={t('tabInstalled')}
          count={installedCount}
          onSelect={() => { controller.setTab('installed') }}
        />
        <SectionTab
          id={`${tabsId}-custom`}
          active={state.tab === 'custom'}
          label={t('tabCustom')}
          onSelect={() => { controller.setTab('custom') }}
        />
      </div>


      {state.tab === 'custom' ? (
        <CustomInstall
          spec={state.customSpec}
          busy={state.operations?.custom !== undefined}
          percent={state.operations?.custom?.percent}
          t={t}
          onChange={(value) => { controller.setCustomSpec(value) }}
          onInstall={() => { void controller.installCustom() }}
        />
      ) : (
        <CatalogPanel
          t={t}
          controller={controller}
          state={state}
          pages={pages}
        />
      )}

      {detail !== null ? (
        <Modal
          open
          className={css.detailDialog ?? ''}
          contentClassName={css.detailContent ?? ''}
          title={detail.title}
          closeLabel={t('close')}
          onClose={() => { controller.clearDetail() }}
          footer={(
            <DetailActions
              entry={detail}
              busy={state.operations?.[detail.id] !== undefined}
              percent={state.operations?.[detail.id]?.mode === 'install' ? state.operations[detail.id]?.percent : undefined}
              t={t}
              onInstall={() => { void controller.install(detail.id) }}
              onUninstall={() => { void controller.uninstall(detail.id) }}
              onToggle={() => { void controller.setEnabled(detail.id, !detail.enabled) }}
            />
          )}
        >
          <DetailBody entry={detail} t={t} />
        </Modal>
      ) : null}


    </div>
  )
}

function CatalogPanel({
  t,
  controller,
  state,
  pages,
}: {
  t: MarketplaceSectionProps['t']
  controller: MarketplaceStore
  state: MarketplaceState
  pages: number
}): ReactNode {
  const result = state.result
  const showCategories = state.source !== 'codex' && state.tab === 'market'
  const showKinds = state.source === 'codex'

  return (
    <>
      <div className={css.filters} role="group" aria-label={t('source')}>
        {([
          ['all', 'sourceAll'],
          ['community', 'sourceCommunity'],
          ['codex', 'sourceCodex'],
        ] as const).map(([value, key]) => (
          <Chip
            key={value}
            active={state.source === value}
            onClick={() => { controller.setSource(value) }}
          >
            {t(key)}
          </Chip>
        ))}
      </div>

      {showCategories ? (
        <div className={css.filters} role="group" aria-label={t('catAll')}>
          <Chip
            active={state.category === 'all'}
            onClick={() => { controller.setCategory('all') }}
          >
            {t('catAll')}
            {result !== null ? <span className={css.chipCount}>{result.queryTotal}</span> : null}
          </Chip>
          {COMMUNITY_CATEGORY_IDS.map(id => (
            <Chip
              key={id}
              active={state.category === id}
              onClick={() => { controller.setCategory(id) }}
            >
              {t(COMMUNITY_CATEGORY_KEYS[id])}
            </Chip>
          ))}
        </div>
      ) : null}

      {showKinds ? (
        <div className={css.filters} role="group" aria-label={t('kindAll')}>
          <Chip active={state.kind === 'all'} onClick={() => { controller.setKind('all') }}>
            {t('kindAll')}
          </Chip>
          {KINDS.map(kind => (
            <Chip
              key={kind}
              active={state.kind === kind}
              onClick={() => { controller.setKind(kind) }}
            >
              {kindLabel(t, kind)}
            </Chip>
          ))}
        </div>
      ) : null}

      <div className={css.toolbar}>
        <div className={css.views} role="group" aria-label={t('layout')}>
          {(['cards', 'list'] as const).map(layout => <Button key={layout} size="sm"
            variant={state.layout === layout ? 'toolbar' : 'ghost'}
            aria-pressed={state.layout === layout} onClick={() => { controller.setLayout(layout) }}>
            {t(layout === 'cards' ? 'layoutCards' : 'layoutList')}
          </Button>)}
        </div>
        <div className={css.search}>
          <Input
            value={state.query}
            placeholder={t('searchPlaceholder')}
            onChange={(event) => { controller.setQuery(event.target.value) }}
            aria-label={t('searchPlaceholder')}
          />
        </div>
      </div>

      {state.status === 'ready' && result !== null ? (
        <div className={css.resultRow}>
          <span className={css.meta}>{t('results', { total: result.total })}</span>
          <div className={css.sorts} role="group" aria-label={t('sortStars')}>
            {SORTS.map(sort => (
              <button
                key={sort}
                type="button"
                className={css.sort}
                data-active={state.sort === sort ? 'true' : undefined}
                onClick={() => { controller.setSort(sort) }}
              >
                {sortLabel(t, sort)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {state.status === 'loading' || state.status === 'idle' ? (
        <div className={css.list} aria-label={t('loading')} aria-busy="true">
          {[0, 1, 2, 3].map(index => <div key={index} className={css.skeleton} aria-hidden="true" />)}
        </div>
      ) : null}

      {state.status === 'error' ? (
        <p className={css.error} role="alert">
          <span>{t('feedFailed')}{state.errorMessage !== null ? ` (${state.errorMessage})` : ''}</span>
          <Button variant="outline" size="sm" onClick={() => { controller.load() }}>{t('retry')}</Button>
        </p>
      ) : null}

      {state.status === 'ready' && result !== null && result.entries.length === 0 ? (
        <p className={css.empty}>{t('empty')}</p>
      ) : null}

      {state.status === 'ready' && result !== null && result.entries.length > 0 ? (
        <>
          <ul className={css.list} data-layout={state.layout}>
            {result.entries.map(entry => (
              <li key={entry.id}>
                <PluginCard
                  entry={entry}
                  busy={state.operations?.[entry.id] !== undefined}
                  percent={state.operations?.[entry.id]?.mode === 'install' ? state.operations[entry.id]?.percent : undefined}
                  t={t}
                  onDetail={() => { void controller.openDetail(entry.id) }}
                  onInstall={() => { void controller.install(entry.id) }}
                  onUninstall={() => { void controller.uninstall(entry.id) }}
                  onToggle={() => { void controller.setEnabled(entry.id, !entry.enabled) }}
                />
              </li>
            ))}
          </ul>
          <div className={css.pager}>
            <span className={css.meta}>
              {t('page', { page: result.page, pages })}
            </span>
            <div className={css.pagerButtons}>
              <Button
                variant="outline"
                size="sm"
                disabled={result.page <= 1}
                onClick={() => { controller.setPage(result.page - 1) }}
              >
                {t('prev')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={result.page >= pages}
                onClick={() => { controller.setPage(result.page + 1) }}
              >
                {t('next')}
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </>
  )
}

function PluginCard({
  entry,
  busy,
  percent,
  t,
  onDetail,
  onInstall,
  onUninstall,
  onToggle,
}: {
  entry: CatalogEntry
  busy: boolean
  percent?: number | undefined
  t: MarketplaceSectionProps['t']
  onDetail: () => void
  onInstall: () => void
  onUninstall: () => void
  onToggle: () => void
}): ReactNode {
  const canInstall = entry.compatibility !== 'unsupported'
  const now = Date.now()
  return (
    <div className={css.card}>
      <EntryIcon key={entry.iconUrl ?? entry.id} entry={entry} />
      <div className={css.cardMain}>
        <div className={css.cardHead}>
          <h3 className={css.cardTitle}>{entry.title}</h3>
          {entry.version !== undefined ? (
            <span className={css.version}>{entry.version}</span>
          ) : null}
          {entry.updateAvailable === true ? (
            <Tag tone="warning">{t('updateAvailable')}</Tag>
          ) : null}
          {categoryFull(t, entry) !== undefined ? (
            <Tag tone="info">{categoryFull(t, entry)}</Tag>
          ) : (
            <Tag tone="neutral">{sourceLabel(t, entry.source)}</Tag>
          )}
          {entry.verified === true ? <Tag tone="success">{t('verified')}</Tag> : null}
          {entry.source === 'codex' ? (
            <Tag tone={compatTone(entry.compatibility)}>{compatLabel(t, entry.compatibility)}</Tag>
          ) : null}
        </div>
        {entry.description.length > 0 ? (
          <p className={css.description}>{entry.description}</p>
        ) : null}
        {entry.tags !== undefined && entry.tags.length > 0 ? (
          <div className={css.topics}>
            {entry.tags.slice(0, 3).map(tag => (
              <span key={tag} className={css.topic}>{tag}</span>
            ))}
          </div>
        ) : null}
      </div>
      <div className={css.cardSide}>
        <div className={css.stats}>
          {entry.stars !== undefined ? <span>★ {formatCount(entry.stars)}</span> : null}
          {entry.forks !== undefined ? <span>{t('fork')} {formatCount(entry.forks)}</span> : null}
          {entry.stars === undefined && entry.forks === undefined ? <span>{sourceLabel(t, entry.source)} · {entry.author}</span> : null}
          <span>{formatUpdated(entry.updatedAt, now, t)}</span>
        </div>
        <div className={css.actions}>
          <Button className={css.actionButton} variant="outline" size="sm" onClick={onDetail}>{t('detail')}</Button>
          {percent !== undefined ? (
            <Button className={css.actionButton} variant="primary" size="sm" disabled
              aria-label={`${t('installing')} ${percent}%`}>
              <InstallProgress percent={percent} t={t} />
            </Button>
          ) : entry.installed ? (
            <>
              {entry.updateAvailable === true ? (
                <Button className={css.actionButton} variant="primary" size="sm" disabled={busy || !canInstall} onClick={onInstall}>{t('update')}</Button>
              ) : null}
              <Button className={css.actionButton} variant="outline" size="sm" disabled={busy} onClick={onToggle}>{t(entry.enabled ? 'disable' : 'enable')}</Button>
              <Button className={css.actionButton} variant="outline" size="sm" disabled={busy} onClick={onUninstall}>{t('uninstall')}</Button>
            </>
          ) : (
            <Button className={css.actionButton} variant="primary" size="sm" disabled={busy || !canInstall} onClick={onInstall}>
              {canInstall ? t('install') : t('unsupported')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function DetailBody({
  entry,
  t,
}: {
  entry: CatalogEntry
  t: MarketplaceSectionProps['t']
}): ReactNode {
  return (
    <div className={css.detail}>
      <EntryIcon key={entry.iconUrl ?? entry.id} entry={entry} />
      <div className={css.badges}>
        <Tag tone="neutral">{sourceLabel(t, entry.source)}</Tag>
        <Tag tone={compatTone(entry.compatibility)}>{compatLabel(t, entry.compatibility)}</Tag>
        {entry.kinds.map(kind => (
          <Tag key={kind} tone="outline">{kindLabel(t, kind)}</Tag>
        ))}
        {entry.verified === true ? <Tag tone="success">{t('verified')}</Tag> : null}
        {entry.installed ? <Tag tone="info">{t('installed')}</Tag> : null}
      </div>
      <p className={css.meta}>
        {t('author')}: {entry.author}
        {entry.version !== undefined ? ` · ${t('version')}: ${entry.version}` : ''}
      </p>
      {entry.compatibilityNote !== undefined ? (
        <p className={css.description}>{entry.compatibilityNote}</p>
      ) : null}
      {entry.readme !== undefined && entry.readme.length > 0 ? (
        <div className={css.readme}><MarkdownText text={entry.readme} labels={{
          code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes'),
        }} /></div>
      ) : (
        <p className={css.description}>{entry.description}</p>
      )}
      <div className={css.links}>
        {entry.homepageUrl !== undefined ? (
          <a href={entry.homepageUrl} target="_blank" rel="noreferrer">{t('homepage')}</a>
        ) : null}
        {entry.repositoryUrl !== undefined ? (
          <a href={entry.repositoryUrl} target="_blank" rel="noreferrer">{t('repository')}</a>
        ) : null}
      </div>
    </div>
  )
}

function DetailActions({
  entry,
  busy,
  percent,
  t,
  onInstall,
  onUninstall,
  onToggle,
}: {
  entry: CatalogEntry
  busy: boolean
  percent?: number | undefined
  t: MarketplaceSectionProps['t']
  onInstall: () => void
  onUninstall: () => void
  onToggle: () => void
}): ReactNode {
  const canInstall = entry.compatibility !== 'unsupported'
  return (
    <>
      {entry.installed ? <Button className={css.actionButton} variant="outline" size="sm" disabled={busy} onClick={onToggle}>{t(entry.enabled ? 'disable' : 'enable')}</Button> : null}
      {entry.installed ? (
        <Button className={css.actionButton} variant="outline" size="sm" disabled={busy} onClick={onUninstall}>{t('uninstall')}</Button>
      ) : null}
      <Button variant="primary" size="sm" disabled={busy || !canInstall || (entry.installed && entry.updateAvailable !== true)} onClick={onInstall}>
        {percent !== undefined ? <InstallProgress percent={percent} t={t} />
          : entry.installed ? t(entry.updateAvailable === true ? 'update' : 'installed') : canInstall ? t('install') : t('unsupported')}
      </Button>
    </>
  )
}

function CustomInstall({
  spec,
  busy,
  percent,
  t,
  onChange,
  onInstall,
}: {
  spec: string
  busy: boolean
  percent?: number | undefined
  t: MarketplaceSectionProps['t']
  onChange: (value: string) => void
  onInstall: () => void
}): ReactNode {
  return (
    <div className={css.custom}>
      <h3 className={css.customTitle}>{t('customTitle')}</h3>
      <p className={css.intro}>{t('customHint')}</p>
      <div className={css.customRow}>
        <Input
          value={spec}
          placeholder={t('customPlaceholder')}
          onChange={(event) => { onChange(event.target.value) }}
          aria-label={t('customPlaceholder')}
        />
        <Button variant="primary" size="sm" disabled={busy} onClick={onInstall}>
          {percent === undefined ? t('customInstall') : <InstallProgress percent={percent} t={t} />}
        </Button>
      </div>
    </div>
  )
}

function SectionTab({
  id,
  active,
  label,
  count,
  onSelect,
}: {
  id: string
  active: boolean
  label: string
  count?: number
  onSelect: () => void
}): ReactNode {
  return (
    <button
      id={id}
      type="button"
      role="tab"
      className={css.tab}
      aria-selected={active}
      data-active={active ? 'true' : undefined}
      onClick={onSelect}
    >
      {label}
      {count !== undefined && count > 0 ? <span className={css.tabCount}>{count}</span> : null}
    </button>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}): ReactNode {
  return (
    <button
      type="button"
      className={css.chip}
      data-active={active ? 'true' : undefined}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function sourceLabel(t: MarketplaceSectionProps['t'], source: CatalogSource): string {
  return source === 'community' ? t('sourceCommunity') : t('sourceCodex')
}

function compatLabel(t: MarketplaceSectionProps['t'], value: CatalogCompatibility): string {
  switch (value) {
    case 'full': return t('compatibilityFull')
    case 'partial': return t('compatibilityPartial')
    case 'unsupported': return t('compatibilityUnsupported')
  }
}

function compatTone(value: CatalogCompatibility): 'success' | 'warning' | 'neutral' {
  switch (value) {
    case 'full': return 'success'
    case 'partial': return 'warning'
    case 'unsupported': return 'neutral'
  }
}

function kindLabel(t: MarketplaceSectionProps['t'], kind: CatalogKind): string {
  switch (kind) {
    case 'bundle': return t('kindBundle')
    case 'skill': return t('kindSkill')
    case 'mcp': return t('kindMcp')
    case 'hook': return t('kindHook')
  }
}

function sortLabel(t: MarketplaceSectionProps['t'], sort: CatalogSort): string {
  switch (sort) {
    case 'stars': return t('sortStars')
    case 'forks': return t('sortForks')
    case 'updated': return t('sortUpdated')
    case 'added': return t('sortAdded')
  }
}

function categoryFull(t: MarketplaceSectionProps['t'], entry: CatalogEntry): string | undefined {
  const id = entry.category
  if (id === undefined) return undefined
  if (id in COMMUNITY_CATEGORY_FULL_KEYS) {
    return t(COMMUNITY_CATEGORY_FULL_KEYS[id as keyof typeof COMMUNITY_CATEGORY_FULL_KEYS])
  }
  return id
}

function formatNotice(
  t: MarketplaceSectionProps['t'],
  key: MarketplaceLocaleKey,
  message: string | undefined,
): string {
  return t(key, message === undefined ? undefined : { message })
}

function EntryIcon({ entry }: { entry: CatalogEntry }): ReactNode {
  const [failed, setFailed] = useState(false)
  return <span className={css.icon} aria-hidden="true">
    {entry.iconUrl !== undefined && !failed
      ? <img src={entry.iconUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => { setFailed(true) }} />
      : <PluginArtworkSubagent size={32} />}
  </span>
}

function InstallProgress({ percent, t }: { percent: number; t: MarketplaceSectionProps['t'] }): ReactNode {
  return <span className={css.installProgress} role="progressbar" aria-label={t('installing')}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
    <StateDot state="ongoing" size={14} /><span>{t('installing')} {percent}%</span>
  </span>
}

/**
 * Keep operation outcomes visible when the Settings panel closes.
 * @param props - marketplace state and localized copy.
 * @returns the current operation toast, if any.
 */
export function MarketplaceNotice({ t, controller, useSnapshot }: MarketplaceSectionProps): ReactNode {
  const notice = useSnapshot(value => value.notice)
  if (notice === null) return null
  const text = formatNotice(t, notice.textKey, notice.message)
  return <Toast key={notice.seq} text={text} {...notice.kind === 'ok' ? { tone: 'success' as const } : {}}
    holdMs={text.length > 80 ? 6000 : 3500} onDone={() => { controller.dismissNotice() }} />
}
