---
description: "侧栏个人中心：本机用量统计以及 Codex / Antigravity 额度摘要。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-personal-center

[English](README.md) | 中文

Desktop 产品事件走可选的[产品分析服务](../product-analytics/README.zh.md)；普通 Web 交互不采集。

## 概述

侧栏个人中心：本机用量统计以及 Codex / Antigravity 额度摘要。入口在插件下方。面板展示 DeepSeek 余额、按方式拆分的 token KPI、Codex 与 Antigravity 剩余窗口（不展示订阅名）、26 周 token 热力图、按模型与工具合计，以及有 token 记录的最近未归档会话。

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

Web profile 挂载本插件。侧栏 **个人中心**（`sidebar.panellist` id `personal-center`，order 5）打开同 id 的主面板。打开面板时若有 `localStorage` 快照先绘制，再刷新 Host `usageStats` 与 `providerQuota`。刷新失败保留缓存并提供重试。点击最近会话会在工作区打开它。已归档会话和 token 为零的会话不会出现在最近列表中。

Desktop 侧栏点击上报 `sidebar_menu_click`，`menu_name` 为 `personal`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

浏览器半边注册侧栏图标（`IconUserOutlineRegular`）与主面板。store 把 `usageStats.snapshot` 缓存在 `dsh.usage-stats.v1:<host>`（不含令牌或凭据），并合并当前打开会话的 `tokenUsage` 投影。额度摘要调用与 [ui-settings-account](../ui-settings-account/README.zh.md) 相同的 `providerQuota` Remote。DeepSeek 名称与余额在同一次刷新中来自 account Remote。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [usage-stats](../../session/usage-stats/README.zh.md) — 未归档日志的 Host 折叠。
- [provider-quota](../../api/provider-quota/README.zh.md) — Codex 与 Antigravity 额度视图。
- [ui-settings-account](../ui-settings-account/README.zh.md) — 设置页三卡额度。

-----

<a id="model-experience"></a>
## 模型体验

无；本包不暴露面向模型的工具或提示词。

#### KV Cache 影响

无；本包既不组装也不发送提供商请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **用量不上云** — 热力图与 KPI 来自本机 Session 折叠加浏览器缓存。
- **热力格子使用 ink/surface token** — 是强度方格，不是 GitHub 贡献图。

<a id="dev-note"></a>
### 开发备注

无。

每日热力图以蓝色深浅展示 53 周记录；累计模式保留每日日期网格。

活动日历使用蓝色日期方格、网格底部月份标签及可访问的日期和 Token 提示。

仪表盘区块统一使用边框盒宽度。用量列表分开对齐名称与数值，会话行支持整行点击并在窄屏调整元信息布局。

全年活动网格随容器缩放；Antigravity 额度保留命名分组。

DeepSeek 卡片分别展示充值与赠金钱包，平台提供赠金有效期时显示到期时间，并区分余额不可用与赠金钱包为空。供应商额度窗口以 Asia/Shanghai 时区显示刷新时间。

可选的 `pet.panel.metrics` 插槽复用个人中心数据，显示已记录 Token 累计、当前会话和 DeepSeek 钱包。面板打开、可见任务完成或出错及手动刷新时更新，不轮询、不新增累计计数器。统计不含归档／删除会话及模型未返回的用量，不代表账号终身账单。用户在桌宠菜单选择“查看余额”时，插槽刷新同一份数据并回报读数：每个 DeepSeek 人民币钱包按上游桌宠使用的 ¥20 参考值计算（透支视为全部用完），另加已用最多的 Codex 标准额度窗口；美元钱包和未知值不回报。
