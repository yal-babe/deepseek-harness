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

web-app bundle 在 Web 与 Desktop profile 中挂载本服务，并同时挂载 [ui-pet](../../client/ui-pet/README.zh.md) Client 插件。Client 调用 `pet.watch()` 获取完整 `PetSnapshot` 帧流，调用 `pet.getSnapshot()` 读取一次。`pet.setVisible(boolean)` 切换所有桌宠界面，但不停止汇总；它通过 [settings](../../settings/settings/README.zh.md) 服务写入本条目的 `visible` 字段，因此 Host 重启后仍保留；没有 Settings 或 profile 条目时只在本次 Host 运行期间有效。`pet.pin(sessionId | null)` 选择气泡跟随的会话。`pet.acknowledge(sessionId)` 在用户看过结果后结束 `SUCCESS` 或 `ERROR` 停留。`pet.pack()` 返回代替内置包渲染的宠物包（见[宠物包](#pet-packs)）。默认 remote-access 策略下所有方法仅限 owner。

可变（volatile）Config 字段就是共享的桌宠设置。ui-pet 设置页通过 `pet` 条目的通用设置表单编辑它们，本模块在 `loader/volatile-update` 时应用，无需重新挂载：

| 字段 | 默认值 | 作用 |
| --- | --- | --- |
| `visible` | `true` | “显示桌宠”；隐藏时汇总与数据流照常运行 |
| `restrictTools` | `false` | 开启后，`restrictedTools` 中工具的审批带 `restrictedInPet: true`，桌宠改为引导到主窗口 |
| `restrictedTools` | `[]` | 需要在主窗口审批的工具名 |
| `notifyWaiting` / `notifySuccess` / `notifyError` | `true` | 系统通知类别，以 `snapshot.settings.notify` 发布；每台设备仍需自行开启 |

<a id="pet-packs"></a>

### 宠物包

宠物包是一个目录，不是 npm 插件：`pet.json`（格式版本 2）、`lines.json`（按触发器组织的 zh/en 台词）、`assets/` 与 `LICENSE`。内置包 `whaletail-maid@1.0.0` 位于 `packs/whaletail-maid`，以 `@deepseek-ai/dsh-pet/packs/*` 导出；ui-pet 打包其中的帧。`@deepseek-ai/dsh-pet/pack` 是两端共用的纯解析器，可在浏览器中运行：`parsePetPack` 检查格式版本、id 与版本、`engines`（以 caret 范围匹配宠物运行时 1.0.0 与宠物 API 1）、渲染器、画布、帧率、已知动画槽、必需槽（`idle`、`thinking`、`working`、`waiting`、`success`、`error`、`dragging`，每个提供帧或 `ref`）、不含 `..` 的包内相对 `.webp` / `.png` 路径、引用目标与循环，以及 persona 块，并一次返回全部问题。`resolvePetClip` 沿 `ref` 与槽位回落链解析，最终落到 `idle`。当前运行时只渲染 `frames` 渲染器；`spritesheet`、Spine 与 Live2D 包会被拒绝。

开发宠物包时，设置 `DSH_PET_DEV=1` 与 `DSH_PET_DEV_PACKS=<dir>` 后，`pet.pack()` 会从 `<dir>` 的子目录（按名称排序）中提供第一个有效包，不校验签名，标记为 `dev: true`，帧以 data URL 形式提供（单张图最多 4 MiB，每个包最多 30 MiB）。被跳过的目录及原因放在 `problems` 中返回。该目录每次 Host 运行只读取一次。未开启时 `pet.pack()` 返回 `{ pack: null, problems: [] }`，Client 继续使用内置包。尚未加载来自 studio-cloud 的签名包。

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
- **宠物包** — 只支持 `frames` 渲染器与开发包；不支持 studio-cloud 签名包、内容包、换装、脚本与声音。`lines.json` 随包提供并有测试检查，但尚未用于台词。
- **Host 侧不做审批决定** — 从 Host 决定需要 user-approval 能取消已转发给 Client 的请求；因此改由 Client 回答。

<a id="dev-note"></a>
### 开发备注

无。
