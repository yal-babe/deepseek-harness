---
description: "Session-header cloud-sync status chip for pending, syncing, synced, and failed outbox rows."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sync

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-sync` shows local cloud-sync status in the session header utilities band. The chip always renders one of pending, syncing, synced, or failed. The browser half owns the slot; the node half is a Loader no-op.

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

Load the plugin through the web-app manifest. The default snapshot is `synced` with zero pending and failed counts until a Host transporter writes live status.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

One slot entry `sync-status` on `conversation.session.header.utilities` renders `SyncStatusChip`. Copy lives in the `sync-status` locale namespace. Tests inject snapshots; the shipped store starts at `EMPTY_SYNC_STATUS`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`dsh-sync-outbox`](../sync-outbox/README.md) — the Host queue whose status this chip is meant to display.
- [Cloud sync subsystem](../../../docs/subsystems/sync.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as this package renders outbox status for a human and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **Live Host status is not wired** — the chip shows the injected snapshot, which defaults to `synced` until a Host→Client remote exists.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
