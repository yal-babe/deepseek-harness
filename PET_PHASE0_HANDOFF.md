# DSH Studio 内置桌宠 Phase 0 交接

日期：2026-10-17（Asia/Shanghai）。用途：交给后续 agent 或开发者继续实现内置桌宠。这是临时交接记录，不是发布说明；代码、测试和运行状态是事实来源。设计文档：`/workspace/deliverables/dsh-pet-design.md`（v0.4，§9 路线图）。结论笔记：[`.agents/notes/proposed/feature/2026-10-17-studio-pet-phase0-findings.zh.md`](.agents/notes/proposed/feature/2026-10-17-studio-pet-phase0-findings.zh.md)。

## 先读这些信息

- 仓库：`/workspace/dsh-studio`（Linux box），远端 `origin` = `https://github.com/yal-babe/deepseek-harness.git`。
- 分支：`studio/pet-phase0`，基于 `origin/studio/main`（`d511ee56a`）。不要推送到 `studio/main`，不要强推。
- 机器约 4 GB 内存：安装用 `pnpm install --child-concurrency=1`，构建用 `NODE_OPTIONS=--max-old-space-size=2048 DSH_GATE_CONCURRENCY=1`；不要跑完整测试套件或完整 `build:check`。
- 环境：`export PATH=/opt/node-v24.10.0-linux-x64/bin:$PATH COREPACK_HOME=$HOME/.cache/corepack NODE_OPTIONS=--max-old-space-size=2048`。
- 推送结果与提交列表见本文末尾"推送状态"。

## 已完成

| 部分 | 位置 | 内容 |
| --- | --- | --- |
| Host 模块 | `packages/pet/pet`（`@deepseek-ai/dsh-pet`） | 监听根级 `session/event`、`session/disposed`，用 TS reducer 汇总为 `PetSnapshot`（IDLE/THINKING/WORKING/WAITING/SUCCESS/ERROR，工具活动分类、todo 进度、jobs、审批待办、子 Agent 过滤、焦点会话）；Typert Remote `pet`：`getSnapshot`、`watch()` 流、`setVisible`、`pin`、`acknowledge`；Config 见 README |
| 客户端 | `packages/client/ui-pet`（`@deepseek-ai/dsh-client-ui-pet`） | Web 页内 `shell.overlay` 角色；`?dsh-pet-window=1` 时遮蔽 `root` 成为整窗桌宠；审批卡（800 ms 防误触、回车不批准）、快速提问（新会话/最近会话、拖文件上传、queue 模式 prompt）、隐藏、打开主窗口；zh/en 文案；鲸尾女仆 6 个 clip × 6 帧（MIT，Copyright (c) 2026 PC2005-cloud，许可证在 `src/client/assets/whaletail-maid/LICENSE.txt`） |
| 默认 bundle | `packages/bundle/web-app/cordis.patch.yml` | 挂载 `pet` 与 `ui-pet`，桌面端与 Web 都预装 |
| Remote 接线 | `packages/api/remotes`、`tsconfig.*.json`、`test-support/client-runtime` | `petRemote` 加入 Client contribution；默认测试响应 `pet/watch` |
| Desktop | `apps/desktop/src/pet-window.ts`、`main.ts`、`preload-app.ts`、`ipc.ts` | 340×560 透明、无边框、置顶、跳过任务栏、点击穿透窗口；`dshDesktopPet` bridge；WS cookie 允许列表与 locale bootstrap 接受桌宠窗口；全局快捷键 `CommandOrControl+Shift+Space`；`DSH_DESKTOP_PET=0` 关闭 |
| 文档 | 各包 README 三件套、`packages/README`、`packages/client/README`、`apps/desktop/README`（"桌宠窗口"一节）、生成目录中的 pet 条目、结论笔记 | |
| 测试 | `packages/pet/pet/tests`、`packages/client/ui-pet/tests`、`apps/desktop/tests/pet-window.spec.ts` | 11 个文件、84 个用例，三处新代码覆盖率均 100% |

## 未完成（Phase 0 范围内）

- **未做运行时验证**：box 没有显示器，没有实际启动 Electron，也没有在浏览器里打开 `dsh web` 看效果。所有结论来自编译与单元测试。
- **§9 ③ 性能**：60fps 与内存 < 150 MB 未测量。当前帧率是 6 fps 的轮播，不是图集渲染器。
- **§9 ⑥ Web Worker 脚本运行时原型**：未做。
- **§9 ⑦ 宠物包目录结构 + 渲染器重载原型**：未做，帧图直接内嵌在客户端 bundle 中。
- 设置页、右键菜单、拖动、提示音、系统通知、TALKING/压缩/重试状态均未做（属于 MVP）。

