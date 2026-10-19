/** Installed server identity, independently versioned from the Desktop and sync protocol. */
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { valid } from 'semver'

export const serverVersion = z.object({ version: z.string().refine(value => valid(value) === value) })
 .parse(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))).version
