# DSH Studio 内置桌宠交接（Phase 0 + MVP）

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
- 提示音、TALKING/压缩/重试状态未做（设置页、右键菜单、拖动、系统通知已在 MVP 分支完成，见下文）。

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
# 定向测试（MVP 分支）
pnpm exec vitest run packages/pet/pet packages/client/ui-pet apps/desktop/tests/pet-window.spec.ts apps/desktop/tests/pet-position.spec.ts apps/desktop/tests/tray.spec.ts apps/desktop/tests/preload-app.spec.ts scripts/client-bundle-purity.spec.ts --coverage.enabled=false
# 只打 ui-pet 客户端 bundle
(cd packages/client/ui-pet && pnpm run bundle)
```

- Web：按仓库 README 构建并启动 `dsh web`，打开页面后右下角出现角色；在 URL 后加 `?dsh-pet-window=1` 预览桌宠窗口界面。
- Desktop：按 `apps/desktop/README.md` 的 Develop 一节运行 `pnpm run dev:desktop`；进入工作区后右下角出现透明桌宠窗口；`Ctrl/Cmd+Shift+Space` 打开快速提问；`DSH_DESKTOP_PET=0` 关闭桌宠窗口。拖动角色移动窗口（位置存 userData `pet-window.json`）；Windows 托盘右键有"显示桌宠/隐藏桌宠"。
- 设置：设置面板 →"桌宠"页（显示桌宠、通知类别、限制在桌宠中审批的工具）。
- 开发包：`DSH_PET_DEV=1 DSH_PET_DEV_PACKS=/path/to/packs` 启动 Host，`/path/to/packs/<任意名>/pet.json` 按 `packages/pet/pet/packs/whaletail-maid` 的格式编写。

## 已知问题

- 桌宠窗口是第二个完整 Client 渲染进程，内存约等于第二个主窗口。
- 内嵌帧约 300 KB base64 进入客户端 bundle（`lib/client.js` 约 394 KB）。
- 宠物包：只支持 `frames` 渲染器与开发包；签名包、内容包、换装、脚本、声音、台词播放均未做；`lines.json` 只随包提供并由测试检查。开发包只在 Host 启动后首次 `pet.pack()` 时读取一次（改包需重启 Host），设置页没有"开发者"分区，被跳过包的 `problems` 目前没有界面显示。
- THIRD_PARTY_NOTICES 生成器不扫描资源文件，打包声明中缺少鲸尾女仆许可证（许可证文件随源码提供）。
- 会话状态每个会话只暴露优先级最高的待交互项，同一会话并行的第二个审批要等第一个结束。
- macOS 没有菜单栏/Dock 菜单的显示桌宠入口（Windows 有托盘；两端都有快捷键与设置页）。
- Windows 上 `dsh://session/<id>` 深链经第二实例启动时不会被处理（`second-instance` 拿不到 argv）。
- 拖动、托盘、会话跳转、设置页均未在真机上运行验证。
- 基础分支上 `gen-cordis-catalog`、`gen-cordis-api`、`gen-doc-graphs`、`gen-persistence-catalog` 本就失败（plugin-catalog、studio-cloud 的问题），`gen-module-graph` 也有大量无关漂移；因此只手工保留了生成文件中与 pet 相关的部分，`docs/module-graph*.md` 与文档图未更新。
- `verify-no-unknown-casts`、`verify-package-dependencies` 在基础分支上已有无关违规；新代码未引入新的违规。

## MVP 进度（分支 `studio/pet-mvp`，基于 `studio/pet-phase0`）

Phase 0 提交完成后，MVP 工作在后续分支 `studio/pet-mvp` 上进行（便于 Phase 0 单独审阅与合并）。

