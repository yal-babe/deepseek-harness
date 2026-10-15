import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  codexSkillsDir,
  disabledCodexSkillsDir,
  setCodexSkillsEnabled,
  installCodexSkills,
  parseCatalogId,
  uninstallCodexSkills,
} from '../src/install.ts'

const homes: string[] = []

afterEach(async () => {
  await Promise.all(homes.splice(0).map(async (home) => {
    await rm(home, { recursive: true, force: true })
  }))
})

describe('parseCatalogId', () => {
  it('splits community and codex ids', () => {
    expect(parseCatalogId('community:a/b')).toEqual({ source: 'community', key: 'a/b' })
    expect(parseCatalogId('codex:figma')).toEqual({ source: 'codex', key: 'figma' })
    expect(parseCatalogId('other:x')).toBeUndefined()
  })
})

describe('installCodexSkills', () => {
  it('writes SKILL.md files under $DSH_HOME/skills/codex-<name>', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-catalog-'))
    homes.push(home)
    const result = await installCodexSkills(
      'demo',
      ['alpha'],
      async () => '# Alpha\n',
      { dshHome: home, skillsDir: 'skills' },
    )
    expect(result.ok).toBe(true)
    const body = await readFile(join(codexSkillsDir('demo', home), 'alpha', 'SKILL.md'), 'utf8')
    expect(body).toBe('# Alpha\n')

    const removed = await uninstallCodexSkills('demo', home)
    expect(removed.ok).toBe(true)
  })

  it('refuses an empty skill list', async () => {
    const result = await installCodexSkills('demo', [], async () => '')
    expect(result).toMatchObject({ ok: false, code: 'unsupported' })
  })
})

describe('Codex activation', () => {
  it('retains disabled files, preserves disablement on update, and removes both states', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-catalog-'))
    homes.push(home)
    await installCodexSkills('demo', ['alpha'], async () => '# Alpha', { dshHome: home })
    expect(await setCodexSkillsEnabled('demo', false, home)).toMatchObject({ ok: true, code: 'disabled' })
    await expect(readFile(join(codexSkillsDir('demo', home), 'alpha/SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(disabledCodexSkillsDir('demo', home), 'alpha/SKILL.md'), 'utf8')).toBe('# Alpha')
    await installCodexSkills('demo', ['alpha'], async () => '# Updated', { dshHome: home })
    await setCodexSkillsEnabled('demo', true, home)
    expect(await readFile(join(codexSkillsDir('demo', home), 'alpha/SKILL.md'), 'utf8')).toBe('# Updated')
    await setCodexSkillsEnabled('demo', false, home)
    await uninstallCodexSkills('demo', home)
    await expect(readFile(join(disabledCodexSkillsDir('demo', home), 'alpha/SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects paths outside the Codex installation directory', () => {
    expect(() => codexSkillsDir('../../outside')).toThrow('Invalid Codex plugin name.')
    expect(() => disabledCodexSkillsDir('../outside')).toThrow('Invalid Codex plugin name.')
  })

  it('reports a missing installation without claiming activation', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-catalog-'))
    homes.push(home)
    expect(await setCodexSkillsEnabled('missing', true, home)).toMatchObject({ ok: false, code: 'failed' })
  })
})
