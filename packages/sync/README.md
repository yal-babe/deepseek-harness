---
description: "The sync group map: Studio cloud-sync protocol, local outbox, SQLite sync server, project memory, and the session-header status chip."
kind: "package-group"
---

# sync/ — Studio cloud sync

English | [中文](README.zh.md)

## Summary

The sync group moves redacted Studio project events and project memory between devices. A shared protocol brands identifiers and validates batches. A local outbox queues delivery. An optional SQLite WAL server commits batches, leases, and FTS memory. Project memory reaches the model only as logged session events. The Web header chip reports outbox status.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`studio-cloud`](studio-cloud/README.md) | Studio account and selected personal objects, independent of legacy batches | `ctx.studioCloud` |
| [`sync-protocol`](sync-protocol/README.md) | Shared ids, batch validation, and secret redaction | none |
| [`sync-outbox`](sync-outbox/README.md) | Local durable queue with retry and status | `ctx.syncOutbox` |
| [`sync-server`](sync-server/README.md) | SQLite WAL HTTP server, admin console, Docker image | none |
| [`sync-memory`](sync-memory/README.md) | Project memory CRUD, FTS, logged model injection | `ctx.syncMemory` |
| [`client-ui-sync`](client-ui-sync/README.md) | Session-header sync status chip | none |

The web-app bundle mounts outbox, memory, and the status chip with `disabled` unless the profile name is `desktop`. The sync server is a standalone Node process (Docker or `listenSyncServer`).

-----

<a id="related-documentation"></a>
## Related documentation

- [Cloud sync subsystem](../../docs/subsystems/sync.md) — batch, lease, and memory types plus the generated Cordis API.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
