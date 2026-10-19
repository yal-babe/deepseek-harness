let csrf = '', current = 'overview', currentUser, updateTimer, updateGeneration = 0
const $ = selector => document.querySelector(selector)
const node = (tag, text, cls) => { const el = document.createElement(tag); if(text !== undefined) el.textContent = String(text); if(cls) el.className = cls; return el }
function message(text, error = false) { $('#message').textContent = text; $('#message').className = error ? 'error' : ''; $('#message').hidden = false }
async function api(path, method = 'GET', data, retry = true) {
 const response = await fetch(`/v1${path}`, { method, credentials:'same-origin', headers: { 'Content-Type':'application/json', 'X-CSRF-Token': csrf }, body: data === undefined ? undefined : JSON.stringify(data) })
 const result = await response.json()
 if(response.status === 401 && retry && path !== '/auth/login') {
  const refreshed = await fetch('/v1/auth/refresh', { method:'POST', credentials:'same-origin', headers:{ 'Content-Type':'application/json' }, body:'{}' })
  if(refreshed.ok) { csrf = (await refreshed.json()).csrf; return api(path,method,data,false) }
  $('#shell').hidden = true; $('#login').hidden = false
 }
 if(!response.ok) throw new Error(result.error?.message || '请求失败')
 return result
}
const run = fn => async event => { event?.preventDefault(); try { await fn(event) } catch(error) { message(error.message,true) } }
function card(title, description) { const el = node('section',undefined,'card'); if(title) el.append(node('h2',title)); if(description) el.append(node('p',description)); $('#content').append(el); return el }
function button(text, action, cls = 'small secondary') { const el = node('button',text,cls); el.type = 'button'; el.addEventListener('click',run(action)); return el }
function table(parent, rows, columns, actions) {
 if(!rows.length) { parent.append(node('p','暂无记录')); return }
 const wrapper = node('div',undefined,'table-wrap'), t = node('table'), head = node('tr')
 columns.forEach(([title]) => head.append(node('th',title))); if(actions) head.append(node('th','操作')); const thead = node('thead'); thead.append(head); t.append(thead)
 const body = node('tbody'); for(const row of rows) { const tr = node('tr'); columns.forEach(([,key]) => tr.append(node('td',typeof key === 'function' ? key(row) : row[key] ?? '—'))); if(actions) { const td = node('td'); actions(row).forEach(el => td.append(el)); tr.append(td) } body.append(tr) }
 t.append(body); wrapper.append(t); parent.append(wrapper)
}
function field(form, name, title, value = '', type = 'text', required = true) {
 const label = node('label',title), input = node('input'); input.name = name; input.type = type; input.value = value; input.required = required; label.append(input); form.append(label); return input
}
function form(parent, submitText, submit) {
 const f = node('form'); parent.append(f); const fields = node('div',undefined,'form-grid'); f.append(fields)
 const save = node('button',submitText); save.type = 'submit'; f.append(save)
 f.addEventListener('submit',run(async () => { save.disabled = true; try { await submit(Object.fromEntries(new FormData(f))); message('操作成功') } finally { save.disabled = false } })); return { form:f,fields }
}
function modal(title, fields, submit) {
 $('#dialog-title').textContent = title; $('#dialog-fields').replaceChildren()
 fields.forEach(([name,label,type,value]) => field($('#dialog-fields'),name,label,value ?? '',type ?? 'text'))
 $('#dialog-form').onsubmit = run(async () => { await submit(Object.fromEntries(new FormData($('#dialog-form')))); $('#dialog').close(); await render() })
 $('#dialog').showModal()
}
$('#dialog-cancel').onclick = () => $('#dialog').close()
$('#login-form').addEventListener('submit',run(async () => {
 const b = Object.fromEntries(new FormData($('#login-form')))
 csrf = (await api('/auth/login','POST',{...b,client:'web',deviceName:'云端管理浏览器'})).csrf
 $('#login-form').reset(); await session()
}))
async function session() {
 currentUser = await api('/auth/session'); csrf = currentUser.csrf
 if(currentUser.role !== 'admin') { location.href = currentUser.mustChangePassword ? '/account#action=password' : '/account#action=profile'; return }
 $('#login').hidden = true; $('#shell').hidden = false
 if(currentUser.mustChangePassword) { changePassword(); return }
 await render()
}
function changePassword() { modal('修改密码（完成后需重新登录）',[['currentPassword','当前密码','password'],['newPassword','新密码（至少12位）','password']],async b => { await api('/me/password','POST',b); location.reload() }) }
$('#password-button').onclick = changePassword
$('#logout').onclick = run(async () => { await api('/auth/logout','POST',{}); location.reload() })
$('#refresh').onclick = run(render)
$('#nav').addEventListener('click',run(async event => { if(!event.target.dataset.page) return; current = event.target.dataset.page; await render() }))
async function render() {
 updateGeneration += 1
 clearTimeout(updateTimer)
 $('#content').replaceChildren()
 document.querySelectorAll('#nav button').forEach(el => { el.classList.toggle('active',el.dataset.page===current); if(el.dataset.page===current) $('#title').textContent=el.textContent })
 if(current === 'updates') { await renderUpdates(); return }
 if(current === 'overview') {
  const version = await api('/version'); $('#server-version').textContent = `服务端 v${version.version}`
  const data = await api('/admin/overview'), grid = node('div',undefined,'stats'); $('#content').append(grid)
  for(const [name,key] of [['个人账号','users'],['有效设备会话','devices'],['同步对象','objects'],['同步占用（字节）','bytes'],['本地备份','backups']]) { const c = node('div',undefined,'card'); c.append(node('p',name),node('div',data[key],'stat')); grid.append(c) }
  card('独立个人云端','管理账号、同步数据与存储策略。此服务不执行模型请求，不运行插件，也不接管桌面智能体。')
 }
 if(current === 'users') {
  const c = card('个人账号','新建账号使用临时密码，首次使用必须修改。邮箱由用户验证绑定。')
  c.append(button('创建账号',() => modal('创建个人账号',[['username','账号（小写字母/数字，3–32位）'],['password','临时密码（至少12位）','password']], b => api('/admin/users','POST',b))))
  table(c,await api('/admin/users'),[['账号','username'],['邮箱','email'],['状态',r => r.disabled ? '已禁用' : '正常'],['加密模式','encryption_mode'],['用量/字节','used_bytes'],['个人额度',r => r.quota_bytes ?? '默认']],r => [
   button(r.disabled?'启用':'禁用',async () => { if(confirm('确认更改账号状态？')) { await api(`/admin/users/${r.id}`,'PATCH',{disabled:!r.disabled}); await render() } }),
   button('额度',() => modal('个人额度',[['quotaBytes','额度（字节，0 表示禁止新增）','number',r.quota_bytes ?? 1073741824]], b => api(`/admin/users/${r.id}`,'PATCH',{quotaBytes:Number(b.quotaBytes)}))),
   button('默认额度',async () => { await api(`/admin/users/${r.id}`,'PATCH',{quotaBytes:null}); await render() }),
   button('重置密码',() => modal('重置密码并撤销登录',[['password','临时密码（至少12位）','password']],b => api(`/admin/users/${r.id}`,'PATCH',b))),
   button('退出全部设备',async () => { if(confirm('确认撤销该账号所有登录？')) await api(`/admin/users/${r.id}`,'PATCH',{revokeSessions:true}) })])
 }
 if(current === 'invites') {
  const c=card('邀请开通','没有有效邀请的用户不能自行注册。邀请链接仅在创建时展示，请妥善交付。')
  const {fields}=form(c,'创建邀请',async b => { const result = await api('/admin/invites','POST',{...(b.email?{email:b.email}:{}),expiresHours:Number(b.hours),sendEmail:b.send==='yes'}); const out=node('pre',result.url); c.prepend(out) })
  field(fields,'email','接收邮箱（可选）','','email',false); field(fields,'hours','有效小时',72,'number'); field(fields,'send','发送邮件：yes 或 no','no')
  table(c,await api('/admin/invites'),[['邮箱','email'],['到期时间','expires_at'],['使用/撤销时间','used_at']],r => [button('撤销',async () => { await api(`/admin/invites/${r.id}`,'DELETE'); await render() })])
 }
 if(current === 'data') table(card('同步元信息','不展示用户数据正文或密文内容。'),await api('/admin/data'),[['用户','user_id'],['对象','id'],['类型','kind'],['插件','namespace'],['版本','version'],['加密','encrypted'],['字节','bytes'],['删除时间','deleted_at']])
 if(current === 'storage') {
  const settings=await api('/admin/settings'), c=card('S3 / MinIO','用于加密备份的远程副本。当前同步对象保存在 PostgreSQL；文件上传接口后续扩展。已有备份时禁止直接更换存储位置。密钥留空保留已有配置。')
  const {fields}=form(c,'保存存储配置',async b => { const result={endpoint:b.endpoint,region:b.region,bucket:b.bucket,forcePathStyle:b.pathStyle==='true'}; if(b.accessKeyId) result.accessKeyId=b.accessKeyId; if(b.secretAccessKey) result.secretAccessKey=b.secretAccessKey; await api('/admin/settings/storage','PUT',result) })
  const v=settings.storage??{}; field(fields,'endpoint','Endpoint',v.endpoint??'http://minio:9000','text'); field(fields,'region','Region',v.region??'us-east-1'); field(fields,'bucket','Bucket',v.bucket??'studio-cloud'); field(fields,'accessKeyId','Access Key','','text',false); field(fields,'secretAccessKey','Secret Key','','password',false); field(fields,'pathStyle','路径寻址 true / false',String(v.forcePathStyle??true)); c.append(button('测试连接',async () => { await api('/admin/settings/storage/test','POST',{}); message('连接成功') }))
 }
 if(current === 'smtp') {
  const settings=await api('/admin/settings'),c=card('邮件服务','邀请、邮箱绑定和找回密码共用此配置。STARTTLS 或 TLS 必须可用，密码留空保留已有配置。')
  const {fields}=form(c,'保存邮件配置',async b => { const result={host:b.host,port:Number(b.port),secure:b.secure==='true',user:b.user,from:b.from}; if(b.password) result.password=b.password; await api('/admin/settings/smtp','PUT',result) })
  const v=settings.smtp??{}; for(const [name,label,value,type] of [['host','SMTP 主机',v.host??''],['port','端口',v.port??587,'number'],['secure','直接 TLS：true / false',String(v.secure??false)],['user','用户名',v.user??''],['password','密码','','password'],['from','发件邮箱',v.from??'','email']]) field(fields,name,label,value,type??'text',name!=='password'&&name!=='user')
  c.append(button('发送测试邮件',() => modal('测试邮件',[['email','收件邮箱','email']],b => api('/admin/settings/smtp/test','POST',b))))
 }
 if(current === 'policies') {
  const settings=await api('/admin/settings'),c=card('容量与保留策略','额度包含当前载荷和增量历史；删除保留期与增量保留期分别生效。到期清理按日执行，也可手动触发。缩短保留期需要确认。')
  const {fields}=form(c,'保存策略',async b => { if(confirm('保存策略？如缩短保留期，系统将按新期限清理到期内容和备份。')) await api('/admin/settings/policies','PUT',{ policies:Object.fromEntries(Object.entries(b).map(([k,v]) => [k,Number(v)])),confirmShorterRetention:true }) })
  const labels={defaultQuotaBytes:'默认个人额度（字节）',deletionDays:'删除载荷保留天数',changeDays:'增量历史保留天数',backupDays:'本地备份保留天数',backupIntervalHours:'自动备份间隔（小时）',maxBackups:'本地备份保留份数',backupMaxBytes:'单次备份原始数据上限',maxObjectBytes:'单个同步对象上限'}
  for(const [k,v] of Object.entries(settings.policies)) field(fields,k,labels[k]??k,v,'number')
  c.append(button('按当前策略执行清理',async () => { if(confirm('此操作将永久清理到期内容和本地备份，确认继续？')) { await api('/admin/cleanup','POST',{confirmation:'CLEANUP'}); message('清理完成') } },'danger'))
 }
 if(current === 'backups') {
  const c=card('备份与恢复','备份使用部署主密钥加密。恢复会替换全部账号及同步数据，撤销所有登录并使旧同步游标失效；请先备份当前状态。')
  c.append(button('立即备份',async () => { message('备份中，请稍候'); await api('/admin/backups','POST',{}); await render(); message('备份完成') }))
  table(c,await api('/admin/backups'),[['ID','id'],['创建时间','created_at'],['字节','bytes']],r => [button('恢复',() => modal('恢复全部服务数据',[['confirmation','输入 RESTORE'],['password','当前管理员密码','password']],async b => { await api(`/admin/backups/${r.id}/restore`,'POST',b); location.reload() }),'danger small')])
 }
 if(current === 'audit') table(card('操作审计','只记录操作元信息，不包含密码、令牌或用户对话正文。'),await api('/admin/audit'),[['编号','id'],['操作人','actor_id'],['操作','action'],['对象','target'],['时间','created_at']])
}
session().catch(() => { $('#shell').hidden=true; $('#login').hidden=false })


