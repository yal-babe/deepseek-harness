import { describe, expect, it } from 'vitest'
import { filterCatalog, sortCatalog } from '../src/query.ts'
import type { CatalogEntry } from '../src/types.ts'

function entry(partial: Partial<CatalogEntry> & Pick<CatalogEntry, 'id' | 'title'>): CatalogEntry {
  return {
    source: 'community',
    kind: 'bundle',
    kinds: ['bundle'],
    compatibility: 'full',
    name: partial.title,
    description: '',
    author: 'a',
    installed: false,
    ...partial,
  }
}

describe('filterCatalog', () => {
  it('filters by query, category, kind, and installed-only', () => {
    const rows = [
      entry({ id: 'community:a/ui', title: 'Sidebar', category: 'interface', installed: true }),
      entry({
        id: 'codex:figma', title: 'Figma', source: 'codex', kind: 'skill', kinds: ['skill', 'mcp'],
        category: 'tools', installed: false,
      }),
      entry({ id: 'community:b/tool', title: 'Modlens', category: 'tools', description: 'vision ocr' }),
    ]
    expect(filterCatalog(rows, { query: 'ocr' }).map(row => row.id)).toEqual(['community:b/tool'])
    expect(filterCatalog(rows, { category: 'interface' })).toHaveLength(1)
    expect(filterCatalog(rows, { kind: 'mcp' }).map(row => row.id)).toEqual(['codex:figma'])
    expect(filterCatalog(rows, { installedOnly: true })).toHaveLength(1)
  })
})

describe('sortCatalog', () => {
  it('orders by stars, forks, updated, and added', () => {
    const rows = [
      entry({ id: 'a', title: 'A', stars: 1, forks: 9, updatedAt: '2026-01-01', addedAt: '2026-02-01' }),
      entry({ id: 'b', title: 'B', stars: 5, forks: 1, updatedAt: '2026-03-01', addedAt: '2026-01-01' }),
    ]
    expect(sortCatalog(rows, 'stars').map(row => row.id)).toEqual(['b', 'a'])
    expect(sortCatalog(rows, 'forks').map(row => row.id)).toEqual(['a', 'b'])
    expect(sortCatalog(rows, 'updated').map(row => row.id)).toEqual(['b', 'a'])
    expect(sortCatalog(rows, 'added').map(row => row.id)).toEqual(['a', 'b'])
  })
})
