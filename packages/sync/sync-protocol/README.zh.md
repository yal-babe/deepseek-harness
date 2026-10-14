---
description: "共享的 Studio 云同步类型与纯函数：品牌化 id、批次校验与密钥脱敏。"
kind: "package-reference"
---

# @deepseek-ai/dsh-sync-protocol

[English](README.md) | 中文

## 概述

`dsh-sync-protocol` 是 Studio 云同步的无 Cordis 库。调用方品牌化 `StudioProjectId`、`DeviceId`、`SyncBatchId` 与 `MemoryId`，校验 `SyncBatch` 载荷，并在入队或 HTTP 提交前脱敏密钥。它不拥有插件、队列或 HTTP 监听器。

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

从 `@deepseek-ai/dsh-sync-protocol` 导入构造器与辅助函数。标识必须匹配 `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`。`validateBatch` 拒绝空批次、过大批次（默认上限 100）、无效 id，以及递减的 `seq`；连续相等的 `seq` 是允许的。`redactSecrets` / `redactJsonValue` 将 `sk-` 令牌、`Bearer` 凭据、`api_key` / `secret` / `token` / `password` 字段以及 PEM 块替换为 `[REDACTED]`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

| 文件 | 职责 |
|---|---|
| [`src/types.ts`](src/types.ts) | 批次、信封、租约、记忆与状态类型 |
| [`src/ids.ts`](src/ids.ts) | 品牌化构造器与标识语法 |
| [`src/validate.ts`](src/validate.ts) | `validateBatch` |
| [`src/redact.ts`](src/redact.ts) | 密钥替换 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [云同步子系统](../../../docs/subsystems/sync.zh.md) — 带源码等价围栏的同一组类型。
- [sync 组地图](../README.zh.md) — outbox、服务器与记忆消费方。

-----

<a id="model-experience"></a>
## 模型体验

无。本包只品牌化标识、校验批次并脱敏字符串；脱敏后的值如何进入模型由消费方拥有。

#### KV 缓存影响

无；本包从不组装或发送 provider 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **脱敏基于模式** — 未匹配所列密钥形式的值仍留在载荷中；调用方不得把脱敏当作保密证明。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
