// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StudioForm } from '../src/client/StudioAccount.tsx'
import type { StudioOperations, StudioSnapshot } from '../src/client/StudioAccount.tsx'
import type { StudioUserId } from '@deepseek-ai/dsh-studio-cloud/types'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function mockOperations(overrides?: Partial<StudioOperations>): StudioOperations {
  return {
    studioConfigureServer: vi.fn(),
    studioConfigureSync: vi.fn(),
    studioUnlockCredentials: vi.fn(),
    studioLogin: vi.fn(),
    studioLogout: vi.fn(),
    studioChangePassword: vi.fn(),
    studioRefresh: vi.fn(),
    studioPreview: vi.fn(),
    studioSelect: vi.fn(),
    studioPause: vi.fn(),
    studioAction: vi.fn(),
    studioDevices: vi.fn(),
    studioRevoke: vi.fn(),
    studioHistories: vi.fn(),
    studioReadHistory: vi.fn(),
    studioProjects: vi.fn(),
    studioBindProject: vi.fn(),
    studioUnbindProject: vi.fn(),
    studioForkHistory: vi.fn().mockResolvedValue({ sessionId: 'session-child-123' }),
    studioTokenActivity: vi.fn(),
    studioRestoredPlugins: vi.fn(),
    studioUpdateProfile: vi.fn(),
    ...overrides,
  }
}

describe('StudioForm', () => {
  it('renders project bindings and triggers bind and unbind', async () => {
    const operations = mockOperations()
    const snapshot: StudioSnapshot = {
      state: {
        origin: 'https://cloud.example.com',
        identity: { id: 'user-1' as StudioUserId, username: 'testuser', displayName: 'Test User', email: null, mustChangePassword: false },
        phase: 'ready',
        usedBytes: 1000,
        quotaBytes: 100000,
        pending: 0,
      },
      visible: true,
      error: false,
      projects: [
        { id: 'proj-bound', title: 'Bound Project', localId: 'ws-1' },
        { id: 'proj-unbound', title: 'Unbound Project', localId: null },
      ],
    }

    render(<StudioForm snapshot={snapshot} t={key => en[key]} {...operations} />)

    expect(screen.getByText('Bound Project')).toBeDefined()
    expect(screen.getByText('Unbound Project')).toBeDefined()
    expect(screen.getByText(/Bound to local workspace: ws-1/)).toBeDefined()

    // Click unbind
    const unbindBtn = screen.getByText(en.studioUnbindProject)
    await act(async () => {
      fireEvent.click(unbindBtn)
    })
    expect(operations.studioUnbindProject).toHaveBeenCalledWith('proj-bound')

    // Bind unbound project
    const input = screen.getByPlaceholderText(en.studioWorkspaceSelect)
    fireEvent.change(input, { target: { value: 'ws-new' } })
    const bindBtn = screen.getByText(en.studioBindProject)
    await act(async () => {
      fireEvent.click(bindBtn)
    })
    expect(operations.studioBindProject).toHaveBeenCalledWith('proj-unbound', 'ws-new')
  })

  it('renders downloaded histories and triggers fork continuation', async () => {
    const operations = mockOperations()
    const snapshot: StudioSnapshot = {
      state: {
        origin: 'https://cloud.example.com',
        identity: { id: 'user-1' as StudioUserId, username: 'testuser', displayName: 'Test User', email: null, mustChangePassword: false },
        phase: 'ready',
        usedBytes: 1000,
        quotaBytes: 100000,
        pending: 0,
      },
      visible: true,
      error: false,
      histories: [
        { id: 'hist-1', version: 1, title: 'Saved Conversation', sourceSessionId: 'sess-1', throughSeq: 5, missing: [] },
      ],
    }

    render(<StudioForm snapshot={snapshot} t={key => en[key]} {...operations} />)

    expect(screen.getByText('Saved Conversation')).toBeDefined()

    const input = screen.getByPlaceholderText(en.studioWorkspaceSelect)
    fireEvent.change(input, { target: { value: 'ws-target' } })

    const forkBtn = screen.getByText(en.studioForkHistory)
    fireEvent.click(forkBtn)
    expect(operations.studioForkHistory).toHaveBeenCalledWith('hist-1', 'ws-target')
  })

  it('displays token activity and restored plugins', async () => {
    const operations = mockOperations()
    const snapshot: StudioSnapshot = {
      state: {
        origin: 'https://cloud.example.com',
        identity: { id: 'user-1' as StudioUserId, username: 'testuser', displayName: 'Test User', email: null, mustChangePassword: false },
        phase: 'ready',
        usedBytes: 1000,
        quotaBytes: 100000,
        pending: 0,
      },
      visible: true,
      error: false,
      tokenActivity: {
        totalTokens: 5500,
        inputTokens: 3500,
        outputTokens: 1500,
        cacheReadTokens: 500,
        cacheWriteTokens: 0,
        reasoningTokens: 200,
        turnsCount: 12,
        sessionsCount: 3,
      },
      restoredPlugins: [
        { moduleName: '@plugin/python', enabled: true, version: '1.2.0', installed: true },
        { moduleName: '@plugin/rust', enabled: false, installed: false },
      ],
    }

    render(<StudioForm snapshot={snapshot} t={key => en[key]} {...operations} />)

    expect(screen.getByText(/Recorded tokens: 5,500/)).toBeDefined()
    expect(screen.getByText(/Input tokens: 3,500/)).toBeDefined()
    expect(screen.getByText(/Turns: 12/)).toBeDefined()

    expect(screen.getByText(/@plugin\/python @ 1.2.0/)).toBeDefined()
    expect(screen.getByText(/Installed · Enabled/)).toBeDefined()
    expect(screen.getByText(/@plugin\/rust/)).toBeDefined()
    expect(screen.getByText(/Not installed · Disabled/)).toBeDefined()
  })

  it('triggers updateProfile when editing display name', async () => {
    const operations = mockOperations()
    const snapshot: StudioSnapshot = {
      state: {
        origin: 'https://cloud.example.com',
        identity: { id: 'user-1' as StudioUserId, username: 'testuser', displayName: 'Initial Name', email: null, mustChangePassword: false },
        phase: 'ready',
        usedBytes: 1000,
        quotaBytes: 100000,
        pending: 0,
      },
      visible: true,
      error: false,
    }

    render(<StudioForm snapshot={snapshot} t={key => en[key]} {...operations} />)

    const nameInput = screen.getByPlaceholderText(en.studioDisplayName)
    fireEvent.change(nameInput, { target: { value: 'New Name' } })

    const updateBtn = screen.getByText(en.studioUpdateProfile)
    fireEvent.click(updateBtn)
    expect(operations.studioUpdateProfile).toHaveBeenCalledWith('New Name')
  })
})

