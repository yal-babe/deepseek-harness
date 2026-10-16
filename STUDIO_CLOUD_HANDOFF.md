# DSH Studio 个人云接入交接

日期：2026-10-16。用途：交给后续 agent 继续实现用户已批准的个人云接入计划。这是临时交接记录，不是发布说明或产品能力承诺；代码、测试和运行状态是事实来源。用户因剩余额度不足要求停止实现并交接。

## 先读这些信息

- 工作目录：`/Users/li/Desktop/linli/project/dsh-studio`。
- 分支：`studio/main`；当前 HEAD（交接时）：`feat(studio): refine personal center and account quota integration`。
- **本轮所有云接入改动尚未提交**，包括大量未跟踪文件。先执行 `git status --short`，不要清理、重置或漏掉新包。没有授权推送、部署或上传真实个人数据。
- 当前目标仍是整个计划，不是仅让现有测试通过。不能将只读恢复当作已经完成跨设备续聊，也不能将 HTTP 集成测试当作真实 Web／桌面验收。
- 原计划按“账号接入 → 同步基础与轻量数据 → 文件与会话恢复 → 插件恢复及综合验收”交付。当前处于第三阶段，前两阶段也有收尾缺项。
- 最后一次代码修改是会话设备状态隔离测试和文件原子发布；最终构建、聚合类型检查、完整验收尚未覆盖最新树。

## 用户批准的范围和不可丢失的要求

| 要求 | 当前状态及下一步 |
| --- | --- |
| 以现有 `services/studio-cloud` 为服务端；Studio 身份独立于模型账号 | 已有 Host 服务和 UI 接入；需真实流程验收 |
| 登录、首次改密、邀请、邮箱验证、找回密码、设备查看及撤销 | 已有 Remote／表单；逐项验证异常和账号切换 |
| 浏览器不保存访问令牌；凭据进现有凭据服务 | 已实现；继续审查外部凭据替换和刷新轮换竞态 |
| 第一次登录先读取云端快照，再预览并明确选择本地／云端数据 | 已有核心流程和同意勾选；选择界面、分类及后续新增数据语义待完善 |
| 资料、主题、语言、快捷键等明确字段双向同步 | 主题／语言已有；资料统一更新与客户端贡献、快捷键未完成 |
| 项目名称、顺序、会话关联同步；目录由设备绑定 | 元信息贡献及绑定 Remote 已有；绑定 UI、排序稳定性待补 |
| 完成对话、附件、生成文件同步，恢复阅读及新分支续聊 | 会话块和持久附件可传输、只读恢复；生成文件完整覆盖和续聊未完成 |
| 插件清单／版本／启用状态及明确声明的数据配置同步 | 尚未完成；不能导出任意插件存储或执行云端配置 |
| Token 活动从同步会话计算并按会话／分支去重 | 尚未完成，不能简单相加重复的继承前缀 |
| 凭据、环境变量、设备授权、代码目录、运行进程不上传 | 过滤及会话设备事件替换已有；需完整审计。选中对话仍可能含代码片段和工具输出，预览已有说明 |
| 离线、持久队列、不可变请求 ID、版本比较、快照及增量游标 | 已有核心；游标过期／服务恢复／未知结果重试的综合验证待补 |
| 409 明确冲突；首次偏好／资料／项目冲突保留双方选择 | 核心引擎已处理；需要完整冲突 UI 验收 |
| 完整轮次、不可变分块、4 MiB 对象限制、恢复用原有校验及迁移 | 已实现核心且有超过 4 MiB 的隔离集成验证 |
| 下载历史只读；新设备续聊新 Session ID，不拼接事件流／不重跑任务 | 只读下载已实现；新分支及对应回放验证未完成 |
| 云端删除、恢复、本地删除分开；版本化删除标记；关同步不删数据 | 暂停保留数据已有；显式删除／恢复流程未完成 |
| 能力接口、载荷版本、文件引用、插件命名空间版本 | 服务端及基础类型已有；客户端完整能力协商仍待补 |
| 文件持久卷主存储、S3 备份，包括文件字节的容量／保留清理 | 已有实现和部分测试；需收尾并复验最新改动 |
| 首期普通同步；E2EE 云空间拒绝普通上传 | 已有保护；不得添加伪装可用的 E2EE 开关 |
| 旧 `/v1/batches` 不迁移、不共用设备凭据 | 新服务和协议独立；只复用纯脱敏工具 |
| 两设备、撤销、账号隔离、配额、重试、冲突、删除恢复、备份恢复 | 有一部分测试；对照原计划补齐矩阵，不以测试总数代替覆盖审计 |
| Web／桌面真实流程、回放／界面快照、构建、类型、中英文文档 | 少量界面快照与历史构建通过；最终整体交付未完成 |

