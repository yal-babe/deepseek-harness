---
description: "Host Remote that reads Codex and Antigravity quota with stored OAuth grants and returns browser-safe views."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-provider-quota

English | [中文](README.zh.md)

## Summary

Host Remote that reads Codex and Antigravity quota with stored OAuth grants and returns browser-safe views. Tokens never ride this Remote. The namespace is `providerQuota` so `get` does not collide with Gateway reserved verbs.

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

Base-backed Web profiles compose this service next to credentials and the Codex / Antigravity adapters. Account settings and Personal Center call `providerQuota.get('codex' | 'antigravity')` and `providerQuota.consumeCodexReset()`. Unsigned cards mean no stored grant; failed cards stay retryable. Redeeming a Codex reset credit requires a Client confirmation first. This Remote does not call CLI Proxy `resetCooldown`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`ProviderQuota` is a `TypertRemoteService` namespace `providerQuota`. Codex uses the stored `llm-pi-ai/openai-codex` oauth grant against ChatGPT WHAM usage, subscriptions, the Codex models catalog, and rate-limit reset credits. Antigravity uses `resolveAccessToken` plus `loadCloudCodeProject`, then `retrieveUserQuotaSummary` with the Management Center URL fallback and `loadCodeAssist` for the paid tier. Views omit tokens and grant payloads.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-settings-account](../../client/ui-settings-account/README.md) — three quota cards in Settings.
- [ui-personal-center](../../client/ui-personal-center/README.md) — sidebar summary of the same views.
- [llm-pi-ai](../../llm/llm-pi-ai/README.md) — Codex WHAM parse and fetch.
- [llm-antigravity](../../llm/llm-antigravity/README.md) — Cloud Code quota summary.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package exposes no model-facing tools or prompts.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Antigravity has no reset credits** — Cloud Code does not expose a redeemable reset card, so the Antigravity card has no reset action.
- **DSH Studio accounts are not a quota source** — Codex and Antigravity quota still require those providers' stored grants.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Field mapping follows CLI Proxy Management Center `fetchCodexQuota` / `fetchAntigravityQuota`. Reset-card expiry in the UI is Asia/Shanghai without a timezone suffix.

</details>

Model catalogs expose loading failures separately from empty results for Codex and Antigravity.

Expired Codex grants refresh through the adapter credential store before quota requests. Model discovery failures retain an explicitly labeled installed adapter catalog.

When subscription lookup cannot provide an expiry, Codex reads identity claims from a credential-store-locked refresh without discarding quota or model results.
