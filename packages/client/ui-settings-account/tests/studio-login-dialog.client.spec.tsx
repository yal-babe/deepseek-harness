// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { StudioLoginDialog } from '../src/client/StudioLoginDialog.tsx'
import { en, zh } from '../src/client/locales.ts'

import type { StudioOperations } from '../src/client/StudioAccount.tsx'

afterEach(cleanup)

function mockOperations(overrides: Partial<StudioOperations> = {}): StudioOperations {
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
    studioForkHistory: vi.fn().mockResolvedValue({ sessionId: 'child-1' }),
    studioTokenActivity: vi.fn(),
    studioRestoredPlugins: vi.fn(),
    studioUpdateProfile: vi.fn(),
    ...overrides,
  }
}

it('requires explicit service credentials and does not upload data when opening', async () => {
  const studioLogin = vi.fn(async () => {})
  render(
    <StudioLoginDialog
      t={key => en[key]}
      onClose={vi.fn()}
      snapshot={{ state: { origin: 'http://cloud.example.test', identity: null, phase: 'signed-out',
        usedBytes: null, quotaBytes: null, pending: 0 }, visible: true, error: false }}
      {...mockOperations({ studioLogin })}
    />,
  )
  expect(screen.getByText(en.studioLocalDescription)).toBeTruthy()
  expect(studioLogin).not.toHaveBeenCalled()
  expect(screen.queryByLabelText(en.studioOrigin)).toBeNull()
  expect(screen.queryByRole('checkbox')).toBeNull()
  fireEvent.change(screen.getByLabelText(en.studioUsername), { target: { value: 'personal' } })
  fireEvent.change(screen.getByLabelText(en.studioPassword), { target: { value: 'test-password' } })
  fireEvent.click(screen.getByRole('button', { name: en.signIn }))
  expect(studioLogin).toHaveBeenCalledWith('http://cloud.example.test', 'personal', 'test-password', '', true)
})

for (const [language,copy] of [['en',en],['zh',zh]] as const) it(`records the Studio account consent form in ${language}`, async()=>{
  const view=render(<StudioLoginDialog t={key=>copy[key]} onClose={vi.fn()}
    snapshot={{ state:null,visible:true,error:false }} {...mockOperations()} />)
  await expect(`${view.baseElement.textContent}\n`).toMatchFileSnapshot(`./expected/studio-login-${language}.txt`)
})
