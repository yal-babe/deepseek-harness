---
description: "Studio 账号登录与明确选择的个人对象同步，凭据由 Host 管理，持久队列按账号隔离。"
kind: "package-reference"
---

# @deepseek-ai/dsh-studio-cloud

[English](README.md) | 中文

## 概述

Studio 登录由 Host 管理，与模型提供商认证独立。登录后先下载云端数据，再由用户勾选上传分类并开启自动同步。设备名默认取系统主机名。云端令牌始终保存在 Host 凭据存储，退出登录取消进行中的请求并移除本地 Studio 授权，保留本地模型账号与会话。刷新令牌轮换使用单次并发操作，并在请求前持久化轮换中的状态。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

状态目录内的本机 `server.json` 独立保存 HTTP 或 HTTPS 服务地址。通过设置 → 服务端配置保存后，登录与找回密码复用该地址，不再要求勾选 HTTP。已有登录账号的服务地址自动迁移；切换服务端前需先退出账号。存储服务不可用时仍保留缓存账户身份与地址，并显示可重试错误。

Web 与 Desktop 配置将此服务与旧批次 outbox 独立挂载。默认状态目录位于 `$DSH_HOME/studio-cloud`；服务地址与账号哈希隔离持久队列、游标及本机项目映射。同步循环默认间隔为 30000ms，且仅在用户开启上传和自动同步后运行。

贡献声明包含命名空间、载荷版本、顶层字段白名单、导出器与导入器。导出在文本脱敏前过滤字段。内置偏好贡献包含主题、语言、对话展示、编码工具显示及模型提供商设置，自定义提供商请求头保留在本机；项目元数据排除本地目录路径，下载的项目需要显式绑定工作区。未知载荷版本在预览中可见但不可导入。未注册的插件配置与存储绝不导出。

选中会话使用 `dsh-session-2`，保留原始 Session ID 与事件位置来源区间；仍可读取 `dsh-session-1`。Token 活动使用 token-meter 归一化后的持久结算记录，包含失败与重试调用，不比较消息内容。总量保留提供方精确值；缺失用量、相互矛盾的副本及无法解析的祖先均明确标记不完整。缓存写入计数及明细未知标记与提供方余额独立。导出新格式前先更新全部设备，参见[升级指南](../../../docs/upgrade-guide/v0.2.1-rc.2/studio-usage-sources/guide.zh.md)。

登录后恢复云端快照，后续下载使用增量游标。锁定的模型凭据延后恢复。上传分类覆盖后续新增的对象，高级预览保留本机与云端的显式冲突选择。后续同步使用增量游标，并将不可变的入队请求保留至收到确认。导入失败会保留其检查点。暂停同步会保留全部本地数据。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

服务实现管理单飞令牌轮换、持久发件队列、增量同步引擎循环以及会话续接回执，完全解耦于模型提供商传输层。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务生命周期、Cordis 注册与 Remote 接口处理 |
| [`src/transport.ts`](src/transport.ts) | HTTP 客户端、刷新轮换与设备撤回网络传输 |
| [`src/sync-engine.ts`](src/sync-engine.ts) | 持久发件箱、增量游标处理与贡献者分发调度 |
| [`src/cloud-sessions.ts`](src/cloud-sessions.ts) | 云端历史流式读取、快照预览与会话续接派生 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Studio 云端服务](../../../services/studio-cloud/README.zh.md) — 后端 HTTP 服务与 PostgreSQL/S3 持久化存储。
- [Studio 账号设置](../../client/ui-settings-account/README.zh.md) — 账号登录与同步预览控制的客户端界面。

-----

<a id="model-experience"></a>
## 模型体验

无，个人云身份和对象同步不贡献模型上下文或工具。

#### KV Cache 影响

无；同步操作不修改模型请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- DeepSeek、Codex、Antigravity 授权及托管的模型 API Key 仅在勾选对应分类并使用至少 12 个字符的独立同步加密口令解锁后同步。AES-256-GCM 在写入同步队列、预览及 HTTP 传输之前加密，scrypt 在本机派生绑定账号的密钥。Studio 令牌、设备身份、环境变量、执行权限及本地代码目录不参与同步。
- 口令和密钥仅保存在 Host 内存；重启或退出 Studio 后需要重新解锁。新设备使用相同口令，找回登录密码无法恢复加密凭据。普通数据未加密；客户端暂不支持服务端的整个空间加密模式。
- 插件清单恢复后供用户审阅，不自动安装或启用插件。任意插件存储需要由所属插件注册同步贡献。
- 在恢复过程中阻止执行任意未经审核的插件代码。
- 旧版分支需要原始祖先才能恢复精确来源区间。从其他 Session 格式代际迁移的历史，在取得兼容导出前无法确定事件位置归属；活动统计标记不完整而不猜测。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