| §9 MVP 项 | 状态 |
| --- | --- |
| 提问卡（`user-questions/request`） | **已完成（部分）**：单选选项题可在桌宠中回答（800 ms 防误触；单题一次点击，多题逐题选择后提交）；自由文本与多选题显示"打开主窗口"。实现：`packages/client/ui-pet/src/client/questions.ts`（`collectQuestions`、`petAnswerable`、`PetQuestionBridge`）、`Pet.tsx` 的 `QuestionCard`、控制器 `questions` / `answerQuestion`。单测覆盖率 100%。与审批相同，未做运行时验证 |
| 审批卡、拖文件发任务、全局快捷键快问、浏览器页内宠物、"关闭=隐藏"、随 Studio 启停 | Phase 0 已有基础版 |
| TS Reducer 扩展（`agent/status`、`api-session/*`、questions 等待态） | 未做 |
| 右键菜单 | **已完成**：右键角色弹出菜单（快速提问、打开主窗口〔仅 Desktop〕、通知开关、勿扰 1 小时、隐藏），Escape 关闭，首项获得焦点（`Pet.tsx` 的 `PetMenu`） |
| 系统通知 + 基础勿扰 | **已完成（基础版）**：默认关闭，从菜单开启并申请权限；新审批请求、会话完成/出错时通知（文档未聚焦时、不在勿扰时段内）；点击通知把应用切到前台。偏好按设备存 `localStorage`（`dsh-pet:preferences`），不同步。实现：`notifier.ts`（`diffNotices`、`mayNotify`、`watchNotices`、`browserNotifications`）、`preferences.ts`。未做：全屏/会议自动降级、按类别开关、提示音 |
| Web 重新显示入口 | **已完成**：隐藏后页面角落留一个小鲸鱼按钮，点击即 `setVisible(true)` |
| `dsh://session/<id>` 跳转（`openMain` 导航到会话） | **已完成**（`a84eb3eb6`）：菜单"打开主窗口"打开桌宠焦点会话，审批/提问卡上的按钮打开该卡所属会话，点击系统通知打开对应会话。Desktop：桌宠 IPC `openMain(sessionId)` → 主进程校验 id（≤200 字符，`[\w.:-]`）→ 恢复/聚焦主窗口 → `dsh-pet:open-session` → 主窗口 `uiWorkspace.openSession`；macOS 的 `open-url` 也处理 `dsh://session/<id>`。Web：直接 `uiWorkspace.openSession`。未做：Windows 第二实例 argv 中的 `dsh://session/` 链接 |
| 设置页 zh/en（含"限制在宠物中审批的工具"）、通知类别、可见状态持久化 | **已完成**（`6de3f7fd5`）：设置面板"桌宠"页（`settings.section` id `pet`，Web 与 Desktop 主窗口）。Host `pet` 的 `visible`、`restrictTools`、`restrictedTools`、`notifyWaiting/Success/Error` 是 volatile Config，经 `settings.update(entryId, …)` 写入 profile patch，Host 重启后保留；页面通过通用 `configForms` 编辑，无需新 Remote 方法。受限工具的审批卡不显示按钮，只提示并提供"打开主窗口"（默认不限制，D3）。设备级通知总开关仍在 `localStorage`，两个窗口通过 `storage` 事件同步 |
| Desktop 托盘开关、窗口位置记忆 | **已完成**（`cd06650f2`）：Windows 托盘菜单"显示桌宠/隐藏桌宠"（经桌宠渲染进程改 Host `visible`，设置页与 Web 同步）；拖动角色（>4 px）移动窗口，主进程自己读鼠标位置；松手后限制在工作区内，按显示器布局保存到 userData `pet-window.json`（最多 8 种布局），显示器变化/重新显示时恢复，无有效记录回到右下角。macOS 暂无菜单栏开关 |
| 内置宠物包 v2 目录结构（`whaletail-maid@1.0.0`）与开发开关加载本地包 | **已完成（frames 渲染器）**（`937e42678`）：包目录 `packages/pet/pet/packs/whaletail-maid/`（`pet.json` formatVersion 2、`lines.json` zh/en、`assets/frames/*.webp`、`LICENSE`），以 `@deepseek-ai/dsh-pet/packs/*` 导出；纯解析器 `@deepseek-ai/dsh-pet/pack`（`parsePetPack` 一次报告全部问题：必需槽、包内路径、ref 循环、engines caret 范围、renderer 只接受 `frames`；`resolvePetClip` 走 §5.1 回落链）。ui-pet 打包时校验内置 `pet.json` 并内嵌帧（已实际跑 tsdown：36 帧 + 清单进入 `lib/client.js`）；`tsdown.client.ts` 的 INLINE_SAFE 放行 `dsh-pet/pack` 与 `dsh-pet/packs/**.{json,webp,png}`。开发开关：Host 设置 `DSH_PET_DEV=1` + `DSH_PET_DEV_PACKS=<dir>` 后，新 Remote `pet.pack()` 提供 `<dir>` 子目录中（按名称）第一个有效包（帧为 data URL，单张 ≤4 MiB、总计 ≤30 MiB、realpath 不得逃出包目录），其余目录的问题放在 `problems`；Client 再次校验后渲染，并在角色下方显示"开发包"标记。偏差：设计写的是 `packages/pet/packs`，这里放在 `packages/pet/pet/packs`，以便通过包导出被 Host 与 Client 引用而不新建 workspace 包 |
| 删除原生 Helper 构建链 | 不适用（本仓库没有引入 Helper） |

