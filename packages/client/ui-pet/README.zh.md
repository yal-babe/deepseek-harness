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

web-app bundle 将本插件与 Host `pet` 模块一同挂载。打开任意 Web 页面，右下角即显示角色。在 URL 后加 `?dsh-pet-window=1` 可在浏览器中预览桌宠窗口界面。Desktop 在该 URL 上打开一个独立的透明置顶窗口，此时 Desktop 主窗口不再显示页内角色。在桌宠窗口中，拖动角色超过 4 px 会移动窗口而不是打开气泡；Desktop 托盘也可以通过同一个 Host 设置显示或隐藏桌宠。`CommandOrControl+Shift+Space` 可在任何地方展开或收起快速提问，并在桌宠被隐藏后重新显示它。

右键点击角色打开菜单：快速提问、打开主窗口（仅 Desktop）、开关系统通知、勿扰 1 小时、隐藏桌宠。按 Escape 关闭菜单。"打开主窗口"会把 Desktop 主窗口切到前台，并打开桌宠当前展示的会话；审批卡片与提问卡片上的"打开主窗口"按钮打开该卡片所属的会话。Web 上没有独立窗口，这些卡片按钮直接在当前页面打开该会话。

系统通知默认关闭，需要从菜单开启，开启时会向浏览器或 Desktop 申请权限。开启后，出现新的审批请求、会话完成或出错时桌宠会发通知，但仅在你没有看着桌宠所在文档、且不在勿扰时段内时发送。点击通知会把应用切到前台并打开对应的会话。两项设置按设备保存在 `localStorage`（`dsh-pet:preferences`），不同步；Desktop 桌宠窗口与主窗口通过 `storage` 事件同步彼此的修改。

设置面板中有 **大肥鱼** 页面（`settings.section`，id `pet`），在 Web 和 Desktop 主窗口中提供，条件是挂载了 ui-settings 且 Host 提供 `pet` 条目。它通过 `configForms` 编辑 Host [`pet`](../../pet/pet/README.zh.md) 字段：显示桌宠、三个通知类别（新的审批请求、任务完成、任务出错），以及"限制可在桌宠中审批的工具"和工具列表（默认关闭，桌宠可以审批全部工具）。该页面还包含按设备保存的系统通知开关，并说明桌宠当前运行在 Desktop 窗口还是页面内。

审批卡片出现后两个按钮会禁用 800 ms，回车从不批准。设置限制的工具的审批不显示按钮，而是说明限制并提供"打开主窗口"。在桌宠中决定与在主窗口中决定回答的是同一个 Host 请求；先到的回答生效，另一处界面关闭卡片。

当 Agent 提问（`ask_user_question`）且没有待审批项时，气泡显示提问卡片。只提供单选选项的问题可以在桌宠中回答，同样有 800 ms 延迟：单个问题点一次即提交，多个问题则每题选一项后点"提交回答"。自由文本与多选问题显示一个打开主窗口的按钮。

内置动作从 Host 按需加载，内嵌的小帧集用于失败回退。仅空闲时显示的动作菜单提供原有互动以及吐泡泡、打盹、蹭手和庆祝。可选的部位点击分别触发头部、身体和尾巴动作，默认单击仍打开面板。设备级设置控制安静／标准／活泼待机间隔、自主移动（默认关闭）、特效和减少动态；工作、提问、审批、拖动及展开面板优先于空闲玩耍。设备偏好支持名称（默认“大肥鱼”）、50%～200% 大小、空闲／休息／娱乐状态，以及允许自主播放的动作。宠物包的 `motion.json` 列出分类时，自主动画链先在当前生活状态可用的分类中按权重抽取分类，再从中选出与上一段不同的片段；内置包的小动作分类（伸懒腰、打哈欠、发呆、观察、整理仪容和东张西望）用于空闲，玩耍分类（吐泡泡、庆祝、追逐泡泡、玩球和尾巴转圈）用于娱乐。没有分类的宠物包沿用这两组固定列表。属于具名动作的片段遵守允许自主播放的动作列表。标记为转身的片段（如东张西望）播放后角色朝向反转，之后的片段随之镜像，标记为不可镜像的除外。任务状态自动覆盖生活状态，结束后恢复；休息播放入睡、持续睡眠和醒来分段。自主移动播放起步、定向游动和停下分段，Web 和桌面端分别更新页面坐标与原生窗口。二十项菜单动作包含额外十套：发呆望天、好奇观察、悠闲游动、整理仪容、追逐泡泡、玩小皮球、尾巴转圈、翻书阅读、托腮思考和抱枕酣睡。四套重制及十套新增图集共含 666 个实际帧，按导入配方中每个动作配置的 6～10 fps 播放。图集播放器跟随浏览器动画帧调度，等待图片加载，并在分段切换时复用已加载图集。思考阶段在可用的思考、灵光一闪和阅读片段间轮换，不增加模型请求。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