## 代码地图

### 服务端：`services/studio-cloud`

原有独立 Fastify／PostgreSQL 服务，要求 Node >=24。已安装其本地依赖。新迁移 `migrations/002-files.sql` 增加 `cloud_files`、`cloud_file_parts` 和同步对象 `file_refs`；`src/db.ts` 单调应用至第二代迁移并拒绝更新版本。

- `src/app.ts`：新增 `/v1/capabilities`，协议／载荷版本、对象限制、文件传输能力。**`sessionRestore:false` 仍保留**，完整恢复流程未完成前不要随意宣布支持。
- `src/files.ts`：账号隔离的创建、状态、PUT 分块、完成确认、下载；配额预留、幂等 ID、完整性校验、完成后不可变；下载持有共享 advisory lock 702120 防 GC。最后修改将分块写入改为临时文件加 rename 原子发布，尚未重跑服务端测试。
- `src/sync.ts`：发布对象前检查文件引用已完成且同账号；同步返回文件引用；统一 profile 更新并同步显示名；文件计入容量；保留版本冲突与请求幂等。
- `src/maintenance.ts`：备份格式 2 同时包含文件表和去重文件字节，仍接受格式 1；备份共享锁、GC 独占锁；保留当前对象／历史／快照引用；先提交元数据清理，再单独扫物理孤儿，避免事务回滚后引用指向被删文件。现有 S3 仍存备份副本。
- `src/config.ts`：`FILE_PART_BYTES` 默认 1 MiB，允许 64 KiB–4 MiB；`FILE_MAX_BYTES` 默认 64 MiB，最大 1 GiB。
- `tests/service.test.ts`：扩展至 19 个服务测试，曾全部通过，包含真实 S3 夹具；最后原子写修改后需要复验。
- `tests/host.integration.mjs`：新增使用根仓构建产物的两设备 Host／HTTP 服务集成。需要先构建根仓及服务端，再 `npm run test:host`。
- `tests/s3-fixture.mjs`：改成随机端口，输出实际地址，避免共享固定端口。

### Host 新包：`packages/sync/studio-cloud`

包名 `@deepseek-ai/dsh-studio-cloud`，默认 TypertRemoteService，`ctx.studioCloud`。已接入 Web bundle 的 Host 层、API remotes、根 tsconfig 路径／references、pnpm lock 和 UI 依赖。新包整体未跟踪，必须一起保留。

- `src/index.ts`：独立登录及账号 Remote、凭据持久化、单飞刷新、请求取消／生命周期、设备管理、同步状态流、贡献注册、按账号隔离的引擎、项目绑定 Remote、历史列表和只读内容 Remote。凭据键 `studio-cloud/connection`；刷新前先持久化 `refreshPending`，未知轮换结果要求重登，不复用旧刷新令牌。
- `src/types.ts`：安全账号／设备／状态／预览／历史展示类型，结构化 Remote 失败。有些跨界 ID 仍是 string，需要按仓库规则审查品牌类型和公开 JSDoc。
- `src/transport.ts`：显式 origin、HTTP 同意、禁止跳转、超时和账号取消信号、JSON 校验、有界二进制下载；浏览器不接触令牌。
- `src/sync-engine.ts`：持久化选择、已知版本、增量游标和不可变 outbox；导出先字段白名单再脱敏；preview 不上传，选择后先持久化请求再准备文件／上传；未知结果保留原请求；导入后才推进检查点；409 作为冲突；未知版本不能导入。
- `src/projects.ts`：项目元信息／云 ID 与本机工作区映射；无路径上传；下载未绑定项目需用户选现有工作区。**当前排序实现可能被未同步的设备本地项目干扰，需修复或明确稳定排序域。**
- `src/cloud-files.ts`：本机私有 chunks 缓存和 files.json；preview 仅暂存；同内容稳定 UUID；恢复分块上传和下载校验。最后修改使重新 stage 可修复缺失缓存并保留旧 UUID，尚无该路径单测。complete=true 后仍调用完成接口复验服务端文件。
- `src/session-codec.ts`：只截到最后 `turn/end`；继承前缀没有自己的完整轮次不单独导出；从白名单构造物理头，排除 cwd；脱敏字段／文本／JSON 字符串；用现有 Session format catalog 校验和迁移；恢复仅 detached Session，不创建 Agent 或 writable Session。
- `src/cloud-sessions.ts`：`dsh-session-1` 清单引用不可变日志块和图片／文件块；用真实持久层读取，避开查询层合成的恢复闭合事件；live Session 先 flush；迁移前本地日志列为阻塞；附件缺失明确记录；下载后恢复到真实 AttachmentStore，核对 ID／大小／名字／尺寸；不可变历史快照与 histories.json；附件导入不完整不推进同步检查点。

