---
description: "内置桌宠 Host 模块：把运行中的会话事件汇总成一份桌宠快照，经 pet Remote 提供。"
kind: "package-reference"
---

# @deepseek-ai/dsh-pet

[English](README.md) | 中文

## 概述

内置桌宠 Host 模块：把运行中的会话事件汇总成一份桌宠快照，经 `pet` Remote 提供。快照包含一个聚合后的角色状态、逐会话视图、待审批项、运行中的作业、"显示桌宠"开关以及共享的桌宠设置。快照不含消息正文、工具参数或凭据。本模块从不回答审批；审批由 Client 通过现有审批流程回答。

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

web-app bundle 在 Web 与 Desktop profile 中挂载本服务，并同时挂载 [ui-pet](../../client/ui-pet/README.zh.md) Client 插件。Client 调用 `pet.watch()` 获取完整 `PetSnapshot` 帧流，调用 `pet.getSnapshot()` 读取一次。`pet.setVisible(boolean)` 切换所有桌宠界面，但不停止汇总；它通过 [settings](../../settings/settings/README.zh.md) 服务写入本条目的 `visible` 字段，因此 Host 重启后仍保留；没有 Settings 或 profile 条目时只在本次 Host 运行期间有效。`pet.pin(sessionId | null)` 选择气泡跟随的会话。`pet.acknowledge(sessionId)` 在用户看过结果后结束 `SUCCESS` 或 `ERROR` 停留。默认 remote-access 策略下所有方法仅限 owner。

可变（volatile）Config 字段就是共享的桌宠设置。ui-pet 设置页通过 `pet` 条目的通用设置表单编辑它们，本模块在 `loader/volatile-update` 时应用，无需重新挂载：

| 字段 | 默认值 | 作用 |
| --- | --- | --- |
| `visible` | `true` | “显示桌宠”；隐藏时汇总与数据流照常运行 |
| `restrictTools` | `false` | 开启后，`restrictedTools` 中工具的审批带 `restrictedInPet: true`，桌宠改为引导到主窗口 |
| `restrictedTools` | `[]` | 需要在主窗口审批的工具名 |
| `notifyWaiting` / `notifySuccess` / `notifyError` | `true` | 系统通知类别，以 `snapshot.settings.notify` 发布；每台设备仍需自行开启 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

`PetService` 是注册在 Host 根的 `TypertRemoteService`，因此其 `session/event` 与 `session/disposed` 监听器能看到所有会话。`PetReducer` 是纯增量汇总：

- `turn/start` 置为 `THINKING`；`tool/call` 置为 `WORKING`，并按工具名分类出动作；没有未结束的工具时，`tool/result` 回到 `THINKING`。
- `turn/end` 中 `completed` 与 `max-tokens` 映射为 `SUCCESS`，`error` 映射为 `ERROR`，其余原因映射为 `IDLE`。结果分别停留 `successHoldMs` / `errorHoldMs`；停留结束时由定时器重新推送。
- `approval/asked` 与 `approval/decided`（user-approval 写入的审计事件）跟踪待审批项，包括本身未被跟踪的子代理会话。只要存在待审批项，角色即为 `WAITING`。
- `todo/write` 提供进度，`session/title` 提供标题，`job/registered` / `job/settled` 列出运行中的作业。

角色优先级为 `WAITING > ERROR > SUCCESS > WORKING > THINKING > IDLE`。被钉住的会话获得焦点，除非 `waitingPreempts` 让 `WAITING` 会话抢占。`watch()` 在 `snapshotDebounceMs` 内合并变化。汇总失败只记录日志，绝不影响会话追加路径。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-pet](../../client/ui-pet/README.zh.md) — 页内角色与 Desktop 桌宠窗口。
- [user-approval](../../interaction/user-approval/README.zh.md) — 审批 waterfall 及其审计事件。
- [桌宠设计笔记](../../../.agents/notes/proposed/feature/2026-10-17-studio-pet-phase0-findings.zh.md) — Phase 0 结论。

-----

<a id="model-experience"></a>
## 模型体验

无，本包不暴露面向模型的工具或提示词。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **MVP 范围** — 未实现 `TALKING`、压缩与重试状态。除可见性、工具限制与通知类别以外的设置（气泡、性格、快捷键、更新）未实现。
- **Host 侧不做审批决定** — 从 Host 决定需要 user-approval 能取消已转发给 Client 的请求；因此改由 Client 回答。

<a id="dev-note"></a>
### 开发备注

无。