async function renderUpdates() {
 const generation = updateGeneration
 const settings = await api('/admin/updates')
 if (generation !== updateGeneration || current !== 'updates') return
 $('#server-version').textContent = `服务端 v${settings.currentVersion}`
 const setup = card('系统更新',`当前服务端版本：${settings.currentVersion}`)
 setup.append(node('p',settings.enabled ? 'Docker 在线更新执行器已启用。' : '更新执行器尚未启用：先按部署说明配置镜像仓库、令牌和 compose.updates.yaml。'))
 setup.append(node('p',`允许的镜像仓库：${settings.imageRepository || '尚未配置'}`))
 const source = form(setup,'保存更新源',async data => {
  await api('/admin/updates/source','PUT',{ manifestUrl:data.manifestUrl.trim() }); await render()
 })
 field(source.fields,'manifestUrl','服务端版本清单地址（HTTP / HTTPS，可暂留空）',settings.manifestUrl,'url',false)
 const discovery = card('检查新版本','地址未配置时不会访问任何默认发布站点。安装前会创建备份，更新只替换应用容器，不删除数据库和数据卷。')
 discovery.append(button('检查更新',async () => {
  const release = await api('/admin/updates/check','POST',{})
  releasePanel.replaceChildren(node('h3',`版本 ${release.version}`),node('pre',release.notes || '此版本未提供更新说明','release-notes'))
  if (!release.available) { releasePanel.append(node('p','当前版本已是该发布源中的最新版本。')); return }
  if (!release.compatible) { releasePanel.append(node('p',`此版本要求至少 ${release.minimumVersion}，请先完成中间版本升级。`)); return }
  if (!settings.enabled) { releasePanel.append(node('p','请先在部署中启用 Docker 更新执行器。')); return }
  releasePanel.append(button('备份并更新',async () => {
   if (!confirm(`将更新到 ${release.version}，云同步会短暂中断。更新前自动备份。${release.rollbackCompatible ? '若新版本未就绪，将尝试回退应用镜像。' : '该版本未声明数据库向后兼容，失败时需管理员按备份和迁移说明恢复。'}是否继续？`)) return
   await api('/admin/updates/install','POST',{ version:release.version,image:release.image,confirmation:'UPDATE' })
   message('更新任务已提交；服务重启期间本页会尝试重新连接。')
   await poll()
  }))
 }))
 const releasePanel = node('div'); discovery.append(releasePanel)
 const progress = card('更新状态','未配置发布源不会执行更新。')
 const labels = { idle:'尚无更新任务',pulling:'正在拉取镜像',restarting:'正在重启服务',verifying:'等待新版本就绪',completed:'更新完成',
  'rolling-back':'正在回退应用镜像','rolled-back':'已回退应用镜像',failed:'更新失败',interrupted:'更新曾中断，请检查部署状态' }
 async function poll() {
  if (current !== 'updates' || generation !== updateGeneration || !settings.enabled) return
  clearTimeout(updateTimer)
  try {
   const state = await api('/admin/updates/status')
   if (current !== 'updates' || generation !== updateGeneration) return
   progress.replaceChildren(node('h2','更新状态'),node('p',labels[state.phase] || state.phase))
   if (state.version) progress.append(node('p',`目标版本：${state.version}`))
   if (state.backupId) progress.append(node('p',`更新前备份：${state.backupId}`))
   if (state.message) progress.append(node('p',state.message))
   if (state.phase === 'completed') {
    const identity = await api('/version'); $('#server-version').textContent = `服务端 v${identity.version}`
   }
   if (['pulling','restarting','verifying','rolling-back'].includes(state.phase)) updateTimer = setTimeout(poll,3000)
  } catch {
   if (current !== 'updates' || generation !== updateGeneration) return
   progress.replaceChildren(node('h2','更新状态'),node('p','服务可能正在重启，正在重新连接；若持续失败，请检查部署日志。'))
   updateTimer = setTimeout(poll,5000)
  }
 }
 await poll()
}
