import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
const hex = size => randomBytes(size).toString('hex')
const content = `POSTGRES_PASSWORD=${hex(24)}\nMASTER_KEY=${hex(32)}\nBOOTSTRAP_ADMIN=admin\nBOOTSTRAP_PASSWORD=${hex(18)}\nPUBLIC_URL=http://localhost:8788\nALLOW_HTTP=true\nBIND_ADDRESS=127.0.0.1\nPORT=8788\nUPDATER_TOKEN=${hex(32)}\nUPDATE_MANIFEST_URL=\nUPDATE_IMAGE_REPOSITORY=\n`
await writeFile(new URL('../.env',import.meta.url),content,{mode:0o600,flag:'wx'})
console.log('Created .env with random secrets. Read BOOTSTRAP_PASSWORD from that file for first admin login; keep MASTER_KEY with your recovery materials.')
