---
description: "SQLite WAL Studio 同步 HTTP 服务器：批次提交、事件读取、设备租约、FTS 记忆、管理控制台与 Docker 镜像。"
kind: "package-reference"
---

# @deepseek-ai/dsh-sync-server

[English](README.md) | 中文

## 概述

`dsh-sync-server` 是建立在 SQLite WAL 上的 Node HTTP 服务器。它提交幂等批次、列出事件与设备、发放独占项目租约、存储 FTS 项目记忆，并提供首次运行的 `/admin` 控制台。通过 `listenSyncServer`、已构建的 `lib/index.js` 入口或已发布的 Dockerfile 启动。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

```ts
import { listenSyncServer } from '@deepseek-ai/dsh-sync-server'

const server = await listenSyncServer({ dbPath: '/data/studio-sync.sqlite', port: 8787 })
```

设备路由需要 `Authorization: Bearer <device-credential>`。管理路由需要来自 `STUDIO_ADMIN_KEY`、`options.adminKey` 或首次运行文件（默认 `<db dir>/.studio-admin-key`）的管理密钥。

| 方法 | 路径 | 鉴权 | 职责 |
|---|---|---|---|
| `POST` | `/v1/batches` | 设备 | 幂等批次提交 |
| `GET` | `/v1/events` | 设备 | 列出已提交信封 |
| `GET` | `/v1/devices` | 设备 | 设备目录 |
| `GET`/`POST` | `/v1/lease` | 设备 | 读取或获取项目租约 |
| `POST` | `/v1/lease/takeover` | 设备 | 接管现有租约 |
| `GET` | `/v1/memory/search` | 设备 | FTS 记忆搜索 |
| `POST` | `/v1/memory` | 设备 | 存储脱敏记忆记录 |
| `GET` | `/admin` | 管理 | 控制台 HTML |
| `GET` | `/admin/api/projects` | 管理 | 项目列表 |
| `GET` | `/admin/api/devices` | 管理 | 设备列表 |
| `GET` | `/admin/api/failures` | 管理 | 同步失败 |
| `GET` | `/admin/api/backup.zip` | 管理 | JSON 转储 zip |
| `GET`/`PUT` | `/admin/api/s3` | 管理 | S3 配置占位 |

环境变量：`PORT`（默认 8787）、`HOST`（进程入口默认 `0.0.0.0`）、`STUDIO_SYNC_DB`、`STUDIO_ADMIN_KEY`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

`SCHEMA_VERSION` 为 1（`PRAGMA user_version`）。重复的批次 id 返回 409 且不改写事件。入站 JSON 在提交前脱敏。备份 zip 对 JSON 转储使用 STORE 压缩。S3 配置可存储并返回；上传尚未实现。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [云同步子系统](../../../docs/subsystems/sync.zh.md)
- [`dsh-sync-protocol`](../sync-protocol/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无。本包是 HTTP 与 SQLite 进程，从不组装模型请求。

#### KV 缓存影响

无；本包从不组装或发送 provider 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **S3 备份是占位** — 管理控制台存储端点设置，并不上传 zip。
- **没有 TLS 终结器** — 在反向代理中终结 TLS；本进程绑定明文 HTTP。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
