/** Host loader entry is a no-op. */
import { expect, it } from 'vitest'
import { apply } from '../src/index.ts'

it('loads as a host entry without side effects', () => {
  expect(apply()).toBeUndefined()
})
