# DSH Studio 插件市场需求

[English](plugin-marketplace-requirements.md) | 中文

在现有「设置」内增加统一插件市场，方便用户查找、安装和管理插件。

## 插件来源

- DSH 官方插件。
- [DSH 社区 Plugin Hub](https://dsh-plugin.org/zh/plugins/dshplugin/dsh-plugin-hub)，标注为社区来源。
- [Codex 官方插件市场](https://github.com/openai/plugins)，标注在 DSH Studio 中的兼容情况。

## 基本功能

- 浏览和搜索插件，按来源筛选。
- 查看插件名称、图标、简介、作者、版本及使用说明。
- 安装、更新、卸载插件，查看已安装状态。
- 提示不兼容、安装失败及需要重启等情况。

## 接入要求

- 沿用现有插件页面和管理能力，不另做一套插件管理系统。
- 先聚合 DSH 官方和社区插件，再接入 Codex 插件。
- Codex 插件按 Skills、MCP、Hooks 等实际能力逐步适配，明确标注完全兼容、部分兼容或暂不支持。
- 更新和卸载时保留用户凭据及无关配置。

## 完成标准

用户能在一个入口查找不同来源的插件，完成受支持插件的安装、更新和卸载，并清楚了解插件来源与兼容情况。

实现入口在 **设置 → 插件市场**（[`ui-settings-plugin-marketplace`](../packages/client/ui-settings-plugin-marketplace/README.zh.md)），Host 目录为 [`plugin-catalog`](../packages/boot/plugin-catalog/README.zh.md)。侧边栏「插件」页保持为开关/配置/手动安装，不改成市场。
