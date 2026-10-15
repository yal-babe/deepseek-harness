---
description: "插件市场设置区：Hub 式分类/搜索/排序、已安装与自定义安装，外加 Codex 源。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-plugin-marketplace

[English](README.md) | 中文

## 概述

在设置中打开 **插件市场**，按 Hub 方式浏览社区目录（分类、搜索、Star/Fork/更新排序、已安装、自定义安装），并加上 Codex 源。侧边栏 **插件** 页保持不变。

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

挂载了 [plugin-catalog](../../boot/plugin-catalog/README.zh.md) 与本客户端包的 Web 组合，会在 **内置插件** 旁显示该区。Host 搜索对社区与 Codex 源按 Hub 分类与排序分页。社区 DSH bundle 经 plugin-manager 安装；Codex skills 落到 `$DSH_HOME/skills`。兼容徽章始终可见；不支持的条目禁用安装。Feed 失败显示可重试错误，而非空列表。

安装和启用状态变更会显示不定进度条，直至宿主报告完成。已安装条目提供启用/禁用按钮；目录图标不可用时显示默认图标。关闭设置后仍会显示操作结果提示。

社区插件与内置插件页使用相同的插件管理操作和清单，并跟随管理状态变更刷新。市场支持切换卡片与列表布局，操作区底部对齐。详情在加宽、可滚动的弹窗中渲染 Markdown。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

本包注册 `settings.section`，id 为 `marketplace`（order 16）。浏览器半侧拥有 `settings.marketplace` 词典，以及调用 `remote.pluginCatalog`（自定义安装再调 `remote.pluginManager`）的 `MarketplaceStore`。Toast 报告安装结果与重启要求；不做通知中心。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [plugin-catalog](../../boot/plugin-catalog/README.zh.md) — Host 目录 Remote。
- [ui-settings-plugins](../ui-settings-plugins/README.zh.md) — 内置插件区（不变）。
- [ui-plugin-manager](../ui-plugin-manager/README.zh.md) — 侧边栏插件页（不变）。

-----

<a id="model-experience"></a>
## 模型体验

无；本包是浏览器侧设置表面，不注册模型表面。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **Codex MCP 与 hooks 不提供一键安装** — 详情页说明缺口；需另行配置这些表面。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
