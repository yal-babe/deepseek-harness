# Agent Note: 桌宠 Phase 0 结论

Status: proposed

[English](2026-10-17-studio-pet-phase0-findings.md) | 中文

## Problem

桌宠设计（v0.4）把四个集成点标为【假设】：(a) 桌宠与主窗口都能显示审批且不会重复决定；(b) 独立的 Desktop 桌宠窗口可以复用 Host 的已认证连接；(c) 带拖入文件的快速提问可以通过现有 Remote 完成；(d) 全局快捷键可以唤出桌宠。Phase 0 是一个纵向切片，在构建角色包、拖动、声音与 TALKING 状态之前先验证这些假设。本笔记记录切片验证了什么、验证到何种程度，以及仍未解决的问题。

## Proposal

Phase 1 沿用 Phase 0 的架构：Host 模块拥有快照，每个 Client 通过 ui-approval 回答审批，Desktop 打开第二个 Client 窗口。Phase 1 应增加托盘或菜单开关以及 Web 的"显示桌宠"入口，持久化可见状态与窗口位置，让 `openMain` 把主窗口导航到被点击的会话，并加入 TALKING、压缩与重试状态。在此之前，应在 Windows 与 macOS 上实际运行一次 Electron 应用以确认 (b) 与 (d)，包括透明像素上的点击穿透与多显示器定位。

## Findings

### 审批竞争 (a)

通过设计与单元测试验证；未做端到端运行。Host `pet` 模块无法自行决定审批：`approval/request` 是一个 waterfall，由 Gateway 转发给每个已连接的 Client，只有 Client 的结果能结束它。Host 侧的 `decide` 需要在 user-approval 或 Gateway 中新增入口。因此每个 Client 都通过 ui-approval 已在 `uiSession.sessionStatus` 中发布的 `PendingApproval` 回答。Gateway 采用第一个结果，并向其他 Client 发送 `cancel`，中止它们的 `PendingApproval`，于是另一窗口的卡片消失。在同一界面内，`PetApprovalBridge` 拒绝第二次提交，并在请求已不存在时报告 `already-settled`。`tests/approvals.client.spec.ts` 模拟了主窗口与桌宠窗口在同一个共享结算点上的竞争。限制：会话状态每个会话只暴露优先级最高的待交互项，所以同一会话中并行的第二个审批要等第一个结束后才会出现在桌宠中。

### 共享已认证连接 (b)

已编译并通过单元测试；未做运行时验证，因为 box 没有显示器，无法运行 Electron。桌宠窗口以 `?dsh-pet-window=1` 加载主应用 URL，并使用同一个 preload。HTTP 走 `dsh-app://app/` 协议处理器，它会为任何窗口附带 Host cookie。WebSocket cookie 允许列表按 `webContents` 区分，因此 `main.ts` 现在也接受 `pet.owns(webContentsId)`，locale bootstrap 也接受桌宠窗口。Boot IPC 本来就接受任何应用发送方。桌宠窗口是第二个完整的 Client：它有自己的 Gateway 连接和插件集合。代价是多一个渲染进程（大约相当于第二个主窗口的内存）；`DSH_DESKTOP_PET=0` 可关闭它。

### 带文件的快速提问 (c)

在 Client 层通过单元测试验证。`sendQuickAsk` 在目标为新会话时执行 `session.create`，通过 `ctx.fileUpload.upload` 上传每个拖入的文件，再以 queue 模式带上上传后的引用调用 `session.prompt`。失败时报告失败阶段（`create`、`upload` 或 `prompt`）并保留草稿。无需改动 Host。

### 全局快捷键 (d)

注册代码已用模拟的 `globalShortcut` 做单元测试；未做运行时验证。`CommandOrControl+Shift+Space` 显示桌宠窗口、强制打开气泡并聚焦快速提问框。注册失败只记录警告，桌宠仍可使用。目前在用户隐藏桌宠后，快捷键是 Desktop 上重新显示桌宠的唯一方式。

## Alternatives considered

- **Host 侧审批决定** — `pet.decide` Remote 可以让桌宠不依赖 ui-approval 对象作答，但 waterfall 只能由 Client 结果结束；这需要修改 user-approval 或 Gateway，并会绕过现有的按 Client 取消机制。Phase 0 不采用。
- **不加载完整 Client 的精简桌宠页** — 可省内存，但需要自己的认证与 Remote 接线；在真机上确认 (b) 并测量内存之前不采用。
- **只在主窗口内渲染桌宠** — 最简单，但主窗口隐藏时桌宠也会消失，违背了桌宠的初衷。

## Acceptance criteria

- 在真实 Desktop 运行中，桌宠窗口无需第二次登录即可连接，显示焦点会话状态，透明像素上的点击可以穿透。
- 在任一窗口中决定的审批会关闭另一窗口的卡片，Host 只记录一次决定。
- 带拖入文件的快速提问进入所选会话，并附带这些文件。
- 在 Windows 与 macOS 上，全局快捷键能显示被隐藏的桌宠并聚焦快速提问框。

## Risks

- **Bundle 体积** — 36 帧内嵌图片给客户端 bundle 增加约 300 KB base64；角色包必须改为懒加载。
- **第三方声明** — 鲸尾女仆美术资源为 MIT 许可（Copyright (c) 2026 PC2005-cloud）。许可证与帧文件放在一起，但 THIRD_PARTY_NOTICES 生成器不扫描资源文件，因此在生成器覆盖资源之前，打包后的声明中缺少它。
- **内存** — 第二个渲染进程会让低端机器上的客户端内存翻倍。
- **生成文档** — 在基础分支上，`gen-cordis-catalog`、`gen-cordis-api`、`gen-doc-graphs` 与 `gen-persistence-catalog` 已因无关的包而失败，所以加入这些生成器的 pet 条目未能重新生成或检查。
