---
description: "OAuth screens use authenticated Remote commands and a snapshot stream. The controller exposes attempt state without returning tokens."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-oauth-controller

English | [中文](README.zh.md)

## Summary

OAuth screens use authenticated Remote commands and a snapshot stream. The controller exposes attempt state without returning tokens.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

The `oauth` namespace exposes getState, start, cancel, signOut, answerPrompt, declinePrompt, and watch. Each method names the credential key as `<scope>/<id>`. watch emits an initial complete state and subsequent complete states; disconnecting stops observation, not the attempt. Invalid keys, a missing prompt, and authorization-flow refusals arrive as `oauth/rejected`.

The [OAuth bridge](../../llm/llm-oauth-bridge/README.md) owns attempt lifecycle.

<a id="understand-the-implementation"></a>
## Understand the implementation

The controller forwards operations to `ctx.oauthBridge` and maintains no independent OAuth state.

<a id="further-exploration"></a>
## Further Exploration

The [cookbook for adding a Remote API](../../../docs/cookbook/adding-a-remote-api.md) records declaration, failure codes, and Client consumption.

<a id="model-experience"></a>
## Model Experience

None, as OAuth credentials affect HTTP authentication and never enter model prompts, Session logs, or tool results.

#### KV Cache effect

No model request prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A disconnected UI can recover OAuth state through watch, but cannot resume an attempt after the Host exits. Credential values are not Remote operations.
