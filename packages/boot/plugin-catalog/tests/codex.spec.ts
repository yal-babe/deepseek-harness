import { describe, expect, it } from 'vitest'
import {
  codexEntry,
  detectKinds,
  parseCodexMarketplace,
  parseCodexPluginManifest,
} from '../src/codex.ts'

describe('parseCodexMarketplace', () => {
  it('requires a plugins array of named objects', () => {
    const market = parseCodexMarketplace({
      name: 'openai-plugins',
      plugins: [{ name: 'figma', category: 'design' }],
    })
    expect(market.plugins[0]?.name).toBe('figma')
    expect(() => parseCodexMarketplace([])).toThrow(/JSON object/)
    expect(() => parseCodexMarketplace({ plugins: [{}] })).toThrow(/requires name/)
  })
})

describe('detectKinds / codexEntry', () => {
  it('labels skill-only plugins as partial and hooks-only as unsupported', () => {
    expect(detectKinds(undefined, { skills: true, mcp: false, hooks: false })).toEqual(['skill'])
    const skill = codexEntry(
      { name: 'demo' },
      {
        version: '0.1.0',
        interface: { displayName: 'Demo', shortDescription: 'Skills only', developerName: 'OpenAI' },
      },
      { skills: true, mcp: false, hooks: false },
      false,
    )
    expect(skill.compatibility).toBe('partial')
    expect(skill.source).toBe('codex')
    expect(skill.title).toBe('Demo')

    const hooks = codexEntry(
      { name: 'hooks-only' },
      undefined,
      { skills: false, mcp: false, hooks: true },
      false,
    )
    expect(hooks.compatibility).toBe('unsupported')
    expect(hooks.kinds).toEqual(['hook'])
  })

  it('parses plugin.json objects', () => {
    const manifest = parseCodexPluginManifest({ name: 'x', skills: './skills' })
    expect(manifest.skills).toBe('./skills')
    expect(() => parseCodexPluginManifest('nope')).toThrow(/JSON object/)
  })
})
