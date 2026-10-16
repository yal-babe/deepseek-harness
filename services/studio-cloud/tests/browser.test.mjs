import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chromium } from 'playwright'

const base = process.env.TEST_BASE_URL ?? process.env.PUBLIC_URL
const password = process.env.TEST_ADMIN_PASSWORD ?? process.env.BOOTSTRAP_PASSWORD
if (!base || !password) throw new Error('Set TEST_BASE_URL and TEST_ADMIN_PASSWORD for a disposable running service')

test('admin browser login, account creation, invitation, settings and metadata navigation',async()=>{
 const browser = await chromium.launch({ headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH })
 const page = await browser.newPage()
 const errors=[]
 page.on('pageerror',error=>errors.push(error.message))
 try {
  await page.goto(`${base}/admin`)
  await page.getByLabel('账号或邮箱').fill(process.env.BOOTSTRAP_ADMIN??'admin')
  await page.getByLabel('密码',{exact:true}).fill(password)
  await page.getByRole('button',{name:'登录',exact:true}).click()
  await page.getByRole('heading',{name:'服务概览',exact:true}).waitFor()
  await page.getByRole('button',{name:'个人账号',exact:true}).click()
  await page.getByRole('button',{name:'创建账号',exact:true}).click()
  const name=`browser_${randomUUID().slice(0,8)}`
  await page.getByLabel('账号（小写字母/数字，3–32位）').fill(name)
  await page.getByLabel('临时密码（至少12位）').fill('Browser-test-password-2026')
  await page.getByRole('button',{name:'确认',exact:true}).click()
  await page.getByRole('cell',{name,exact:true}).waitFor()
  await page.getByRole('button',{name:'邀请管理',exact:true}).click()
  await page.getByRole('button',{name:'创建邀请',exact:true}).click()
  await page.locator('pre').filter({hasText:'/account#action=invite&token='}).waitFor()
  for(const title of ['S3 / MinIO','邮件服务','容量与保留策略','同步数据','备份与恢复','操作审计']) {
   await page.getByRole('button',{name:title,exact:true}).click()
   await page.getByRole('heading',{name:title,exact:true,level:1}).waitFor()
   await page.locator('#content .card').waitFor();assert.equal(await page.locator('#content .card').count(),1)
  }
  await page.screenshot({path:'/tmp/studio-cloud-admin.png',fullPage:true})
  assert.deepEqual(errors,[])
  await page.getByRole('button',{name:'退出登录',exact:true}).click()
  await page.getByRole('button',{name:'登录',exact:true}).waitFor()
  await page.getByLabel('账号或邮箱').fill(name)
  await page.getByLabel('密码',{exact:true}).fill('Browser-test-password-2026')
  await page.getByRole('button',{name:'登录',exact:true}).click()
  await page.getByRole('heading',{name:'修改账号密码',exact:true}).waitFor()
  await page.getByLabel('当前密码',{exact:true}).fill('Browser-test-password-2026')
  await page.getByLabel('新密码（至少12位）').fill('Browser-changed-password-2026')
  await page.getByRole('button',{name:'确认',exact:true}).click()
  await page.getByRole('status').filter({hasText:'操作成功'}).waitFor()
  await page.getByRole('link',{name:'返回登录',exact:true}).click()
  await page.getByLabel('账号或邮箱').fill(name)
  await page.getByLabel('密码',{exact:true}).fill('Browser-changed-password-2026')
  await page.getByRole('button',{name:'登录',exact:true}).click()
  await page.getByRole('heading',{name:'个人账号',exact:true}).waitFor()
  await page.getByRole('link',{name:'绑定或修改邮箱',exact:true}).click()
  await page.getByRole('heading',{name:'绑定登录邮箱',exact:true}).waitFor()
  assert.deepEqual(errors,[])
 } finally { await browser.close() }
})
