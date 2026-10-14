---
description: "Host service that runs ctx.authorization attempts for a UI. One attempt per credential key; notices and prompts are buffered into a safe view."
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-oauth-bridge

English | [中文](README.zh.md)

## Summary

Host service that runs `ctx.authorization` attempts for a UI. One attempt per credential key; notices and prompts are buffered into a safe view.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

`ctx.oauthBridge` starts, cancels, and signs out authorization for a credential key parsed by `parseCredentialKey`. `start` returns the current view when an attempt is already running. A new start waits until the flow has prompted, published an authorize URL, or settled, so the first snapshot is the picker or the authorize URL rather than a blank in-flight idle. Notices without a URL leave status idle and do not complete that wait. `watch` emits an initial snapshot and subsequent snapshots; disconnecting stops observation, not the attempt. A notice that carries a URL sets `waiting-browser` and `authorizeUrl`. A prompt sets `prompting` until `answerPrompt` or `declinePrompt`. Settlement reports `authorized`, `cancelled`, or `failed` and drops `authorizeUrl`. `credentialConfigured` follows the stored record.

The [oauth controller](../../api/oauth-controller/README.md) exposes these operations over Remote.

<a id="understand-the-implementation"></a>
## Understand the implementation

The bridge supplies the authorization interaction for each attempt it starts and does not own the protocol. Flows remain registered by the plugin that writes the credential, such as `llm-pi-ai` for `openai-codex`.

<a id="further-exploration"></a>
## Further Exploration

The [authorization](../../credentials/authorization/README.md) seam owns flow registration and commit confirmation. The [credentials subsystem](../../../docs/subsystems/credentials.md) owns record storage.

<a id="model-experience"></a>
## Model Experience

None, as OAuth credentials affect HTTP authentication and never enter model prompts, Session logs, or tool results.

#### KV Cache effect

No model request prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- An attempt lives in the process that started it, so a UI reload or Host exit abandons it and the human starts over. Sign-out deletes the local record and does not revoke the grant at the issuer.

<a id="dev-note"></a>
### Dev Note

None.
