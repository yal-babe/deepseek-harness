// @vitest-environment jsdom
/** Marketplace section: Hub tabs, categories, Codex source, cards, and detail. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CatalogEntry, CatalogSearchResult } from '@deepseek-ai/dsh-api-remotes/client'
import { MarketplaceSection } from '../src/client/MarketplaceSection.tsx'
import type { MarketplaceSectionProps } from '../src/client/MarketplaceSection.tsx'
import { en } from '../src/client/locales.ts'
import type { MarketplaceState } from '../src/client/store.ts'

afterEach(cleanup)

const sample: CatalogEntry = {
  id: 'community:alice/hub',
  source: 'community',
  kind: 'bundle',
  kinds: ['bundle'],
  compatibility: 'full',
  name: '@alice/hub',
  title: 'Plugin Hub',
  description: 'Community hub UI',
  author: 'alice',
  version: '1.0.0',
  category: 'tools',
  stars: 7000,
  forks: 182,
  verified: true,
  installed: false,
}

const result: CatalogSearchResult = {
  entries: [sample],
  total: 1,
  page: 1,
  pageSize: 24,
  queryTotal: 1,
  installedCount: 0,
}

function idleState(overrides: Partial<MarketplaceState> = {}): MarketplaceState {
  return {
    layout: 'cards',
    tab: 'market',
    status: 'idle',
    errorMessage: null,
    query: '',
    source: 'all',
    category: 'all',
    kind: 'all',
    sort: 'stars',
    page: 1,
    pageSize: 24,
    result: null,
    detail: null,
    detailStatus: 'idle',
    operations: {},
    notice: null,
    customSpec: '',
    ...overrides,
  }
}

function renderSection(state: MarketplaceState, overrides: Partial<{
  load: () => void
  setSource: (source: 'all' | 'community' | 'codex') => void
  setTab: (tab: 'market' | 'installed' | 'custom') => void
  setCategory: (category: string) => void
  setSort: (sort: 'stars' | 'forks' | 'updated' | 'added') => void
  openDetail: (id: string) => Promise<void>
  clearDetail: () => void
}> = {}) {
  const controller = {
    load: overrides.load ?? vi.fn(),
    setQuery: vi.fn(),
    setLayout: vi.fn(),
    setSource: overrides.setSource ?? vi.fn(),
    setTab: overrides.setTab ?? vi.fn(),
    setCategory: overrides.setCategory ?? vi.fn(),
    setKind: vi.fn(),
    setSort: overrides.setSort ?? vi.fn(),
    setPage: vi.fn(),
    setCustomSpec: vi.fn(),
    clearDetail: overrides.clearDetail ?? vi.fn(),
    openDetail: overrides.openDetail ?? vi.fn(async () => {}),
    install: vi.fn(async () => {}),
    setEnabled: vi.fn(async () => {}),
    uninstall: vi.fn(async () => {}),
    installCustom: vi.fn(async () => {}),
    dismissNotice: vi.fn(),
    store: {
      getSnapshot: () => state,
      subscribe: () => () => {},
      update: () => {},
      set: () => {},
    },
  }
  const props = {
    t: (key: keyof typeof en, params?: Record<string, unknown>) => {
      let text = en[key]
      if (params !== undefined) {
        for (const [name, value] of Object.entries(params)) {
          text = text.replaceAll(`{${name}}`, String(value))
        }
      }
      return text
    },
    controller,
    useSnapshot: (selector: (value: MarketplaceState) => unknown) => selector(state),
  } as unknown as MarketplaceSectionProps
  render(<MarketplaceSection {...props} />)
  return controller
}

describe('MarketplaceSection', () => {
  it('loads on first idle render and shows catalog cards', () => {
    const load = vi.fn()
    renderSection(idleState(), { load })
    expect(load).toHaveBeenCalledOnce()
  })

  it('renders Hub chrome: tabs, categories, sort, and a card', () => {
    renderSection(idleState({ status: 'ready', result }))
    expect(screen.getByRole('heading', { name: en.title })).toBeTruthy()
    expect(screen.getByRole('tab', { name: en.tabMarket })).toBeTruthy()
    expect(screen.getByText('Plugin Hub')).toBeTruthy()
    expect(screen.getByText(en.verified)).toBeTruthy()
    expect(screen.getByText(en.catToolsFull)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.install })).toBeTruthy()
    expect(screen.getByRole('button', { name: en.sortUpdated })).toBeTruthy()
  })

  it('shows progress inside only the active installation button', () => {
    const other = { ...sample, id: 'codex:other', title: 'Other plugin' }
    renderSection(idleState({ status: 'ready', result: { ...result, entries: [sample, other] },
      operations: { [sample.id]: { mode: 'install', percent: 35 } } }))
    const progress = screen.getByRole('progressbar', { name: en.installing })
    expect(progress.getAttribute('aria-valuenow')).toBe('35')
    expect(screen.getByRole('button', { name: `${en.installing} 35%` }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: en.install }).hasAttribute('disabled')).toBe(false)
  })

  it('displays artwork and toggles installed plugin activation', () => {
    const controller = renderSection(idleState({ status: 'ready', result: {
      ...result, entries: [{ ...sample, installed: true, enabled: true, iconUrl: 'https://example.com/icon.svg' }],
    } }))
    expect(document.querySelector('img')?.getAttribute('src')).toBe('https://example.com/icon.svg')
    fireEvent.error(document.querySelector('img')!)
    expect(document.querySelector('img')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.disable }))
    expect(controller.setEnabled).toHaveBeenCalledWith(sample.id, false)
  })

  it('switches source filters including Codex', () => {
    const setSource = vi.fn()
    renderSection(idleState({ status: 'ready', result }), { setSource })
    fireEvent.click(screen.getByRole('button', { name: en.sourceCodex }))
    expect(setSource).toHaveBeenCalledWith('codex')
  })

  it('switches Hub categories and sort', () => {
    const setCategory = vi.fn()
    const setSort = vi.fn()
    renderSection(idleState({ status: 'ready', result }), { setCategory, setSort })
    fireEvent.click(screen.getByRole('button', { name: en.catSession }))
    expect(setCategory).toHaveBeenCalledWith('session')
    fireEvent.click(screen.getByRole('button', { name: en.sortForks }))
    expect(setSort).toHaveBeenCalledWith('forks')
  })

  it('opens the custom install tab', () => {
    const setTab = vi.fn()
    renderSection(idleState({ status: 'ready', result }), { setTab })
    fireEvent.click(screen.getByRole('tab', { name: en.tabCustom }))
    expect(setTab).toHaveBeenCalledWith('custom')
  })

  it('shows a retryable feed failure', () => {
    const load = vi.fn()
    renderSection(idleState({ status: 'error', errorMessage: 'network down' }), { load })
    expect(screen.getByRole('alert').textContent).toContain(en.feedFailed)
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(load).toHaveBeenCalled()
  })

  it('renders detail with install disabled for unsupported entries', () => {
    const clearDetail = vi.fn()
    renderSection(idleState({
      status: 'ready',
      source: 'codex',
      result,
      detail: {
        ...sample,
        id: 'codex:hooks',
        source: 'codex',
        kind: 'hook',
        kinds: ['hook'],
        compatibility: 'unsupported',
        title: 'Hooks Only',
        compatibilityNote: 'Hooks are not one-click installable.',
      },
    }), { clearDetail })
    expect(screen.getByRole('heading', { name: 'Hooks Only' })).toBeTruthy()
    expect(screen.getByRole('button', { name: en.unsupported }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: en.close }))
    expect(clearDetail).toHaveBeenCalled()
  })
})

describe('marketplace presentation', () => {
  it('offers cards and list views and forwards the selected layout', () => {
    const controller = renderSection(idleState({ status: 'ready', result }))
    fireEvent.click(screen.getByRole('button', { name: en.layoutList }))
    expect(controller.setLayout).toHaveBeenCalledWith('list')
    expect(screen.getByRole('button', { name: en.layoutCards }).getAttribute('aria-pressed')).toBe('true')
  })

  it('renders the selected list layout and its visible actions', () => {
    renderSection(idleState({ status: 'ready', result, layout: 'list' }))
    const group = screen.getByRole('group', { name: en.layout })
    expect({
      layout: document.querySelector('ul[data-layout]')?.getAttribute('data-layout'),
      modes: Array.from(group.querySelectorAll('button'), button => button.textContent),
      detail: screen.getByRole('button', { name: en.detail }).textContent,
    }).toMatchInlineSnapshot(`
      {
        "detail": "Details",
        "layout": "list",
        "modes": [
          "Cards",
          "List",
        ],
      }
    `)
  })

  it('formats detail headings, lists, code and safe links as Markdown', () => {
    renderSection(idleState({ status: 'ready', result, detail: {
      ...sample, readme: '### Usage\n\n- **Enable** the plugin\n\n`demo`\n\n[Docs](https://example.com)',
    } }))
    expect(screen.getByRole('heading', { name: 'Usage' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Docs' }).getAttribute('href')).toBe('https://example.com')
    expect(document.querySelector('strong')?.textContent).toBe('Enable')
  })
})
