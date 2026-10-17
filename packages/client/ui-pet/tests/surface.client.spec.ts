// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { desktopPetBridge, detectPetSurface, type DesktopPetBridge } from '../src/client/surface.ts'

const bridge = (role: 'pet' | 'main'): DesktopPetBridge => ({
  protocolVersion: 1, role, setInteractive: () => {}, setVisible: () => {}, openMain: () => {}, onQuickAsk: () => () => {},
  onOpenSession: () => () => {},
  onVisibleRequest: () => () => {}, drag: () => {},
})

describe('desktopPetBridge', () => {
  it('accepts only protocol version 1 objects', () => {
    expect(desktopPetBridge({})).toBeUndefined()
    expect(desktopPetBridge({ dshDesktopPet: null })).toBeUndefined()
    expect(desktopPetBridge({ dshDesktopPet: { protocolVersion: 2 } })).toBeUndefined()
    const valid = bridge('pet')
    expect(desktopPetBridge({ dshDesktopPet: valid })).toBe(valid)
  })
})

describe('detectPetSurface', () => {
  it('chooses window, page, or none', () => {
    expect(detectPetSurface('?dsh-pet-window=1', bridge('pet'))).toBe('window')
    expect(detectPetSurface('?dsh-pet-window=1', undefined)).toBe('window')
    expect(detectPetSurface('', undefined)).toBe('page')
    expect(detectPetSurface('?dsh-pet-window=0', bridge('pet'))).toBe('page')
    expect(detectPetSurface('', bridge('main'))).toBe('none')
  })
})
