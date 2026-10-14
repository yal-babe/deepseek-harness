---
description: "Models 提供商卡片上的 Codex 与 Antigravity 登录控件。插件注册到 llm-pi-ai 和 llm-antigravity 的 provider-card 座位，并与 oauth Remote 命名空间通信。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-oauth

[English](README.md) | 中文

## 概述

Models 提供商卡片上的 Codex 与 Antigravity 登录控件。插件注册到 llm-pi-ai 和 llm-antigravity 的 provider-card 座位，并与 oauth Remote 命名空间通信。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用此包

插件以键 `llm-pi-ai` 和 `llm-antigravity` 注入 `settings.models.provider-card`。`openai-codex` 行和 `antigravity` 行会渲染登录、取消、退出登录、状态以及打开登录页操作。各卡片监视自己凭据（`llm-pi-ai/openai-codex` 或 `llm-antigravity/default`）的 `oauth/watch`。处于 waiting-browser 的 URL 会在新的浏览上下文中打开；Desktop 的 `dsh-app:` 源在 Electron 拒绝 `window.open` 并把 URL 交给系统浏览器时仍视为已打开。弹窗被拦截时，仅在 waiting-browser 期间仍可使用打开登录页。登录进行中时取消仍可用。Codex 的浏览器/设备码选择会自动选浏览器。仍带授权 URL 的粘贴提示会保留取消和打开登录页，而不换成继续输入框。Host 命令失败会留在卡片上。

<a id="understand-the-implementation"></a>
## 理解实现

Host 上的 OAuth 桥拥有尝试生命周期。本包只负责展示：通过 inject hook 发布流式视图，组件内从不持有 `ctx`。

<a id="further-exploration"></a>
## 深入探索

[Models 设置](../ui-settings-models/README.zh.md) 包声明 provider-card 座位。[oauth 控制器](../../api/oauth-controller/README.zh.md) 拥有 Remote 命名空间。

<a id="model-experience"></a>
## 模型体验

无，因为 Codex 与 Antigravity 登录是配置期与人的对话，OAuth 状态不进入模型请求。

#### KV Cache effect

不改变模型请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 目前只接了已随包提供的 `openai-codex` 行和 Antigravity 账号行。其他 llm-pi-ai OAuth 提供商不会渲染这些控件。Host 重启会放弃进行中的尝试。
