// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore, type ObservableSnapshot, type SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PetMotionView } from '@deepseek-ai/dsh-pet/types'
import { BUILTIN_FRAME_SET, type PetFrameSet } from '../src/client/frames.ts'
import { PetPreferenceStore } from '../src/client/preferences.ts'
import { PetSettingsSection, type PetSettingsProps } from '../src/client/PetSettingsSection.tsx'
import { addRestrictedTool, PetSettingsEditor, removeRestrictedTool, type PetSettingsFields } from '../src/client/settings.ts'

function hook<T>(source: ObservableSnapshot<T>): SnapshotSelectorHook<T> {
  return selector => useSyncExternalStore(listener => source.subscribe(listener), () => selector(source.getSnapshot()))
}

const t: PetSettingsProps['t'] = (key, params) => params === undefined ? key : `${key}:${Object.values(params).join(',')}`

const DEFAULTS: PetSettingsFields = {
  visible: true, restrictTools: false, restrictedTools: [], notifyWaiting: true, notifySuccess: true, notifyError: true,
}

function formOf(snapshot: Partial<ConfigFormSnapshot<PetSettingsFields>>, set = vi.fn(async (_field: string, _value: unknown) => true)) {
  const store = createSnapshotStore<ConfigFormSnapshot<PetSettingsFields>>({
    status: 'ready', value: DEFAULTS, base: undefined, user: undefined, revision: 1, writable: true, ...snapshot,
  }, { flush: 'sync' })
  const form: ConfigForm<PetSettingsFields> = {
    getSnapshot: () => store.getSnapshot(),
    subscribe: listener => store.subscribe(listener),
    set,
    mutate: vi.fn(async () => true),
    unset: vi.fn(async () => true),
  }
  return { store, form, set }
}

function mount(snapshot: Partial<ConfigFormSnapshot<PetSettingsFields>> = {},
  options: { canNotify?: boolean; desktop?: boolean; motion?: PetMotionView } = {}) {
  const { store, form, set } = formOf(snapshot)
  const editor = new PetSettingsEditor(form)
  const preferences = new PetPreferenceStore(undefined)
  const frames: PetFrameSet = options.motion === undefined ? BUILTIN_FRAME_SET : { ...BUILTIN_FRAME_SET, motion: options.motion }
  const pack = createSnapshotStore<PetFrameSet>(frames, { flush: 'sync' })
  const setDeviceNotify = vi.fn(async (on: boolean) => { preferences.update({ notify: on }); return on })
  const props = {
    t,
    useForm: hook(store),
    useWrite: hook(editor.state),
    usePreferences: hook(preferences.snapshot),
    usePack: hook(pack),
    desktop: options.desktop ?? false,
    canNotify: options.canNotify ?? true,
    setSwitch: (field, value) => editor.setSwitch(field, value),
    setRestrictedTools: tools => editor.setRestrictedTools(tools),
    setDeviceNotify,
    setPreferences: patch => preferences.update(patch),
  } as PetSettingsProps & PropsRuntime<'settings.section'>
  render(<PetSettingsSection {...props} />)
  return { store, set, setDeviceNotify, preferences }
}

afterEach(() => { cleanup() })

describe('restricted tool list edits', () => {
  it('adds trimmed new names and removes listed ones', () => {
    expect(addRestrictedTool(['bash'], '  write_file ')).toEqual(['bash', 'write_file'])
    expect(addRestrictedTool(['bash'], 'bash')).toBeUndefined()
    expect(addRestrictedTool([], '   ')).toBeUndefined()
    expect(removeRestrictedTool(['bash', 'write_file'], 'bash')).toEqual(['write_file'])
  })
})

describe('PetSettingsEditor', () => {
  it('flags refused and failed writes and clears the flag on success', async () => {
    const set = vi.fn(async (_field: string, _value: unknown) => false)
    const editor = new PetSettingsEditor(formOf({}, set).form)
    expect(await editor.setSwitch('visible', false)).toBe(false)
    expect(editor.state.getSnapshot()).toEqual({ busy: false, failed: true })
    set.mockRejectedValueOnce(new Error('offline'))
    expect(await editor.setRestrictedTools(['bash'])).toBe(false)
    set.mockResolvedValueOnce(true)
    expect(await editor.setSwitch('visible', false)).toBe(true)
    expect(editor.state.getSnapshot()).toEqual({ busy: false, failed: false })
  })
})