**最近的会话隔离修改：** `session-codec.ts` 将 `working-directory/change`、`permission/preset`、`sandbox/mode`、`approval/policy`、`approval/asked`、`approval/decided` 替换为保持 seq／time 的 `plugin:studio-cloud/device-local`、`ignorable:true` 记录，只保留事件类型，避免继承设备目录和执行授权。原日志不修改。下载恢复还会拒绝残留这些活动事件的载荷。最后新增的测试验证位置连续和消息投影保持一致；5 个 codec 测试通过。仍需检查 PluginRecordMap 声明是否涉及生成目录／持久类型登记，并测试恶意下载的拒绝路径。

### 会话附件公共帮助函数

`packages/session-query/session-log-export/src/archive.ts` 新导出 `collectSessionAttachments(events)`，复用原归档器的规范内容字段遍历；`src/index.ts` 重新导出。不会跟随任意路径。需要补公共文档／直接 API 测试。生成文件若仅由 deliverables/presented 引用而没有持久附件记录，**目前不保证包含**，必须补齐真实所有者的导出能力，不能扫描或上传项目目录。

### GUI：`packages/client/ui-settings-account`

- `AccountMenu.tsx`：始终提供独立 Studio 入口，即使 DeepSeek 已登录；不再展示静态假登录。
- `StudioLoginDialog.tsx`／新 `StudioAccount.tsx`：共享真实 Host 表单；账号登录／找回／邀请／改密／邮箱／设备；服务地址、HTTP 明确同意；容量、选择预览、同意勾选、暂停／恢复；下载历史的只读消息和附件缺失列表。
- `src/client/index.ts`：通过框架注入 hooks 和 Host Remote 接线，监听账号状态、账号 generation 阻止旧请求污染新界面；settings.section 注册 `studio-cloud`。新增代码较密，需要整理及 scoped lint。
- `StudioAccount.module.css`、`locales.ts`：语义 token／响应式样式及中英文文案。尚无真实浏览器视觉验收；需检查共享滚动条、390px、长标题／错误与焦点。
- **缺少 UI**：目录绑定、续聊、本地模型／权限前置检查、插件恢复确认、显式删除／恢复、更完整分类和冲突操作。

### 测试夹具配套改动

- `packages/test-support/client-runtime/src/assembly/remote-default-responses.ts`：Studio 初始 signed-out 和 watch 默认响应，支持新增开机状态流。
- 同目录 `bundle-roster.ts`：anchor 已经是 bundle 自身 package.json 时直接定位自身 manifest，修复 pnpm 安装后的自解析失败；需要对应聚焦测试，不能当作无关删除。
- 账号 UI 单测和中英文菜单／登录快照更新；apply 单测的 `$stream` 拦截仅针对 account，不再误拦新增 Studio stream。

## 接手后优先事项

1. 先读根／子目录 AGENTS、`docs/architecture.md`、`docs/defensive-patterns/README.md` 和相关技能，检查 git diff，确认所有新文件在场。不要重新从零实现相同服务。
2. 格式化新文件、scoped lint／类型检查，补最后几处文件缓存／原子发布／下载拒绝的回归测试；重跑现有聚焦测试。READMEs 有落后实现的限制描述，需更新，不能直接据此判断代码未完成。
3. 完成只读历史 → 独立本地续聊分支，补项目绑定及前置授权 UI，再做插件贡献／确认恢复。之后补资料／快捷键／用量／删除／异常恢复。
4. 完成真实隔离 Web／桌面验收和回放，再运行最新 build:artifacts → build:check，更新中英文文档、类型与生成登记。按完整需求矩阵审计后再宣布完成。

### 续聊设计约束（未实现，供接手评估）

下载历史保持当前只读缓存，不直接导入 SessionPersistence。用户明确选择本机存在且可用的 Workspace，并解析本机 preset。为一次续聊持久化稳定请求 UUID 与来源对象版本／workspace／preset 回执，使用独立 child Session ID；未知响应重试同 ID，已有日志核验后返回，绝不覆盖原日志或拼接不同设备历史。

