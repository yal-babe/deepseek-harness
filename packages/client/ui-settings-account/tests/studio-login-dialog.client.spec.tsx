// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { StudioLoginDialog } from '../src/client/StudioLoginDialog.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

it('shows a static preview and dismisses without other actions', () => {
  const onClose = vi.fn()
  render(<StudioLoginDialog t={key => en[key]} onClose={onClose} />)
  expect(screen.getByText(en.studioPreviewDescription)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.studioPreviewClose }))
  expect(onClose).toHaveBeenCalledOnce()
})