## 【假设】验证状态

| 假设 | 状态 | 依据 | 还需要做 |
| --- | --- | --- | --- |
| (a) 宠物与主窗口审批竞争 | 设计 + 单测通过；未端到端 | Host 不能直接决定审批（waterfall 只由 Client 结果结束）。每个 Client 通过 ui-approval 的 `PendingApproval` 作答，Gateway 先到先得并 `cancel` 其他 Client。`approvals.client.spec.ts` 模拟两窗口竞争 | 真实运行两窗口点同一审批，确认 Host 只记一次决定 |
| (b) 桌宠窗口复用 Host 认证连接 | 编译 + 单测；**未运行验证** | 同一 URL 与 preload；HTTP 走 `dsh-app://` 协议处理器自动带 cookie；WS 允许列表扩展到 `pet.owns()` | 在 Windows/macOS 上启动 Desktop，看桌宠窗口是否无需登录即连接 |
| (c) 快速提问 + 拖文件 | Client 层单测通过 | create → upload → prompt（queue）；失败报告阶段并保留草稿 | 真实上传大文件、多文件 |
| (d) globalShortcut | 模拟单测；**未运行验证** | 注册失败只警告 | 真机确认快捷键冲突与唤出 |

## 如何试用

```bash
cd /workspace/dsh-studio
export PATH=/opt/node-v24.10.0-linux-x64/bin:$PATH COREPACK_HOME=$HOME/.cache/corepack NODE_OPTIONS=--max-old-space-size=2048
pnpm install --child-concurrency=1
node_modules/.bin/tsx scripts/generate-typert.ts
# 定向构建
node_modules/.bin/tsc -b packages/pet/pet packages/client/ui-pet apps/desktop
# 定向测试
pnpm exec vitest run packages/pet/pet packages/client/ui-pet apps/desktop/tests/pet-window.spec.ts --coverage.enabled=false
```

- Web：按仓库 README 构建并启动 `dsh web`，打开页面后右下角出现角色；在 URL 后加 `?dsh-pet-window=1` 预览桌宠窗口界面。
- Desktop：按 `apps/desktop/README.md` 的 Develop 一节运行 `pnpm run dev:desktop`；进入工作区后右下角出现透明桌宠窗口；`Ctrl/Cmd+Shift+Space` 打开快速提问；`DSH_DESKTOP_PET=0` 关闭桌宠窗口。

## 已知问题

- 桌宠窗口是第二个完整 Client 渲染进程，内存约等于第二个主窗口。
- 内嵌帧约 300 KB base64 进入客户端 bundle。
- THIRD_PARTY_NOTICES 生成器不扫描资源文件，打包声明中缺少鲸尾女仆许可证（许可证文件随源码提供）。
- 会话状态每个会话只暴露优先级最高的待交互项，同一会话并行的第二个审批要等第一个结束。
- Web 隐藏后没有页内重新显示入口；Desktop 只能用快捷键重新显示；可见状态与窗口位置不持久化。
- `openMain` 只聚焦主窗口，不跳到对应会话。
- 基础分支上 `gen-cordis-catalog`、`gen-cordis-api`、`gen-doc-graphs`、`gen-persistence-catalog` 本就失败（plugin-catalog、studio-cloud 的问题），`gen-module-graph` 也有大量无关漂移；因此只手工保留了生成文件中与 pet 相关的部分，`docs/module-graph*.md` 与文档图未更新。
- `verify-no-unknown-casts`、`verify-package-dependencies` 在基础分支上已有无关违规；新代码未引入新的违规。

## 下一步（按顺序）

1. 在真机上运行 Desktop 与 Web，逐项完成上表"还需要做"，把结论笔记从 proposed 推进。
2. MVP（§9）：提问卡（`user-questions/request`）、右键菜单、`dsh://session/<id>` 跳转、完成/错误/等待提醒与系统通知、基础勿扰、设置页 zh/en、内置宠物包 v2 目录结构与加载、托盘/菜单显示开关、可见状态持久化。
3. 修复基础分支上的生成器失败后，重新运行 `gen-doc-graphs`、`gen-cordis-catalog`、`gen-module-graph` 并提交 pet 相关输出。
4. 让 THIRD_PARTY_NOTICES 覆盖资源许可证。

## 推送状态

见下方，由每次检查点更新。
