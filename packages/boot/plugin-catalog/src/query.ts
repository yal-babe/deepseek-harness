/** Host-side catalog filter and Hub-matching sort. */

import type { CatalogEntry, CatalogKind, CatalogSort } from './types.ts'

/**
 * Filter catalog rows by text, Hub category, Codex kind, and installed-only.
 * @param entries - normalized rows for the selected source.
 * @param options - search controls; omitted fields do not restrict.
 * @returns Filtered catalog entries array.
 */
export function filterCatalog(
  entries: readonly CatalogEntry[],
  options: {
    query?: string
    category?: string
    kind?: CatalogKind
    installedOnly?: boolean
  },
): CatalogEntry[] {
  const needle = (options.query ?? '').trim().toLowerCase()
  const category = options.category
  const kind = options.kind
  const installedOnly = options.installedOnly === true
  return entries.filter((entry) => {
    if (installedOnly && !entry.installed) return false
    if (category !== undefined && category.length > 0 && entry.category !== category) return false
    if (kind !== undefined && !entry.kinds.includes(kind)) return false
    if (needle.length === 0) return true
    return matchesCatalogQuery(entry, needle)
  })
}

/**
 * Sort a catalog page. Installed rows are not forced to the front; the Installed tab filters instead.
 * @param entries - filtered rows.
 * @param sort - Hub sort key; default stars.
 * @returns Sorted copy of catalog entries array.
 */
export function sortCatalog(
  entries: readonly CatalogEntry[],
  sort: CatalogSort = 'stars',
): CatalogEntry[] {
  const copy = [...entries]
  copy.sort((a, b) => compare(a, b, sort) || a.title.localeCompare(b.title))
  return copy
}

/**
 * Substring match over title, name, description, author, category, and tags.
 * @param entry - catalog row.
 * @param needle - already-lowercased query.
 * @returns True if entry matches needle.
 */
export function matchesCatalogQuery(entry: CatalogEntry, needle: string): boolean {
  const haystack = [
    entry.title,
    entry.name,
    entry.description,
    entry.author,
    entry.category ?? '',
    ...(entry.tags ?? []),
  ].join('\n').toLowerCase()
  return haystack.includes(needle)
}

function compare(a: CatalogEntry, b: CatalogEntry, sort: CatalogSort): number {
  switch (sort) {
    case 'stars':
      return (b.stars ?? 0) - (a.stars ?? 0)
    case 'forks':
      return (b.forks ?? 0) - (a.forks ?? 0)
    case 'updated':
      return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
    case 'added':
      return (b.addedAt ?? '').localeCompare(a.addedAt ?? '')
  }
}
