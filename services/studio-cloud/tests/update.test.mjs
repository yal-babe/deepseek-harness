import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile, chmod, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

const updater = fileURLToPath(new URL('../scripts/update.sh', import.meta.url))
const deployScript = fileURLToPath(new URL('../deploy.sh', import.meta.url))
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'studio-updater-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const source = join(directory, 'remote'), deploy = join(directory, 'deployment'), bin = join(directory, 'bin')
  await mkdir(join(source, 'services/studio-cloud'), { recursive: true })
  await mkdir(join(deploy, 'scripts'), { recursive: true })
  await mkdir(bin)
  await writeFile(join(source, 'services/studio-cloud/Dockerfile'), 'FROM scratch\n')
  git(source, 'init', '--quiet', '-b', 'studio/main')
  git(source, 'add', '.')
  git(source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'service fixture')
  const revision = git(source, 'rev-parse', 'HEAD')
  await copyFile(updater, join(deploy, 'scripts/update.sh'))
  const original = 'DATABASE_URL=postgresql://local/test\nMASTER_KEY=private-test-key\n# retain this setting\n'
  await writeFile(join(deploy, '.env'), original, { mode: 0o600 })
  await writeFile(join(deploy, 'compose.yaml'), 'services:\n  app:\n    image: ${STUDIO_CLOUD_IMAGE:-fixture:old}\n')
  const scripts = {
    flock: '#!/usr/bin/env bash\nexit "${TEST_LOCK_BUSY:-0}"\n',
    timeout: '#!/usr/bin/env bash\nshift 2\nexec "$@"\n',
    docker: `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
fs.appendFileSync(process.env.TEST_DOCKER_LOG, JSON.stringify(args)+'\\n')
if (args[0] === 'build' && process.env.TEST_BUILD_FAIL === '1') process.exit(1)
if (args[0] === 'inspect') {
  if (args.includes('{{.Config.Image}}')) console.log(fs.readFileSync('.env','utf8').split('\\n').find(line=>line.startsWith('STUDIO_CLOUD_IMAGE=')).slice('STUDIO_CLOUD_IMAGE='.length))
  else console.log(process.env.TEST_HEALTH_FAIL === '1' ? 'unhealthy' : 'healthy')
}
if (args.includes('images')) console.log('sha256:previous')
if (args.includes('ps')) console.log('fixture-container')
`,
  }
  for (const [name, content] of Object.entries(scripts)) {
    await writeFile(join(bin, name), content)
    await chmod(join(bin, name), 0o755)
  }
  const log = join(directory, 'docker.log')
  const run = (action, extra = {}) => spawnSync('bash', [join(deploy, 'scripts/update.sh'), action], {
    cwd: deploy, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STUDIO_UPDATE_REPOSITORY: source,
      STUDIO_UPDATE_BRANCH: 'studio/main', TEST_DOCKER_LOG: log, ...extra },
  })
  const calls = async () => {
    try { return (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) }
    catch (error) { if (error.code === 'ENOENT') return []; throw error }
  }
  return { directory, deploy, original, revision, run, calls }
}

test('check fetches a pinned branch without Docker mutations or credential changes', async t => {
  const f = await fixture(t), result = f.run('check')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, new RegExp(f.revision))
  assert.deepEqual(await f.calls(), [])
  assert.equal(await readFile(join(f.deploy, '.env'), 'utf8'), f.original)
})

test('update pins an image, preserves settings, restarts only app, and records a healthy revision', async t => {
  const f = await fixture(t), result = f.run('update')
  assert.equal(result.status, 0, result.stderr)
  const calls = await f.calls()
  const build = calls.find(call => call[0] === 'build')
  assert.ok(build.includes(`dsh-studio-cloud:git-${f.revision}`))
  const up = calls.find(call => call.includes('up'))
  assert.ok(up.includes('--no-deps') && up.includes('--wait'))
  assert.equal(up.at(-1), 'app')
  assert.ok(!calls.some(call => call.includes('down')))
  assert.equal(await readFile(join(f.deploy, '.env'), 'utf8'), `${f.original}\nSTUDIO_CLOUD_IMAGE=dsh-studio-cloud:git-${f.revision}\n`)
  assert.equal(await readFile(join(f.deploy, '.studio-update/env.previous'), 'utf8'), f.original)
  assert.equal((await stat(join(f.deploy, '.env'))).mode & 0o777, 0o600)
  assert.equal((await readFile(join(f.deploy, '.studio-update/current'), 'utf8')).trim(), f.revision)
  assert.equal(f.run('update').status, 0)
  assert.equal((await f.calls()).filter(call => call[0] === 'build').length, 1)
})

test('build failure leaves the deployment unchanged and never restarts the app', async t => {
  const f = await fixture(t), result = f.run('update', { TEST_BUILD_FAIL: '1' })
  assert.notEqual(result.status, 0)
  assert.equal(await readFile(join(f.deploy, '.env'), 'utf8'), f.original)
  assert.ok(!(await f.calls()).some(call => call.includes('up')))
  assert.match(result.stderr, /尚未切换/)
})

test('unhealthy replacement reports unknown migration state without automatic downgrade and permits retry', async t => {
  const f = await fixture(t), result = f.run('update', { TEST_HEALTH_FAIL: '1' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /数据库可能已迁移/)
  assert.match(await readFile(join(f.deploy, '.studio-update/FAILED'), 'utf8'), /restart/)
  assert.ok(!(await f.calls()).some(call => call.includes('down')))
  assert.equal(f.run('update').status, 0)
  await assert.rejects(readFile(join(f.deploy, '.studio-update/FAILED')), { code: 'ENOENT' })
})

test('busy lock and missing branch stop before application mutations', async t => {
  const f = await fixture(t)
  const busy = f.run('update', { TEST_LOCK_BUSY: '1' })
  assert.notEqual(busy.status, 0)
  assert.match(busy.stderr, /另一更新操作/)
  const missing = f.run('update', { STUDIO_UPDATE_BRANCH: 'missing-branch' })
  assert.notEqual(missing.status, 0)
  assert.ok(!(await f.calls()).some(call => call[0] === 'build' || call.includes('up')))
  assert.equal(await readFile(join(f.deploy, '.env'), 'utf8'), f.original)
})


test('deployment entrypoint delegates check and update to the external PostgreSQL configuration', async t => {
  const f = await fixture(t)
  await copyFile(deployScript, join(f.deploy, 'deploy.sh'))
  await writeFile(join(f.deploy, 'compose.external-pg.yaml'), 'services:\n  app:\n    image: ${STUDIO_CLOUD_IMAGE:-fixture:old}\n')
  const result = spawnSync('bash', [join(f.deploy, 'deploy.sh'), 'update'], {
    cwd: f.deploy, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, PATH: `${join(f.directory, 'bin')}:${process.env.PATH}`,
      STUDIO_UPDATE_REPOSITORY: join(f.directory, 'remote'), STUDIO_UPDATE_BRANCH: 'studio/main',
      TEST_DOCKER_LOG: join(f.directory, 'docker.log') },
  })
  assert.equal(result.status, 0, result.stderr)
  const up = (await f.calls()).find(call => call.includes('up'))
  assert.equal(up[up.indexOf('-f') + 1], 'compose.external-pg.yaml')
  assert.equal(up.at(-1), 'app')
})
