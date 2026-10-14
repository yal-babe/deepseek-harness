---
description: "sync 组地图：Studio 云同步协议、本地 outbox、SQLite 同步服务器、项目记忆，以及会话标题栏状态指示。"
kind: "package-group"
---

# sync/ — Studio 云同步

[English](README.md) | 中文

## 摘要

sync 组在设备之间传输脱敏后的 Studio 项目事件与项目记忆。共享协议负责标识品牌化与批次校验。本地 outbox 排队投递。可选的 SQLite WAL 服务器提交批次、租约与 FTS 记忆。项目记忆只通过已记录的会话事件进入模型。Web 标题栏芯片报告 outbox 状态。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`sync-protocol`](sync-protocol/README.zh.md) | 共享 id、批次校验与密钥脱敏 | 无 |
| [`sync-outbox`](sync-outbox/README.zh.md) | 带重试与状态的本地持久队列 | `ctx.syncOutbox` |
| [`sync-server`](sync-server/README.zh.md) | SQLite WAL HTTP 服务器、管理控制台、Docker 镜像 | 无 |
| [`sync-memory`](sync-memory/README.zh.md) | 项目记忆 CRUD、FTS、已记录的模型注入 | `ctx.syncMemory` |
| [`client-ui-sync`](client-ui-sync/README.zh.md) | 会话标题栏同步状态芯片 | 无 |

web-app bundle 挂载 outbox、记忆与状态芯片，并在 profile 名称不是 `desktop` 时 `disabled`。同步服务器是独立 Node 进程（Docker 或 `listenSyncServer`）。

-----

<a id="related-documentation"></a>
## 相关文档

- [云同步子系统](../../docs/subsystems/sync.zh.md) — 批次、租约与记忆类型，以及生成的 Cordis API。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