it('requires explicit category and automatic-sync choices, and keeps credentials locked until passphrase entry', async () => {
  const operations = mockOperations()
  render(<StudioForm snapshot={{ visible: false, error: false, state: {
    origin: 'https://cloud.test', identity: { id: 'user-1' as StudioUserId, username: 'personal', displayName: 'Personal', email: null, mustChangePassword: false },
    phase: 'preview-required', usedBytes: 0, quotaBytes: 100000, pending: 0, uploadCategories: [], automatic: false, credentialsLocked: true,
  } }} t={key => en[key]} {...operations} />)
  expect(operations.studioConfigureSync).not.toHaveBeenCalled()
  expect(screen.getByRole('checkbox', { name: en['studioCategory.deepseek'] }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('checkbox', { name: en.studioAutomatic }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('checkbox', { name: en['studioCategory.settings'] }))
  fireEvent.click(screen.getByRole('checkbox', { name: en.studioAutomatic }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: en.studioSaveSync })))
  expect(operations.studioConfigureSync).toHaveBeenCalledWith(['settings'], true)
  fireEvent.change(screen.getByLabelText(en.studioSyncPassphrase), { target: { value: 'independent-passphrase' } })
  fireEvent.change(screen.getByLabelText(en.studioConfirmPassphrase), { target: { value: 'independent-passphrase' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: en.studioUnlockCredentials })))
  expect(operations.studioUnlockCredentials).toHaveBeenCalledWith('independent-passphrase')
  expect((screen.getByLabelText(en.studioSyncPassphrase) as HTMLInputElement).value).toBe('')
})