- `PetStore` 通过 `ctx.remote.$stream` 消费 `pet.watch()`；载体断开或终止性失败会让角色显示 `DISCONNECTED`，直到下一帧到来。
- 审批不经 Host 决定。每个 Client 本来就用 ui-approval 的 `PendingApproval` 回答转发来的 `approval/request` waterfall。桌宠从 `uiSession.sessionStatus` 读取这些对象，按会话与工具调用与 Host 待审批项匹配，并通过 `PetApprovalBridge` 回答；它会拒绝同一界面的第二次提交。Gateway 以第一个结果结束 waterfall 并取消其他 Client，因此主窗口与桌宠窗口不可能都做出决定。
- 提问走同一路径：ui-user-questions 把每个请求作为 `PendingQuestion` 发布到 `uiSession.sessionStatus`，`PetQuestionBridge` 对该对象只回答一次。已结束的回顾卡片与计划评审会被跳过。
- 通知比较 Host 的相邻两帧（`diffNotices`）；连接后的第一帧从不通知，子 Agent 会话会被跳过。Desktop 中只有桌宠窗口运行 ui-pet，所以每次变化只通知一次；多个 Web 标签页会各自通知。
- 快问可通过关闭按钮、Esc、外部点击和重复触发收起，挂载期间保留草稿与附件。待办仍保留在 Host，不同的新请求可以再次打开面板。桌宠声明根作用域列表插槽 `pet.panel.metrics`，传递面板可见性、焦点会话和任务状态，由个人中心提供用量与余额；桌宠不直接导入个人中心运行时代码。

- 快速提问依次执行 `session.create`（新会话时）、对每个拖入的文件执行 `fileUpload.upload`，再以 queue 模式执行 `session.prompt`。
- Desktop bridge（`window.dshDesktopPet`）在指针进入或离开角色与气泡时切换点击穿透，跟随 Host 可见性，并转发全局快捷键。
- 帧：来自 [`@deepseek-ai/dsh-pet/packs/whaletail-maid`](../../pet/pet/README.zh.md#pet-packs) 的内置包 `whaletail-maid@1.0.0`，idle、thinking、working、waiting、success、error 片段各取六帧，裁剪并缩放到 160 px。bundle 加载时用 `parsePetPack` 校验其 `pet.json`，帧以 data URL 形式内嵌。角色及其帧与媒体来自 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)；其素材仅限非商业使用，衍生作品须附上该地址（[条款](../../pet/pet/README.zh.md#pet-packs)）。设置页末尾的“角色来源”一行链接到内置 `pet.json` 的 `license.source` 地址。Host 通过 `pet.pack()`（`DSH_PET_DEV`）提供开发包时，Client 会再次校验并渲染它，角色下方显示"开发包"标记；无效或不完整的包会保留内置包。

</details>

-----

<a id="model-experience"></a>
## 模型体验

无，本包在浏览器中渲染桌宠，不注册任何面向模型的内容。

#### KV Cache 影响

无；快速提问就是普通的用户提示。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **媒体支持** — 内置动作使用透明 VP9 视频和十四组生成图集，生成画面的姿态连续性仍可继续精修，帧数本身不保证视觉连续；开发包仍使用帧图。尚无声音和说话状态，桌面端移动仍需平台实测。
- **每个会话一个审批** — 会话状态只暴露优先级最高的待交互项，同一会话中并行的第二个审批需在主窗口回答。
- **重新显示入口** — 隐藏后 Web 页面角落留一个小鲸鱼按钮。Desktop 可以用全局快捷键、设置页，Windows 上还可以用托盘；macOS 暂无菜单栏入口。

<a id="dev-note"></a>
### 开发备注

无。
