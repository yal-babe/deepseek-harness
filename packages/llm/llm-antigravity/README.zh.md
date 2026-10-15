---
description: "Antigravity Cloud Code 适配器：提供 PKCE 浏览器登录，并在无 grant 时回退到 API key。"
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-antigravity

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-llm-antigravity` 把模型请求以 `antigravity` 提供方发到 Cloud Code 的 `v1internal:streamGenerateContent`。可通过 PKCE 浏览器流程登录并把 grant 存到 `llm-antigravity/default`，也可通过 `apiKeyEnv` 提供 API key。流式输出在 finish 之前发出 usage，工具调用参数保持原始 JSON 字符串。当组合需要对接 Antigravity Cloud Code 时选择本适配器；OpenAI 兼容目录选择 `dsh-llm-pi-ai`。

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

把本插件与 `dsh-llm` 一起挂载。适配器立即注册。在存入 PKCE grant 或存在 `apiKeyEnv` 凭据之前，`listModels('antigravity')` 返回空列表。登录后，空的 `models` 列表（默认）会先 POST Cloud Code 的 `v1internal:loadCodeAssist`，再带上该 companion project POST `v1internal:fetchAvailableModels` 并公布返回的目录；非空 `models` 列表会替换该列举。已存储的 PKCE grant 优先鉴权；否则 `apiKeyEnv` 经凭据服务或启动环境解析。

```yaml
- id: llm-antigravity
  name: '@deepseek-ai/dsh-llm-antigravity'
  config:
    baseURL: https://daily-cloudcode-pa.googleapis.com/v1
    apiKeyEnv: ANTIGRAVITY_API_KEY
```

| Field | Default | Meaning |
|---|---|---|
| `baseURL` | `https://daily-cloudcode-pa.googleapis.com/v1` | 列举与生成所用的 Cloud Code 根路径 |
| `oauthAuthorizeURL` | Google OAuth 授权端点 | 浏览器授权 URL |
| `oauthTokenURL` | Google OAuth token 端点 | 授权码兑换与刷新 |
| `oauthClientId` | Antigravity 公开 client id | 授权与 token 请求发送的 client id |
| `oauthClientSecret` | 已发布的已安装应用 secret | token 请求的 secret；空字符串则省略 `client_secret` |
| `oauthRedirectPath` | `/oauth/antigravity/callback` | 存在 `webServer` 时注册的 Host 回调路径 |
| `apiKeyEnv` | `ANTIGRAVITY_API_KEY` | 没有 grant 时使用的凭据引用 |
| `models` | 空 | 建议目录；为空时登录后从 Cloud Code 拉取 |
| `requestTimeoutMs` | `30000` | 每次 HTTP 请求的截止时间，包括 token 兑换 |
| `streamIdleTimeoutMs` | `300000` | 一次 stream 读取允许的最长空闲间隔 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-llm-antigravity)是每个已接受字段的完整来源。

### 登录

模型目录按端点与凭证缓存。首次加载合并并发请求；已有目录立即返回，并在 `catalogMaxAgeMs`（默认 300000 毫秒）后后台刷新。后台刷新失败会保留原目录，并在该间隔后重试。退出登录后下次读取清除缓存；插件卸载会中止未完成的目录请求。输出用量包含回答与思考 token，思考量同时作为输出的子集展示。

当挂载了 `ctx.authorization` 时，本插件提供键为 `llm-antigravity/default` 的一个 flow。同时挂载 `webServer` 的 Host 组合会在 `oauthRedirectPath` 上注册回调，并用授权 URL 通知用户。其他组合会请用户粘贴重定向后的 URL 或授权码。flow 提交 version-1 grant，含 `accessToken`、可选 `refreshToken` 与 `expiresAt`。过期 grant 在同一批进行中的请求里只刷新一次；无法刷新的 grant 会让后续请求以 `AUTH` 失败。

### 失败

抛出的 `LlmError` 代码：`AUTH`（401/403 或被拒绝的 grant）、`QUOTA`、`RATE_LIMIT`、`NETWORK`（传输失败与 HTTP 5xx）、`PROTOCOL`（畸形 SSE 或非预期 HTTP）、`MISSING_CREDENTIAL`、`INVALID_CREDENTIAL`、`ABORTED`、`TIMEOUT`、`EMPTY_RESPONSE`、`UNSUPPORTED_CONTENT`。image 与 file 块会被拒绝。`GenerateOptions.stop` 会转发为 `generationConfig.stopSequences`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

