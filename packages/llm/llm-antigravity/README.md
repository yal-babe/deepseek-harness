---
description: "Antigravity Cloud Code adapter with PKCE browser sign-in and an API-key fallback."
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-antigravity

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-llm-antigravity` sends model requests to Cloud Code `v1internal:streamGenerateContent` as the `antigravity` provider. Sign in through a PKCE browser flow that stores a grant at `llm-antigravity/default`, or supply an API key through `apiKeyEnv`. Streams emit usage before finish and keep tool-call arguments as raw JSON strings. Choose this adapter when the composition must talk to Antigravity Cloud Code; choose `dsh-llm-pi-ai` for OpenAI-compatible catalogs.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin beside `dsh-llm`. The adapter registers immediately. `listModels('antigravity')` returns an empty list until a stored PKCE grant or `apiKeyEnv` credential is present. After sign-in, an empty `models` list (the default) POSTs Cloud Code `v1internal:loadCodeAssist` then `v1internal:fetchAvailableModels` with that companion project, and advertises the returned catalog; a non-empty `models` list replaces that listing. A stored PKCE grant authenticates first; otherwise `apiKeyEnv` resolves through the credentials service or the launch environment.

```yaml
- id: llm-antigravity
  name: '@deepseek-ai/dsh-llm-antigravity'
  config:
    baseURL: https://daily-cloudcode-pa.googleapis.com/v1
    apiKeyEnv: ANTIGRAVITY_API_KEY
```

| Field | Default | Meaning |
|---|---|---|
| `baseURL` | `https://daily-cloudcode-pa.googleapis.com/v1` | Cloud Code root for listing and generate |
| `oauthAuthorizeURL` | Google OAuth authorize endpoint | Browser authorization URL |
| `oauthTokenURL` | Google OAuth token endpoint | Authorization-code exchange and refresh |
| `oauthClientId` | Antigravity public client id | Client id sent on authorize and token requests |
| `oauthClientSecret` | published installed-app secret | Token-request secret; empty omits `client_secret` |
| `oauthRedirectPath` | `/oauth/antigravity/callback` | Host callback pathname when `webServer` is mounted |
| `apiKeyEnv` | `ANTIGRAVITY_API_KEY` | Credential reference used when no grant is stored |
| `models` | empty | Advisory catalog; empty fetches Cloud Code after sign-in |
| `requestTimeoutMs` | `30000` | Deadline for non-generation HTTP requests, including token exchange and catalog requests |
| `generationTimeoutMs` | `600000` | Total deadline for one generation, including setup and streamed output; independent of `requestTimeoutMs` |
| `streamIdleTimeoutMs` | `300000` | Maximum idle interval while one stream read is outstanding; provider activity rearms this timer but not the generation deadline |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-llm-antigravity) is the exhaustive source for every accepted field.

### Sign in

Model catalogs are cached per endpoint and credential. Cold loads coalesce; warm reads return immediately and refresh in the background after `catalogMaxAgeMs` (300000 ms by default). Failed background refreshes retain the last listing and retry after that interval. Sign-out clears the cache on the next read; plugin disposal aborts outstanding catalog work. Output usage includes candidate and thought tokens, with thoughts also disclosed as an output subset.

Host quota helpers POST `retrieveUserQuotaSummary` with the Management Center URL fallback and map `loadCodeAssist` `paidTier` then `currentTier`. [provider-quota](../../api/provider-quota/README.md) exposes those snapshots; Antigravity has no reset cards.

When `ctx.authorization` is mounted, the plugin offers one flow keyed `llm-antigravity/default`. A Host composition that also mounts `webServer` registers the callback on `oauthRedirectPath` and notifies the human with the authorize URL. Other compositions ask the human to paste the redirected URL or the authorization code. The flow commits a version-1 grant with `accessToken`, optional `refreshToken`, and `expiresAt`. An expired grant refreshes once per in-flight batch; a grant that cannot refresh fails the next request with `AUTH`.

### Failures

