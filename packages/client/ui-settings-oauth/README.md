---
description: "Codex and Antigravity sign-in controls on Models provider cards. The plugin registers into the llm-pi-ai and llm-antigravity provider-card seats and talks to the oauth Remote namespace."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-oauth

English | [中文](README.zh.md)

## Summary

Codex and Antigravity sign-in controls on Models provider cards. The plugin registers into the llm-pi-ai and llm-antigravity provider-card seats and talks to the oauth Remote namespace.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

The plugin injects `settings.models.provider-card` with keys `llm-pi-ai` and `llm-antigravity`. The `openai-codex` and `antigravity` rows render Sign in, Cancel, Sign out, status, and an Open sign-in page action. Each card watches `oauth/watch` for its credential (`llm-pi-ai/openai-codex` or `llm-antigravity/default`). A waiting-browser URL is opened in a new browsing context; Desktop's `dsh-app:` origin still counts as opened when Electron denies `window.open` and hands the URL to the system browser. A blocked popup keeps Open sign-in page available only while waiting-browser. Cancel stays available while Sign in is in flight. Codex's browser-vs-device picker is answered as browser. A paste prompt that still carries an authorize URL keeps Cancel and Open sign-in page instead of a Continue field. Host command failures stay visible on the card.

<a id="understand-the-implementation"></a>
## Understand the implementation

The Host OAuth bridge owns attempt lifecycle. This package is presentation: it publishes the streamed view through an inject hook and never holds `ctx` in the component.

<a id="further-exploration"></a>
## Further Exploration

The [Models settings](../ui-settings-models/README.md) package declares the provider-card seat. The [oauth controller](../../api/oauth-controller/README.md) owns the Remote namespace.

<a id="model-experience"></a>
## Model Experience

None, as Codex and Antigravity sign-in are configuration-time conversations and no OAuth state enters a model request.

#### KV Cache effect

No model request prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Only the shipped `openai-codex` and Antigravity account rows are wired. Other llm-pi-ai OAuth providers do not render these controls. A Host restart abandons an in-flight attempt.

<a id="dev-note"></a>
### Dev Note

None.

Account controls align status and authentication actions in a responsive row.

Stored OAuth credentials display a green status indicator and an outlined sign-out button; sign-in progress and errors remain visible.

The provider name and status dot share an identity group opposite the authentication action.
