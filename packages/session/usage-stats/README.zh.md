---
description: "Host Remote：把未归档 Session 日志折叠为本机用量统计，供个人中心使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-usage-stats

[English](README.md) | 中文

## 概述

Host Remote：把未归档 Session 日志折叠为本机用量统计，供个人中心使用。快照包含 token 合计、会话数、工具名、模型 id 与本地日历日分桶。已归档工作区会话被排除。快照不含事件正文或凭据。

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

基于 base 的 Web profile 与 session-query 一并组合本服务。个人中心调用 `usageStats.snapshot(timezoneOffsetSeconds)`，参数为东向 UTC 的秒数。Client 可以把最近一次快照写入 `localStorage`，并把当前打开会话的实时 `tokenUsage` 投影合并进去；未归档历史仍以 Host 快照为准。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

`UsageStats` 是命名空间为 `usageStats` 的 `TypertRemoteService`。`snapshot` 通过 `sessionQuery` 列出会话，在 `workspaceRegistry` 存在时跳过 `archivedSessionIds`，并把 `assistant/message` 用量、`tool/call` 名称与 `request/context` 模型 id 按 Client 提供的时区偏移折进日历日。最近会话省略折后 token 合计为零的会话；`sessionCount` 仍计入每个未归档会话。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-personal-center](../../client/ui-personal-center/README.zh.md) — 缓存并展示该快照的侧栏面板。
- [session-query](../../session-query/session-query/README.zh.md) — 会话列表与日志读取。
- [workspace](../../workspace/workspace/README.zh.md) — 已归档会话 id。

-----

<a id="model-experience"></a>
## 模型体验

无；本包不暴露面向模型的工具或提示词。

#### KV Cache 影响

无；本包既不组装也不发送提供商请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **用量留在本机** — 快照由本地 Session 日志折叠，不会上传。
- **已归档会话被排除** — 恢复归档后，下一次快照才会重新计入。

<a id="dev-note"></a>
### 开发备注

无。