Thrown `LlmError` codes: `AUTH` (401/403 or a rejected grant), `QUOTA`, `RATE_LIMIT`, `NETWORK` (transport and HTTP 5xx), `PROTOCOL` (malformed SSE or unexpected HTTP), `MISSING_CREDENTIAL`, `INVALID_CREDENTIAL`, `ABORTED`, `TIMEOUT`, `EMPTY_RESPONSE`, `UNSUPPORTED_CONTENT`. Image and file blocks are refused. `GenerateOptions.stop` is forwarded as `generationConfig.stopSequences`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin is a function plugin (`name` / `inject` / `Config` / `apply`, no default export). `apply` registers the adapter on `['antigravity']`, publishes one configurable-provider directory entry, and injects the PKCE flow when authorization exists. Each request snapshots Config, resolves a Bearer token, POSTs `loadCodeAssist` (production Cloud Code when the configured root is the daily consumer host), onboards a free-tier companion project when Assist omits one, then POSTs `{origin}/v1internal:streamGenerateContent?alt=sse` on the configured root, and translates wrapped SSE into harness chunks. Usage is emitted before the terminal finish chunk.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin registration |
| [`src/adapter.ts`](src/adapter.ts) | Auth resolution, request serialization, SSE translation |
| [`src/catalog.ts`](src/catalog.ts) | Cloud Code `fetchAvailableModels` listing |
| [`src/config.ts`](src/config.ts) | Schema and per-request snapshot |
| [`src/oauth.ts`](src/oauth.ts) | PKCE authorize, callback, exchange, refresh |
| [`src/errors.ts`](src/errors.ts) | HTTP and transport classification |
| [`src/quota.ts`](src/quota.ts) | Cloud Code quota summary and `loadCodeAssist` tier mapping |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-llm service](../llm/README.md) — the provider-neutral service this adapter registers on.
- [LLM streaming subsystem](../../../docs/subsystems/llm-streaming.md) — the `StreamChunk` protocol and adapter contract.
- [Authorization seam](../../credentials/authorization/README.md) — the flow this plugin registers.
- [pi-ai adapter](../llm-pi-ai/README.md) — the multi-provider OpenAI-compatible twin.

-----

<a id="model-experience"></a>
## Model Experience

### Cloud Code request

#### What the model sees

The selected model receives Gemini `contents` built from `GenerateOptions.system` and `messages`: system and developer text become `systemInstruction` parts, user text becomes user contents, assistant text and tool calls become model parts with `functionCall`, and tool results become user `functionResponse` parts. Consecutive same-role turns merge. Configured `tools` become `functionDeclarations`. Temperature, `maxOutputTokens`, and `stopSequences` pass through when present. Image and file blocks never reach the wire. Catalog ids such as `gemini-3-pro-high` already encode thinking; DSH `reasoningEffort` is not sent as `thinkingLevel`.

#### Token effect

Provider tokenization governs exact input. This adapter adds no extra model-visible text beyond the serialized conversation and tool declarations.

#### KV Cache effect

Conversion preserves logical request order. Changing provider, model, system text, tools, or historical content rewrites the prefix from that point. Credentials and catalog membership do not enter model input.

### Cloud Code response

#### What the model sees

SSE `response.candidates[].content.parts` become harness reasoning, text, and tool-call chunks. Thought parts become reasoning; `functionCall` parts become tool-call chunks whose `arguments` are JSON strings. Tool-call `thoughtSignature` values are retained in block-aligned replay metadata and restored verbatim for history from the same Antigravity model, including after session persistence. Signatures are not reused across models; historical calls recorded without signatures cannot have them reconstructed and may require a new conversation. Usage is emitted before the terminal finish chunk.

#### Token effect

Generated content affects later inputs only after the loop records it. Cached prompt tokens are subtracted from `inputTokens` when the provider reports `cachedContentTokenCount`.

#### KV Cache effect

Recorded response content appends to the next request and does not invalidate its earlier reusable prefix. Transport metadata and usage accounting do not affect cache identity.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **An explicit `models` list is configuration metadata** — it is not remote validation that the endpoint accepts those ids. When `models` is empty, listing POSTs Cloud Code `loadCodeAssist` then `fetchAvailableModels` with that project, or `{}` when Assist omits one; a listing failure is visible rather than a fallback catalog. Auxiliary `chat_*` / `tab_*` ids, Gemini 1.x/2.x ids, and `isInternal` entries are omitted. Generate fails when Assist returns no companion project. Actual calls can still fail.
- **Images and files are refused** — the adapter is text-only on the wire; declare text input modalities.
- **A sign-in lives only in the process that started it** — reloading mid-login abandons the attempt. Signing out is `deleteRecord` on `llm-antigravity/default` and does not revoke the issuer grant.
- **Host callback requires `webServer`** — desktop compositions without it collect the redirected URL through an authorization prompt.

<a id="dev-note"></a>
### Dev Note

The default OAuth client id and secret are the public Antigravity installed-app credentials used by CLIProxyAPI. Token exchange sends that secret with the PKCE verifier. Deployments that registered a different client must set `oauthClientId`, `oauthClientSecret`, and matching redirect URIs.

The package exports credential-backed model discovery for account model lists.
