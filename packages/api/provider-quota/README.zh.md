---
description: "Host Remote：用已存 OAuth grant 读取 Codex 与 Antigravity 额度，并返回不含令牌的安全视图。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-provider-quota

[English](README.md) | 中文

## 概述

Host Remote：用已存 OAuth grant 读取 Codex 与 Antigravity 额度，并返回不含令牌的安全视图。令牌不进入该 Remote。命名空间为 `providerQuota`，以免方法名 `get` 与 Gateway 保留动词冲突。

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

基于 base 的 Web profile 与凭据、Codex / Antigravity 适配器一并组合本服务。账号设置与个人中心调用 `providerQuota.get('codex' | 'antigravity')` 和 `providerQuota.consumeCodexReset()`。未登录显示未签名卡片；失败卡片可重试。兑换 Codex 重置卡前，Client 必须先确认。本 Remote 不调用 CLI Proxy 的 `resetCooldown`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

`ProviderQuota` 是命名空间为 `providerQuota` 的 `TypertRemoteService`。Codex 使用已存 `llm-pi-ai/openai-codex` oauth grant 访问 ChatGPT WHAM usage、subscriptions、Codex 模型目录与 rate-limit reset credits。Antigravity 使用 `resolveAccessToken` 与 `loadCloudCodeProject`，再按管理中心的 URL 回退顺序请求 `retrieveUserQuotaSummary`，并用 `loadCodeAssist` 读取付费档位。视图不含令牌与 grant 载荷。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-settings-account](../../client/ui-settings-account/README.zh.md) — 设置页三张额度卡片。
- [ui-personal-center](../../client/ui-personal-center/README.zh.md) — 侧栏同一视图的摘要。
- [llm-pi-ai](../../llm/llm-pi-ai/README.zh.md) — Codex WHAM 解析与请求。
- [llm-antigravity](../../llm/llm-antigravity/README.zh.md) — Cloud Code 额度摘要。

-----

<a id="model-experience"></a>
## 模型体验

无；本包不暴露面向模型的工具或提示词。

#### KV Cache 影响

无；本包既不组装也不发送提供商请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **Antigravity 没有重置卡** — Cloud Code 不提供可兑换的重置卡，因此 Antigravity 卡片没有重置操作。
- **DSH Studio 账号不是额度来源** — Codex 与 Antigravity 额度仍要求这两家提供商的已存 grant。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

字段映射对齐 CLI Proxy 管理中心的 `fetchCodexQuota` / `fetchAntigravityQuota`。界面中的重置卡过期时间为 Asia/Shanghai，不带时区后缀。

</details>

Codex 与 Antigravity 的模型目录将加载失败和空结果分别返回。

Codex 额度请求前通过适配器凭据存储刷新过期授权。模型发现失败时保留明确标注来源的已安装适配器目录。

订阅查询未能提供到期时间时，Codex 通过凭据存储锁内的刷新读取身份字段，同时保留额度与模型结果。
