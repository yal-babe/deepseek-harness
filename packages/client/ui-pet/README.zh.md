---
description: "内置桌宠角色：Web 页内浮层，以及 Desktop 桌宠窗口中的整个文档。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-pet

[English](README.md) | 中文

## 概述

内置桌宠的浏览器端。它镜像 Host [`pet`](../../pet/pet/README.zh.md) 快照，渲染一个带气泡的小型动画角色。气泡显示焦点会话、待审批项，以及可拖入文件的快速提问框。Web 上角色位于 `shell.overlay`。在 Desktop 桌宠窗口（`?dsh-pet-window=1`）中，插件遮蔽 `root`，整个透明文档就是桌宠。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

web-app bundle 将本插件与 Host `pet` 模块一同挂载。打开任意 Web 页面，右下角即显示角色。在 URL 后加 `?dsh-pet-window=1` 可在浏览器中预览桌宠窗口界面。Desktop 在该 URL 上打开一个独立的透明置顶窗口，此时 Desktop 主窗口不再显示页内角色。`CommandOrControl+Shift+Space` 可在任何地方打开快速提问，并在桌宠被隐藏后重新显示它。

右键点击角色打开菜单：快速提问、打开主窗口（仅 Desktop）、开关系统通知、勿扰 1 小时、隐藏桌宠。按 Escape 关闭菜单。

系统通知默认关闭，需要从菜单开启，开启时会向浏览器或 Desktop 申请权限。开启后，出现新的审批请求、会话完成或出错时桌宠会发通知，但仅在你没有看着桌宠所在文档、且不在勿扰时段内时发送。点击通知会把应用切到前台。两项设置按设备保存在 `localStorage`（`dsh-pet:preferences`），不同步。

审批卡片出现后两个按钮会禁用 800 ms，回车从不批准。在桌宠中决定与在主窗口中决定回答的是同一个 Host 请求；先到的回答生效，另一处界面关闭卡片。

当 Agent 提问（`ask_user_question`）且没有待审批项时，气泡显示提问卡片。只提供单选选项的问题可以在桌宠中回答，同样有 800 ms 延迟：单个问题点一次即提交，多个问题则每题选一项后点"提交回答"。自由文本与多选问题显示一个打开主窗口的按钮。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

- `PetStore` 通过 `ctx.remote.$stream` 消费 `pet.watch()`；载体断开或终止性失败会让角色显示 `DISCONNECTED`，直到下一帧到来。
- 审批不经 Host 决定。每个 Client 本来就用 ui-approval 的 `PendingApproval` 回答转发来的 `approval/request` waterfall。桌宠从 `uiSession.sessionStatus` 读取这些对象，按会话与工具调用与 Host 待审批项匹配，并通过 `PetApprovalBridge` 回答；它会拒绝同一界面的第二次提交。Gateway 以第一个结果结束 waterfall 并取消其他 Client，因此主窗口与桌宠窗口不可能都做出决定。
- 提问走同一路径：ui-user-questions 把每个请求作为 `PendingQuestion` 发布到 `uiSession.sessionStatus`，`PetQuestionBridge` 对该对象只回答一次。已结束的回顾卡片与计划评审会被跳过。
- 通知比较 Host 的相邻两帧（`diffNotices`）；连接后的第一帧从不通知，子 Agent 会话会被跳过。Desktop 中只有桌宠窗口运行 ui-pet，所以每次变化只通知一次；多个 Web 标签页会各自通知。
- 快速提问依次执行 `session.create`（新会话时）、对每个拖入的文件执行 `fileUpload.upload`，再以 queue 模式执行 `session.prompt`。
- Desktop bridge（`window.dshDesktopPet`）在指针进入或离开角色与气泡时切换点击穿透，跟随 Host 可见性，并转发全局快捷键。
- 帧：鲸尾女仆角色的 idle、thinking、working、waiting、success、error 片段各取六帧，裁剪并缩放到 160 px。这些帧以 MIT 许可发布，Copyright (c) 2026 PC2005-cloud；许可证见 `src/client/assets/whaletail-maid/LICENSE.txt`。

</details>

-----

<a id="model-experience"></a>
## 模型体验

无，本包在浏览器中渲染桌宠，不注册任何面向模型的内容。

#### KV Cache 影响

无；快速提问就是普通的用户提示。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **Phase 0 范围** — 没有拖动、触摸反应、声音、说话状态或角色包；帧集是内嵌的小子集。
- **每个会话一个审批** — 会话状态只暴露优先级最高的待交互项，同一会话中并行的第二个审批需在主窗口回答。
- **重新显示入口很简单** — 隐藏后 Web 页面角落留一个小鲸鱼按钮；在有托盘开关之前，Desktop 只能用全局快捷键。

<a id="dev-note"></a>
### 开发备注

无。