提问卡的已知限制：只处理每个会话优先级最高的待交互项；有待审批时先显示审批卡；提问卡依赖桌宠窗口中 ui-user-questions 已把请求发布到 `uiSession.sessionStatus`（与审批相同的前提，需真机确认非当前会话是否也会发布）。

## 下一步（按顺序）

1. **真机验证**（最优先，以下全部只经过编译与单测）：Windows 上 `pnpm run dev:desktop`，检查桌宠窗口无需登录即连接、拖动与位置记忆（含多显示器/拔插）、托盘"显示/隐藏桌宠"、设置页三组开关写入 profile 并在 Host 重启后保留、受限工具的审批卡、菜单/卡片/通知的"打开主窗口"跳到正确会话；Web 上检查设置页与卡片跳转；`DSH_PET_DEV=1 DSH_PET_DEV_PACKS=<dir>` 放一个复制改名的 `whaletail-maid` 检查"开发包"标记。
2. 提问卡补自由文本输入与多选（`questions.ts` 的 `petAnswerable` 目前只放行单选）。
3. Windows 第二实例 argv 中的 `dsh://session/<id>`；macOS 菜单栏/Dock 菜单的显示桌宠入口。
4. TS Reducer 扩展（`agent/status`、`api-session/*`、TALKING/压缩/重试）。
5. 宠物包后续：`spritesheet` 渲染器、台词播放（`lines.json`）、设置页"开发者"分区显示 `problems`、开发包热重载、studio-cloud 签名包（§2.6）。
6. 修复基础分支上的生成器失败后，重新运行 `gen-doc-graphs`、`gen-cordis-catalog`、`gen-module-graph` 并提交 pet 相关输出；让 THIRD_PARTY_NOTICES 覆盖资源许可证。

## 推送状态

- MVP 分支 `studio/pet-mvp` 同样无法推送（无凭据）。替代交付：`/workspace/deliverables/pet-mvp.bundle`（`origin/studio/main..studio/pet-mvp`，包含 Phase 0 提交）与 `/workspace/deliverables/pet-mvp-patches/`（同一范围的完整补丁序列，可直接在 `origin/studio/main` 上 `git am`）。每个检查点都会重新生成。

- 2026-10-17 16:0x（Asia/Shanghai）尝试 `git push -u origin studio/pet-phase0`：失败，`fatal: could not read Username for 'https://github.com'`——box 上没有 GitHub 推送凭据。按要求没有绕过认证，也没有用 `--no-verify`。pre-push 钩子（完整类型检查）因此也没有运行。
- 替代交付：`/workspace/deliverables/pet-phase0.bundle`（`git bundle create ... origin/studio/main..studio/pet-phase0`）与 `/workspace/deliverables/pet-phase0-patches/`（`git format-patch`）。在有凭据的机器上：`git fetch /path/pet-phase0.bundle studio/pet-phase0:studio/pet-phase0 && git push -u origin studio/pet-phase0`，或 `git am pet-phase0-patches/*.patch`。
- 提交作者是仓库本地配置的 `Grok Bot <grok-bot@users.noreply.github.com>`；如需改成本人身份，推送前用 `git rebase -r origin/studio/main --exec 'git commit --amend --no-edit --reset-author'` 修改。
