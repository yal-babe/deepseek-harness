/**
 * Minimal admin console HTML served at `/admin`.
 * @module @deepseek-ai/dsh-sync-server/admin-page
 */

/** Admin console document. The key is typed into the page; it is never embedded. */
export const ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Studio Sync Admin</title>
  <style>
    body { font-family: sans-serif; margin: 1.5rem; max-width: 72rem; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { border: 1px solid #ccc; padding: 0.4rem 0.6rem; text-align: left; }
    section { margin-bottom: 2rem; }
    input, button { font: inherit; }
  </style>
</head>
<body>
  <h1>Studio Sync Admin</h1>
  <p><label>Admin key <input id="key" type="password" autocomplete="off"></label>
    <button id="reload" type="button">Load</button></p>
  <section>
    <h2>Projects</h2>
    <table id="projects"><thead><tr><th>id</th><th>created</th></tr></thead><tbody></tbody></table>
  </section>
  <section>
    <h2>Devices</h2>
    <table id="devices"><thead><tr><th>id</th><th>project</th><th>revoked</th></tr></thead><tbody></tbody></table>
  </section>
  <section>
    <h2>Sync failures</h2>
    <table id="failures"><thead><tr><th>time</th><th>project</th><th>batch</th><th>message</th></tr></thead><tbody></tbody></table>
  </section>
  <section>
    <h2>Backup</h2>
    <p><a id="backup" href="#">Download ZIP</a></p>
  </section>
  <section>
    <h2>S3 config stub</h2>
    <p>
      <label>bucket <input id="bucket"></label>
      <label>region <input id="region"></label>
      <label>endpoint <input id="endpoint"></label>
      <label>prefix <input id="prefix"></label>
      <button id="save-s3" type="button">Save</button>
    </p>
    <p id="s3-status"></p>
  </section>
  <script>
    const headers = () => ({ 'x-admin-key': document.getElementById('key').value })
    async function getJson(path) {
      const response = await fetch(path, { headers: headers() })
      if (!response.ok) throw new Error(String(response.status))
      return response.json()
    }
    function fill(id, rows, cells) {
      const body = document.querySelector('#' + id + ' tbody')
      body.replaceChildren()
      for (const row of rows) {
        const tr = document.createElement('tr')
        for (const cell of cells(row)) {
          const td = document.createElement('td')
          td.textContent = cell
          tr.appendChild(td)
        }
        body.appendChild(tr)
      }
    }
    async function load() {
      const projects = await getJson('/admin/api/projects')
      fill('projects', projects, (row) => [row.id, String(row.createdAt)])
      const devices = await getJson('/admin/api/devices')
      fill('devices', devices, (row) => [row.id, row.projectId, row.revoked ? 'yes' : 'no'])
      const failures = await getJson('/admin/api/failures')
      fill('failures', failures, (row) => [String(row.time), row.projectId, row.batchId || '', row.message])
      const s3 = await getJson('/admin/api/s3')
      document.getElementById('bucket').value = s3.bucket || ''
      document.getElementById('region').value = s3.region || ''
      document.getElementById('endpoint').value = s3.endpoint || ''
      document.getElementById('prefix').value = s3.prefix || ''
      document.getElementById('backup').href = '/admin/api/backup.zip'
    }
    document.getElementById('reload').addEventListener('click', () => load().catch((error) => alert(error)))
    document.getElementById('backup').addEventListener('click', async (event) => {
      event.preventDefault()
      const response = await fetch('/admin/api/backup.zip', { headers: headers() })
      if (!response.ok) { alert(String(response.status)); return }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'studio-sync-backup.zip'
      link.click()
      URL.revokeObjectURL(url)
    })
    document.getElementById('save-s3').addEventListener('click', async () => {
      const response = await fetch('/admin/api/s3', {
        method: 'PUT',
        headers: { ...headers(), 'content-type': 'application/json' },
        body: JSON.stringify({
          bucket: document.getElementById('bucket').value,
          region: document.getElementById('region').value,
          endpoint: document.getElementById('endpoint').value,
          prefix: document.getElementById('prefix').value,
        }),
      })
      document.getElementById('s3-status').textContent = response.ok ? 'saved' : 'save failed ' + response.status
    })
  </script>
</body>
</html>
`
