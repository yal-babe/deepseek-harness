---
description: "SQLite WAL Studio sync HTTP server: batch commit, event read, device leases, FTS memory, admin console, and Docker image."
kind: "package-reference"
---

# @deepseek-ai/dsh-sync-server

English | [中文](README.zh.md)

## Summary

`dsh-sync-server` is a Node HTTP server over SQLite WAL. It commits idempotent batches, lists events and devices, issues exclusive project leases, stores FTS project memory, and serves a first-run `/admin` console. Launch it with `listenSyncServer`, the built `lib/index.js` entry, or the published Dockerfile.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

```ts
import { listenSyncServer } from '@deepseek-ai/dsh-sync-server'

const server = await listenSyncServer({ dbPath: '/data/studio-sync.sqlite', port: 8787 })
```

Device routes require `Authorization: Bearer <device-credential>`. Admin routes require the admin key from `STUDIO_ADMIN_KEY`, `options.adminKey`, or a first-run file (default `<db dir>/.studio-admin-key`).

| Method | Path | Auth | Role |
|---|---|---|---|
| `POST` | `/v1/batches` | device | Idempotent batch commit |
| `GET` | `/v1/events` | device | List committed envelopes |
| `GET` | `/v1/devices` | device | Device directory |
| `GET`/`POST` | `/v1/lease` | device | Read or take a project lease |
| `POST` | `/v1/lease/takeover` | device | Take over an existing lease |
| `GET` | `/v1/memory/search` | device | FTS memory search |
| `POST` | `/v1/memory` | device | Store a redacted memory record |
| `GET` | `/admin` | admin | Console HTML |
| `GET` | `/admin/api/projects` | admin | Project list |
| `GET` | `/admin/api/devices` | admin | Device list |
| `GET` | `/admin/api/failures` | admin | Sync failures |
| `GET` | `/admin/api/backup.zip` | admin | JSON dump zip |
| `GET`/`PUT` | `/admin/api/s3` | admin | S3 config stub |

Environment: `PORT` (default 8787), `HOST` (default `0.0.0.0` for the process entry), `STUDIO_SYNC_DB`, `STUDIO_ADMIN_KEY`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`SCHEMA_VERSION` is 1 (`PRAGMA user_version`). Duplicate batch ids return 409 without rewriting events. Incoming JSON is redacted before commit. Backup zip uses STORE compression of a JSON dump. S3 configuration is stored and returned; upload is not implemented.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Cloud sync subsystem](../../../docs/subsystems/sync.md)
- [`dsh-sync-protocol`](../sync-protocol/README.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as this package is an HTTP and SQLite process and never assembles a model request.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **S3 backup is a stub** — the admin console stores endpoint settings and does not upload the zip.
- **No TLS terminator** — terminate TLS in a reverse proxy; the process binds plain HTTP.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
