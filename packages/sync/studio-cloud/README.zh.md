---
description: "Studio 账号登录与明确选择的个人对象同步，凭据由 Host 管理，持久队列按账号隔离。"
kind: "package-reference"
---

# @deepseek-ai/dsh-studio-cloud

[English](README.md) | 中文

## 概述

Host 管理 Studio 登录，与模型提供商授权相互独立。在 Web 或桌面配置中挂载 `@deepseek-ai/dsh-studio-cloud`。服务依赖 `credentials`；浏览器调用生成的 `studioCloud` Remote，绝不接收云端令牌。登录不会直接启用上传：在用户确认本机与云端快照预览之前，账号状态保持 `preview-required`。刷新令牌轮换合并并发请求，并在发送请求前持久化轮换中状态。退出登录会取消活动请求、删除本机授权，并汇报设备撤回结果。模型凭据与本地会话保持独立。

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

Web 与 Desktop 配置将此服务与旧批次 outbox 独立挂载。默认状态目录位于 `$DSH_HOME/studio-cloud`；服务地址与账号哈希隔离持久队列、游标及本机项目映射。同步循环默认间隔为 30000ms，且仅在用户显式确认选择后运行。

贡献声明包含命名空间、载荷版本、顶层字段白名单、导出器与导入器。导出在文本脱敏前过滤字段。内置偏好贡献包含主题和语言字段；项目元数据排除本地目录路径，下载的项目需要显式绑定工作区。未知载荷版本在预览中可见但不可导入。未注册的插件配置与存储绝不导出。

首次预览下载一致的云端快照。数据源选择显式指定保留本机或云端数值，冲突绝不静默覆盖任一方。后续同步使用增量游标，并将不可变的入队请求保留至收到确认。导入失败会保留其检查点。暂停同步会保留全部本地数据。

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

- 模型凭据、执行权限、环境变量以及本地代码目录保留在本机，绝不进行云端同步。
- 在恢复过程中阻止执行任意未经审核的插件代码。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
