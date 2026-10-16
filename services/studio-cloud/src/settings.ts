import { z } from 'zod'
import nodemailer from 'nodemailer'
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3'
import type { Services } from './common.js'
import { fail } from './common.js'
import { seal, unseal } from './security.js'

export const policiesSchema = z.object({
 defaultQuotaBytes: z.number().int().min(1048576).max(1099511627776),
 deletionDays: z.number().int().min(1).max(3650), changeDays: z.number().int().min(1).max(3650),
 backupDays: z.number().int().min(1).max(3650), backupIntervalHours: z.number().int().min(1).max(8760),
 maxBackups: z.number().int().min(1).max(3650), backupMaxBytes: z.number().int().min(1048576).max(1073741824),
 maxObjectBytes: z.number().int().min(1024).max(4194304),
}).strict()
export const smtpSchema = z.object({ host: z.string().min(1).max(253), port: z.number().int().min(1).max(65535),
 secure: z.boolean(), user: z.string().max(256), password: z.string().max(1024), from: z.email(),
}).strict()
export const storageSchema = z.object({ endpoint: z.url(), region: z.string().min(1).max(128), bucket: z.string().min(3).max(63),
 accessKeyId: z.string().min(1).max(256), secretAccessKey: z.string().min(1).max(1024), forcePathStyle: z.boolean(),
}).strict().refine(s => ['http:', 'https:'].includes(new URL(s.endpoint).protocol), 'Endpoint must use HTTP(S)')
export const policies = async (s: Services) => policiesSchema.parse((await s.db.query("SELECT value FROM settings WHERE name='policies'")).rows[0]?.value)
export async function secretSetting<T>(s: Services, name: string, schema: z.ZodType<T>): Promise<T | null> {
 const row = (await s.db.query('SELECT value FROM settings WHERE name=$1', [name])).rows[0]
 if (!row) return null
 return schema.parse(unseal(row.value.sealed, s.config.MASTER_KEY))
}
export async function saveSecret(s: Services, name: string, value: unknown) {
 await s.db.query('INSERT INTO settings(name,value) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET value=excluded.value', [name, { sealed: seal(value, s.config.MASTER_KEY) }])
}
export async function mail(s: Services, to: string, subject: string, text: string) {
 const config = await secretSetting(s, 'smtp', smtpSchema)
 if (!config) fail(503, 'MAIL_NOT_CONFIGURED', '请先由管理员配置 SMTP')
 const transport = nodemailer.createTransport({ host: config.host, port: config.port, secure: config.secure,
  requireTLS: !config.secure, auth: config.user ? { user: config.user, pass: config.password } : undefined,
  connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 })
 try { await transport.sendMail({ from: config.from, to, subject, text }) }
 catch { fail(503, 'MAIL_FAILED', '邮件未发送成功，请检查邮件服务后重试') }
 finally { transport.close() }
}
export async function s3(s: Services) {
 const c = await secretSetting(s, 'storage', storageSchema)
 if (!c) fail(503, 'STORAGE_NOT_CONFIGURED', '请先配置 S3 或 MinIO')
 const client = new S3Client({ endpoint: c.endpoint, region: c.region, forcePathStyle: c.forcePathStyle,
  credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey }, maxAttempts: 2,
  requestHandler: { requestTimeout: 15000, connectionTimeout: 5000 } })
 return { client, bucket: c.bucket }
}
export async function testStorage(s: Services) {
 const { client, bucket } = await s3(s)
 try { await client.send(new HeadBucketCommand({ Bucket: bucket })) }
 catch { fail(502, 'STORAGE_FAILED', '存储连接失败，请核对地址、存储桶和权限') }
 finally { client.destroy() }
}
