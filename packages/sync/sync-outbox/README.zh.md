---
description: "本地持久云同步队列：脱敏、入队、重试 HTTP 投递，并暴露 pending/syncing/synced/failed 状态。"
kind: "package-reference"
---

# @deepseek-ai/dsh-sync-outbox

[English](README.md) | 中文

## 概述

`dsh-sync-outbox` 即 `ctx.syncOutbox`：一个 JSON 队列，先脱敏密钥、校验批次，再重试 `POST /v1/batches`。状态为 `pending`、`syncing`、`synced` 或 `failed`。空的 `serverUrl` 只在本地存储、不发 HTTP。会话日志捕获是可选的，需要 `projectId` 与 `deviceId`。

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

挂载插件并调用 `enqueue`。重复的批次 id 返回已存储行。`status()` 报告计数；空队列为 `synced`。`retryFailed()` 重新排队已耗尽的行。`drain()` 一直投递，直到没有 pending 行或服务被释放。

```yaml
- name: '@deepseek-ai/dsh-sync-outbox'
  config:
    serverUrl: https://sync.example
    deviceCredentialEnv: STUDIO_DEVICE_CREDENTIAL
    maxBatchEvents: 100
    retryBaseMs: 1000
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `serverUrl` | `""` | 同步源；为空则只在本地排队 |
| `deviceCredentialEnv` | `STUDIO_DEVICE_CREDENTIAL` | Bearer 凭据环境变量 |
| `maxBatchEvents` | `100` | 信封数量上限（含） |
| `retryBaseMs` | `1000` | 基础退避；每次失败后加倍 |
| `queuePath` | `$DSH_HOME/sync-outbox.json` | 持久 JSON 队列 |
| `projectId` | 省略 | 入队与会话捕获的默认项目 |
| `deviceId` | 省略 | 入队与会话捕获的默认设备 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-sync-outbox)是每个受支持字段的详尽来源。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

投递将 HTTP 200 与 409 视为成功。八次失败后行保持 `failed`。队列文件权限为 `0o600`。损坏的文档会使插件加载失败。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [云同步子系统](../../../docs/subsystems/sync.zh.md)
- [`dsh-sync-protocol`](../sync-protocol/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无。本包将已经脱敏的事件排队以便 HTTP 投递，不自行添加模型上下文、工具或会话事件。

#### KV 缓存影响

无；本包从不组装或发送 provider 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **没有 Host 到 Client 的 remote** — 在后续传输层出现之前，标题栏芯片无法读取实时 outbox 状态。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
