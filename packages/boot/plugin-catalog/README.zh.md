---
description: "设置页聚合插件市场目录：社区（dsh-plugin.org）与 Codex（openai/plugins）源，Host 侧搜索与安装分发。"
kind: "package-reference"
---

# @deepseek-ai/dsh-plugin-catalog

[English](README.md) | 中文

## 概述

Host Remote：下载并缓存社区插件目录与 Codex 市场源，为设置里的插件市场 UI 分页搜索，并分发安装——社区 DSH bundle 走 [plugin-manager](../plugin-manager/README.zh.md)，Codex skills 落到 `$DSH_HOME/skills`。

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

`plugin-catalog/install-progress` 上报目录条目 id 与单调递增的阶段完成百分比。社区插件按元数据检查及 plugin-manager 安装、应用阶段推进，Codex 还包含技能文件完成计数。成功时上报 100%，失败则返回正常错误结果，不标记安装完成。不同条目可同时请求，plugin-manager 协调共享 profile 的修改。

基于 base 的 Web profile 与 `plugin-manager` 一并组合本服务。设置中的 **插件市场** 页（[ui-settings-plugin-marketplace](../../client/ui-settings-plugin-marketplace/README.zh.md)）调用 `pluginCatalog.search` / `get` / `installEntry` / `uninstall`，带 Hub 分类、排序、已安装筛选与 Codex 源。Feed URL 与缓存时长为 Config 字段。Feed 下载或校验失败会抛出 `plugin-catalog/feed-failed`；UI 必须显示可重试错误，禁止静默空列表。

可解析安装规格的社区条目为 `compatibility: full`，经 `pluginManager.inspect` + `installBundle` 安装。提供 skills 的 Codex 条目为 `partial`（skills 落到 `$DSH_HOME/skills/codex-<name>`）；仅 MCP/hooks 的表面为 `unsupported`，或在详情中说明部分兼容缺口。

已安装的社区 bundle 通过 plugin-manager 切换启用状态。禁用的 Codex 技能保存在发现目录之外的 `$DSH_HOME/disabled-skills` 下；启用后恢复到 `$DSH_HOME/skills`。更新保留启用状态，卸载删除启用及禁用的文件。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

`PluginCatalog` 是命名空间为 `pluginCatalog` 的 `TypertRemoteService`。社区行来自 `GET {communityOrigin}/plugins.{locale}.json`（Hub 紧凑字段）。Codex 行来自 openai/plugins 的 `marketplace.json`，详情由各插件的 `.codex-plugin/plugin.json` 与 skills 目录的 GitHub Contents 列表补全。搜索在 Host 侧过滤与分页，浏览器不会收到完整的约 14k 社区目录。安装分发不删除无关凭据；社区卸载走 `removeBundle`，Codex 卸载只删除已物化的 skills 目录。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-settings-plugin-marketplace](../../client/ui-settings-plugin-marketplace/README.zh.md) — 设置区 UI。
- [plugin-manager](../plugin-manager/README.zh.md) — 社区 bundle 安装。
- [dsh-skill](../../skill/skill/README.zh.md) — 从 `$DSH_HOME/skills` 加载 skill。
- [hooks-codex](../../experimental/hooks-codex/README.zh.md) — Codex hooks 适配（非一键安装）。

-----

<a id="model-experience"></a>
## 模型体验

无；本包不暴露面向模型的工具或提示。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **Codex MCP 与 hooks 不提供一键安装** — 目录仅用于兼容徽章；需另行配置 `dsh-mcp-client` / `dsh-hooks-codex`。
- **社区 API 形状钉死为 Hub 紧凑 JSON** — Feed 改版会响亮失败，直至解析器更新。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

社区契约：`https://api.dsh-plugin.org/plugins.{en|zh}.json`。Codex 契约：`https://raw.githubusercontent.com/openai/plugins/main/.agents/plugins/marketplace.json` 及各插件 `plugin.json`。

</details>

社区条目从仓库包清单解析缺失图标，并按目录缓存有效期缓存结果。
