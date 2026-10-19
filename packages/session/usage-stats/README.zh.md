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

基于 base 的 Web profile 与 session-query 一并组合本服务。个人中心调用 `usageStats.snapshot(timezoneOffsetSeconds)`，参数为东向 UTC 的秒数。Client 将最近一次快照缓存在 `localStorage`；实时 `tokenUsage` 变化仅在摘要可见时请求合并处理的 Host 刷新，不在浏览器修改日历日分桶。重新打开隐藏摘要时显式刷新。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

`UsageStats` 是命名空间为 `usageStats` 的 `TypertRemoteService`。`snapshot` 通过 `sessionQuery` 列出会话，排除已归档工作区会话，并复用 token-meter 的调用统计处理消息及失败尝试，包括内嵌流用量。同一次尝试的最终样本替换先前样本，重试单独计入。调用保留结算日期及提供方／模型归属。精确提供方总量独立于缓存明细保留；缺失或非法用量使统计标为不完整，缺失缓存桶保持未知。全局总量、模型行及日历分桶按原始来源位置只计一次；子会话不贡献继承的工具调用与活动。单会话行包含完整继承前缀，与聊天用量一致，因此不能将这些行相加来重建全局总量。最近会话省略已知总量为零的会话，但保留用量不可获取的会话；`sessionCount` 计入所有未归档会话。会话观测复用 session-query 有界、按版本校验的预备缓存；每个观测租约均在下一次读取前释放。

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
