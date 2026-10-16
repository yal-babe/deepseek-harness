import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto'
import { hash, verify, Algorithm } from '@node-rs/argon2'

export const token = () => randomBytes(32).toString('base64url')
export const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export const passwordHash = (value: string) => hash(value, { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 })
export const passwordMatches = (value: string, encoded: string) => verify(encoded, value)
/** Encrypt deployment secrets; the separate master key is never stored in the database. */
export function seal(value: unknown, key: string): string {
 const nonce = randomBytes(12)
 const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), nonce)
 const content = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
 return Buffer.concat([nonce, cipher.getAuthTag(), content]).toString('base64')
}
export function unseal<T>(value: string, key: string): T {
 const data = Buffer.from(value, 'base64')
 const cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), data.subarray(0, 12))
 cipher.setAuthTag(data.subarray(12, 28))
 return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8')) as T
}