本插件是函数插件（`name` / `inject` / `Config` / `apply`，无 default export）。`apply` 在 `['antigravity']` 上注册适配器，发布一条可配置提供方目录条目，并在存在 authorization 时注入 PKCE flow。每次请求都会快照 Config、解析 Bearer token，先 POST `loadCodeAssist`（配置根为 daily 消费端主机时改打生产 Cloud Code），Assist 未返回 project 时会 onboard 一个 free-tier companion project，再在配置根上 POST `{origin}/v1internal:streamGenerateContent?alt=sse`，并把包装后的 SSE 翻译为 harness 分片。usage 在终止 finish 分片之前发出。

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件注册 |
| [`src/adapter.ts`](src/adapter.ts) | 鉴权解析、请求序列化、SSE 翻译 |
| [`src/catalog.ts`](src/catalog.ts) | Cloud Code `fetchAvailableModels` 列举 |
| [`src/config.ts`](src/config.ts) | Schema 与按请求快照 |
| [`src/oauth.ts`](src/oauth.ts) | PKCE 授权、回调、兑换、刷新 |
| [`src/errors.ts`](src/errors.ts) | HTTP 与传输分类 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [dsh-llm 服务](../llm/README.zh.md) — 本适配器注册到的提供方无关服务。
- [LLM 流式子系统](../../../docs/subsystems/llm-streaming.zh.md) — `StreamChunk` 协议与适配器约定。
- [Authorization seam](../../credentials/authorization/README.zh.md) — 本插件注册的 flow。
- [pi-ai 适配器](../llm-pi-ai/README.zh.md) — 多提供方 OpenAI 兼容对照实现。

-----

<a id="model-experience"></a>
## 模型体验

### Cloud Code 请求

#### What the model sees

所选模型收到由 `GenerateOptions.system` 与 `messages` 组装的 Gemini `contents`：system 与 developer 文本成为 `systemInstruction` 分片，user 文本成为 user contents，assistant 文本与工具调用成为带 `functionCall` 的 model 分片，工具结果成为 user 的 `functionResponse` 分片。连续相同角色的回合会合并。配置的 `tools` 成为 `functionDeclarations`。存在时会透传 temperature、`maxOutputTokens` 与 `stopSequences`。image 与 file 块不会进入协议。目录 id 如 `gemini-3-pro-high` 已编码 thinking；DSH 的 `reasoningEffort` 不会作为 `thinkingLevel` 发送。

#### Token effect

精确输入由提供方分词决定。除已序列化的对话与工具声明外，本适配器不添加额外的模型可见文本。

#### KV Cache effect

转换保持逻辑请求顺序。更改提供方、模型、system 文本、工具或历史内容会从该点重写前缀。凭据与目录成员资格不进入模型输入。

### Cloud Code 响应

#### What the model sees

SSE 的 `response.candidates[].content.parts` 成为 harness 的 reasoning、text 与 tool-call 分片。thought 分片成为 reasoning；`functionCall` 分片成为工具调用，其 `arguments` 为 JSON 字符串。usage 在终止 finish 分片之前发出。

#### Token effect

生成内容只有在 loop 记录之后才会影响后续输入。当提供方报告 `cachedContentTokenCount` 时，会从 `inputTokens` 中减去缓存的 prompt token。

#### KV Cache effect

已记录的响应内容追加到下一请求，不会使更早的可复用前缀失效。传输元数据与 usage 记账不影响缓存身份。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **显式 `models` 列表是配置元数据** — 它并不远程验证端点是否接受这些 id。`models` 为空时，列举会 POST Cloud Code 的 `loadCodeAssist`，再带上该 project POST `fetchAvailableModels`；Assist 未返回 project 时 POST `{}`；列举失败会直接可见，而不是回退到一份目录。辅助的 `chat_*` / `tab_*` id、Gemini 1.x/2.x id 与 `isInternal` 条目会被省略。Assist 未返回 companion project 时生成会失败。实际调用仍可能失败。
- **拒绝 image 与 file** — 本适配器在协议上只发送文本；请声明文本输入模态。
- **登录尝试只存在于发起它的进程** — 登录中途重新加载会放弃该次尝试。退出登录是对 `llm-antigravity/default` 执行 `deleteRecord`，不会吊销发行方 grant。
- **Host 回调需要 `webServer`** — 没有它的桌面组合会通过授权提示收集重定向 URL。

<a id="dev-note"></a>
### 开发备注

默认 OAuth client id 与 secret 是 CLIProxyAPI 使用的 Antigravity 已安装应用公开凭据。token 兑换会随 PKCE verifier 发送该 secret。注册了其他 client 的部署必须设置 `oauthClientId`、`oauthClientSecret` 与匹配的 redirect URI。