使用现有 `@deepseek-ai/dsh-session/fork` 的 `buildForkSeed(events,boundary)`，精确保存 inheritedEventCount；新头携带本机 cwd、parentSession、isSeeded 和本机 preset。继承后追加本机目录和 preset 选择事件，避免旧投影覆盖本机选择。先持久化分支，不创建 Agent，不发模型请求，不重跑历史任务；执行只通过正常打开会话／明确新提示流程进入。部分写入失败必须明确报错，不能静默当成功。

上述是实现建议，不是已验证行为。需要进一步确认现有 Session persistence、fork、preset、workspace 和 API 的所有权及生命周期。模型授权、目录／附件／插件缺失应列为明确前置条件。不能仅凭头部 preset 就忽略继承的 preset 事件，也不要安装第二套 model-selection owner。

### 已识别但未收尾的风险

- index.ts 的项目／历史 owner 缓存可能保留已卸载注入服务的实例；HMR／重新注入需要重新绑定或清缓存。
- 外部替换 credentials 记录时是否立即取消旧账号任务，需要验证；刷新中的 `getState` 可能暂时显示 reauth，需要合理区分已确认失效和正在单飞刷新。
- 非 VERSION_CONFLICT 的同步失败目前界面状态不够完整；游标 410 要进入可恢复的重新预览流程，不能丢队列或假成功。
- 首次选择目前偏向具体对象 ID；同步类别／项目内后续新会话是否自动纳入必须有明确授权语义。
- 会话继承区间需要来源标识，保证祖先单独同步与只同步后代两种情况下用量都不重计／漏计；简单删除全部继承区间不满足需求。
- `restoreCloudSession` 校验后直接将 catalog 当前事件断言成 SessionEvent[]；不要引入 `as unknown` 绕过检查。
- 生成文件、插件任意配置、云端任务执行不能用“兼容性回退”偷偷导入。
- 服务端文件 GC、临时文件保留／清理、完成接口的每块／总大小校验、缺失分块恢复策略仍需复核最新实现。

## 验证证据与限制

下表是历史执行结果，**不是最新全树通过声明**。临时日志可能被系统清除；日志缺失时重跑，不推断成功。

| 检查 | 已观测结果 | 日志／限制 |
| --- | --- | --- |
| Studio Host 聚焦单测 | 3 文件、13 测试通过 | `/tmp/dsh-cloud-host-tests.log`；在最后新增 codec 用例及缓存修复之前 |
| codec 最新单测 | 1 文件、5 测试通过 | `/tmp/dsh-cloud-codec-tests.log`；最后一次测试，包含设备事件中和 |
| 账号／登录 UI | 曾 67 测试通过 | `/tmp/dsh-cloud-account-ui-tests.log`；非最后全树 |
| apply UI | 30 测试通过 | `/tmp/dsh-cloud-apply-tests.log` |
| 服务端测试 | 曾 19 测试通过，含 S3 备份 | 最后原子分块发布改动后尚未重跑 |
| 构建产物上的两设备 Host／HTTP 集成 | 1 测试通过 | `/tmp/dsh-cloud-host-integration.log`；真实 PostgreSQL、独立 schema／设备临时目录；预览零上传、>4 MiB、附件、只读；不是 GUI 流程 |
| 根 build:artifacts | 7/7 通过，64.84 秒 | `/tmp/dsh-cloud-build-artifacts.log`；早于最后文件与 codec 修改 |
| 根 build:check | 2/2 通过，约 530 秒 | `/tmp/dsh-cloud-build-check.log`；早于当前会话块／历史 UI 的部分修改，必须最终重跑 |
| 局部 lint／依赖检查 | 曾局部通过；全局依赖门有 7 个已有违规 | 新文件仍需重新 lint；不要以此跳过新违规，也不要顺手扩大修复无关包 |

曾并发运行全 GUI 和 build:check 导致资源竞争和大量超时，后来只修复并重跑相关聚焦测试。不要声称全 GUI 通过，也不要再并发跑这两个重检查。既有依赖违规主要涉及 ui-brand-official、ui-settings-oauth、sync/client-ui-sync 的 peer／dev／React 类型声明，需重新确认当前输出。

### 常用命令

根仓 Node 22.21.1、pnpm 11.28.5；服务端使用本机已有 Node 24：`/Users/li/.nvm/versions/node/v24.11.1/bin`。此前 `pnpm exec` 有时触发额外安装包装，直接调用已安装工具更明确。