describe('PetSettingsSection', () => {
  it('writes switches through the Host form and explains browser mode', async () => {
    const { set } = mount()
    expect(screen.getByText('settings.modeBrowser')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'settings.visible' })) })
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'settings.notifySuccess' })) })
    expect(set.mock.calls).toEqual([['visible', false], ['notifySuccess', false]])
    expect(screen.queryByRole('textbox', { name: 'settings.toolName' })).toBeNull()
  })

  it('credits the upstream character source with a link', () => {
    mount()
    expect(screen.getByText('settings.credit')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'https://github.com/PC2005-cloud/dsh-pet' })
    expect(link.getAttribute('href')).toBe('https://github.com/PC2005-cloud/dsh-pet')
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('changes local animation options without writing Host configuration', () => {
    const { set } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'settings.lively' }))
    expect(screen.getByRole('button', { name: 'settings.lively' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('switch', { name: 'settings.roam' }))
    expect(screen.getByRole('switch', { name: 'settings.roam' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('switch', { name: 'settings.effects' }))
    expect(screen.getByRole('switch', { name: 'settings.effects' }).getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByRole('switch', { name: 'settings.interactive' }))
    fireEvent.click(screen.getByRole('switch', { name: 'settings.reducedMotion' }))
    expect(set).not.toHaveBeenCalled()
  })

  it('turns local lines off and lists the pack-only clips of the autonomous chain in the device allowlist', () => {
    const clip = (extra: object = {}) => ({ url: 'x.webm', loop: false, durationMs: 1000, ...extra })
    const motion: PetMotionView = {
      width: 412, height: 344, chain: { idle: 1, turn: 1, move: 1 },
      clips: {
        idle: clip(), idle_stretch: clip(), sign: clip({ label: { zh: '举牌', en: 'Sign' } }), look_around: clip({ turn: true }),
        balance_full: clip(), menu_only: clip(),
      },
      categories: [
        { id: 'small', label: { zh: '小', en: 'Small' }, weight: 1, life: ['idle'], clips: ['idle_stretch', 'sign'] },
        { id: 'menu', label: { zh: '菜单', en: 'Menu' }, weight: 0, life: [], clips: ['menu_only'] },
      ],
      events: { balance: [['balance_full'], ['balance_full'], ['balance_full'], ['balance_full'], ['balance_full'], ['balance_full']] },
    }
    const { preferences } = mount({}, { motion })
    fireEvent.click(screen.getByRole('switch', { name: 'settings.lines' }))
    expect(preferences.snapshot.getSnapshot().lines).toBe(false)
    expect(screen.getByText('settings.packClips')).toBeTruthy()
    // Named interactions keep their own switches; menu-only and event clips are never drawn, so they are not listed.
    expect(screen.queryByRole('switch', { name: 'idle_stretch' })).toBeNull()
    expect(screen.queryByRole('switch', { name: 'menu_only' })).toBeNull()
    expect(screen.queryByRole('switch', { name: 'balance_full' })).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: '举牌' }))
    expect(preferences.snapshot.getSnapshot().clips).toEqual(['look_around'])
    fireEvent.click(screen.getByRole('switch', { name: '举牌' }))
    expect(preferences.snapshot.getSnapshot().clips).toEqual(['look_around', 'sign'])
  })

  it('edits the restricted tool list while the restriction is on', async () => {
    const { set, store } = mount({ value: { ...DEFAULTS, restrictTools: true } }, { desktop: true })
    expect(screen.getByText('settings.modeDesktop')).toBeTruthy()
    expect(screen.getByText('settings.noTools')).toBeTruthy()
    const input = screen.getByRole('textbox', { name: 'settings.toolName' })
    const add = screen.getByRole('button', { name: 'settings.addTool' })
    expect((add as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(input, { target: { value: ' bash ' } })
    await act(async () => { fireEvent.click(add) })
    expect(set).toHaveBeenLastCalledWith('restrictedTools', ['bash'])
    expect((input as HTMLInputElement).value).toBe('')
    fireEvent.submit(input.closest('form')!)
    expect(set).toHaveBeenCalledTimes(1)
    act(() => { store.update((state) => { state.value = { ...DEFAULTS, restrictTools: true, restrictedTools: ['bash'] } }) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'settings.removeTool:bash' })) })
    expect(set).toHaveBeenLastCalledWith('restrictedTools', [])
  })

  it('toggles device notifications and shows unsupported platforms', async () => {
    const { setDeviceNotify } = mount()
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'settings.deviceNotify' })) })
    expect(setDeviceNotify).toHaveBeenCalledWith(true)
    expect(screen.getByRole('switch', { name: 'settings.deviceNotify' }).getAttribute('aria-checked')).toBe('true')
    cleanup()
    mount({}, { canNotify: false })
    expect(screen.getByText('settings.notifyUnsupported')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'settings.deviceNotify' }).hasAttribute('disabled')).toBe(true)
  })

  it('locks switches while loading or read-only and reports failures and missing entries', async () => {
    mount({ status: 'loading', value: undefined })
    expect(screen.getByRole('switch', { name: 'settings.visible' }).hasAttribute('disabled')).toBe(true)
    cleanup()
    const { set } = mount()
    set.mockResolvedValueOnce(false)
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'settings.restrictTools' })) })
    expect(screen.getByRole('alert').textContent).toBe('settings.saveFailed')
    cleanup()
    mount({ writable: false })
    expect(screen.getByRole('switch', { name: 'settings.visible' }).hasAttribute('disabled')).toBe(true)
    cleanup()
    mount({ status: 'unavailable', value: undefined })
    expect(screen.getByText('settings.unavailable')).toBeTruthy()
  })
})
