import { describe, expect, it } from 'vitest'
import {
  communityEntry,
  installSpecFromCommands,
  parseCommunityFeed,
} from '../src/community.ts'

describe('parseCommunityFeed', () => {
  it('accepts compact wire rows and refuses a non-array body', () => {
    const rows = parseCommunityFeed([
      { s: 'hub', o: 'alice', n: 'dsh-plugin-hub', r: 'alice/hub', ic: 'dsh plugin add @alice/hub', v: 'verified', sg: 12 },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.s).toBe('hub')
    expect(() => parseCommunityFeed({})).toThrow(/JSON array/)
    expect(() => parseCommunityFeed([{ s: 'x' }])).toThrow(/requires s, o, and n/)
  })
})

describe('installSpecFromCommands', () => {
  it('prefers add targets and falls back to github:owner/repo', () => {
    expect(installSpecFromCommands('dsh plugin add @scope/pkg', undefined, 'o/r')).toBe('@scope/pkg')
    expect(installSpecFromCommands(undefined, 'dsh plugin add github:o/r', 'o/r')).toBe('github:o/r')
    expect(installSpecFromCommands(undefined, undefined, 'owner/repo')).toBe('github:owner/repo')
  })
})

describe('communityEntry', () => {
  it('marks installed packages and unsupported listings without a spec', () => {
    const installed = communityEntry(
      {
        s: 'hub', o: 'alice', n: '@alice/hub', r: 'alice/hub',
        ic: 'dsh plugin add @alice/hub', d: 'Hub UI', vr: 'v1.2.0',
      },
      new Set(['@alice/hub']),
      new Map([['@alice/hub', '1.1.0']]),
    )
    expect(installed.id).toBe('community:alice/hub')
    expect(installed.compatibility).toBe('full')
    expect(installed.installed).toBe(true)
    expect(installed.installedVersion).toBe('1.1.0')
    expect(installed.version).toBe('1.2.0')
    expect(installed.updateAvailable).toBe(true)

    const bare = communityEntry(
      { s: 'x', o: 'o', n: 'X', r: '!!!' },
      new Set(),
      new Map(),
    )
    expect(bare.compatibility).toBe('unsupported')
    expect(bare.installSpec).toBeUndefined()
    expect(bare.updateAvailable).toBe(false)
  })

  it('copies stars, forks, and addedAt from the wire row', () => {
    const row = communityEntry(
      {
        s: 'hub', o: 'alice', n: 'Hub', r: 'alice/hub',
        sg: 7000, fk: 182, a: '2026-01-02', u: '2026-10-01', c: 'tools',
      },
      new Set(),
      new Map(),
    )
    expect(row.stars).toBe(7000)
    expect(row.forks).toBe(182)
    expect(row.addedAt).toBe('2026-01-02')
    expect(row.category).toBe('tools')
  })
})

it('preserves repository objects from the community feed for artwork lookup', () => {
  const [row] = parseCommunityFeed([{ s: 'hub', o: 'alice', n: 'hub',
    r: { repo: 'alice/hub', npmPackage: '@alice/hub' } }])
  expect(row?.r).toBe('alice/hub')
})