```sh
node node_modules/vitest/vitest.mjs run packages/sync/studio-cloud/tests --maxWorkers=1
node node_modules/vitest/vitest.mjs run packages/client/ui-settings-account/tests/apply.client.spec.ts --maxWorkers=1
node node_modules/typescript/bin/tsc -b packages/sync/studio-cloud
node node_modules/tsx/dist/cli.mjs scripts/run-oxlint.ts <本次文件> --fix
pnpm run build:artifacts
pnpm run build:check
```

服务端独立测试使用专用数据库，先设置 `TEST_DATABASE_URL`，不要使用生产库；测试会创建并清理自己的 schema。S3 用 `TEST_S3_ENDPOINT`，默认夹具访问凭据在测试源码里。`test:host` 依赖最新根仓和服务端构建产物。

```sh
PATH=/Users/li/.nvm/versions/node/v24.11.1/bin:$PATH npm run build --prefix services/studio-cloud
PATH=/Users/li/.nvm/versions/node/v24.11.1/bin:$PATH npm test --prefix services/studio-cloud
PATH=/Users/li/.nvm/versions/node/v24.11.1/bin:$PATH npm run test:host --prefix services/studio-cloud
```

## 当前外部测试资源（交接时实查）

- Colima 已启动，Docker socket：`unix:///Users/li/.colima/default/docker.sock`。不要例行停整个虚拟机。
- 临时 PostgreSQL 容器 `dsh-cloud-integration-20261016` 正在运行，Postgres 17 alpine，映射 `127.0.0.1:32768 -> 5432`，测试库 `studio_test`，用户 postgres。仅临时隔离测试使用；凭据可由当前容器配置读取，不写入本交接文件或提交。
- S3 夹具进程在交接时为 PID 96224，命令 `node services/studio-cloud/tests/s3-fixture.mjs`；此前监听 61508，继续使用前重新确认，不把历史端口当存活证据。
- 原有用户 Web 在 3080 运行，启动父进程 78466／78468。它使用真实默认用户数据，**不要拿它做首次云同步测试或随意停止**。新隔离验收应另设 DSH_HOME、文件目录、服务端地址和端口。
- 拉镜像时曾因系统 Docker credential helper 缺失，用临时 Docker config `/tmp/dsh-cloud-docker-20261016`；现有镜像无需重复拉取。
- 后续完成后只清理明确由本任务创建的夹具进程／容器／目录；跨会话 PID 可能变化，先验证命令与身份。

## 必须遵守的仓库要求

先读根 AGENTS、`packages/AGENTS.md`、更具体目录指令、架构与 defensive-patterns。UI 使用 `dsh-client-ui-ux`／`dsh-responsive-ui`；异常使用 `dsh-error-handling`；文档使用 `dsh-doc`／`dsh-prose-standard`；新并发测试按 `dsh-ci-test-reliability`；推送或宣称分支检查通过前按 `dsh-pre-push-checks` 选命令。不要使用子 agent，除非用户或适用指令明确要求。

Cordis 注册必须有 effect／disposer；GUI 文案中英文 typed dictionary；不添加 `as unknown`；不编辑冻结的 Session 格式世代；持久类型变更需要按仓库规则登记。文档必须补齐受影响 README／JSDoc，并更新双语 sidecar；当前新包 README 的“尚无 session chunks／attachment restoration”已经落后实现，需要改正，不能发布这一错误描述。

真实 Web 自动化需用仓库支持的 dsh 启动方式和目录选择覆盖：`pnpm dsh web --patch apps/web/tests/pin-browse-picker.overlay.yml --no-open --port <隔离端口>`。此前 CUA 多次超时；不将自动化不可用误报为验收成功，也不绕过工具限制改用私自注入的浏览器控制。若创建 GUI PR，按 record-browser-gif 技能补真实流程 GIF；本轮没有要求创建 PR。

## 下一位 agent 可直接使用的任务提示

继续完成本工作区用户已批准的 DSH Studio 个人云接入计划。先阅读 STUDIO_CLOUD_HANDOFF.md 和当前 git diff，保留全部未提交／未跟踪改动；对照需求矩阵补齐独立续聊分支、插件恢复、资料和快捷键、项目绑定／持续同步、去重用量、删除恢复及错误恢复。只使用隔离测试环境，不上传真实个人数据、不部署或推送。先验证最近的会话设备状态隔离与文件写入修改，再按真实 Host／Web／桌面流程和回放、构建、类型检查、中英文文档完成交付。不要把已通过的局部测试当作整个计划完成。
