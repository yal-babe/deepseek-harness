import { z } from 'zod'

const schema = z.object({
 DATABASE_URL: z.string().url(),
 MASTER_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/, 'MASTER_KEY must be 32 random bytes in hex'),
 PUBLIC_URL: z.url().default('http://localhost:8788'),
 ALLOW_HTTP: z.enum(['true', 'false']).default('false'),
 HOST: z.string().default('0.0.0.0'), PORT: z.coerce.number().int().min(1).max(65535).default(8788),
 DATA_DIR: z.string().default('./data'),
 FILE_PART_BYTES: z.coerce.number().int().min(65536).max(4194304).default(1048576),
 FILE_MAX_BYTES: z.coerce.number().int().min(1).max(1073741824).default(67108864),
 ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
 REFRESH_TTL_SECONDS: z.coerce.number().int().min(3600).max(7776000).default(2592000),
 BOOTSTRAP_ADMIN: z.string().regex(/^[a-z0-9][a-z0-9_.-]{2,31}$/).default('admin'),
 BOOTSTRAP_PASSWORD: z.preprocess(v => v === '' ? undefined : v,z.string().min(12).optional()),
})
export type Config = ReturnType<typeof loadConfig>
/** Load only declared settings, rejecting insecure protocol ambiguity at startup. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
 const c = schema.parse(env)
 const url = new URL(c.PUBLIC_URL)
 if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
  throw new Error('PUBLIC_URL must be an HTTP(S) origin without credentials or path')
 if (url.protocol === 'http:' && c.ALLOW_HTTP !== 'true') throw new Error('HTTP requires explicit ALLOW_HTTP=true')
 return { ...c, PUBLIC_URL: url.origin, secureCookie: url.protocol === 'https:' }
}
