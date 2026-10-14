---
description: "Local durable cloud-sync queue: redact, enqueue, retry HTTP delivery, and expose pending/syncing/synced/failed status."
kind: "package-reference"
---

# @deepseek-ai/dsh-sync-outbox

English | [中文](README.zh.md)

## Summary

`dsh-sync-outbox` is `ctx.syncOutbox`: a JSON queue that redacts secrets, validates batches, and retries `POST /v1/batches`. Status is `pending`, `syncing`, `synced`, or `failed`. An empty `serverUrl` stores locally without HTTP. Session-log capture is optional and needs `projectId` and `deviceId`.

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

Mount the plugin and call `enqueue`. Duplicate batch ids return the stored row. `status()` reports counts; an empty queue is `synced`. `retryFailed()` requeues exhausted rows. `drain()` runs delivery until no pending row remains or the service is disposed.

```yaml
- name: '@deepseek-ai/dsh-sync-outbox'
  config:
    serverUrl: https://sync.example
    deviceCredentialEnv: STUDIO_DEVICE_CREDENTIAL
    maxBatchEvents: 100
    retryBaseMs: 1000
```

| Field | Default | Meaning |
|---|---|---|
| `serverUrl` | `""` | Sync origin; empty queues locally |
| `deviceCredentialEnv` | `STUDIO_DEVICE_CREDENTIAL` | Bearer credential environment variable |
| `maxBatchEvents` | `100` | Inclusive envelope cap |
| `retryBaseMs` | `1000` | Base backoff; doubled after each failure |
| `queuePath` | `$DSH_HOME/sync-outbox.json` | Durable JSON queue |
| `projectId` | omitted | Default project for enqueue and session capture |
| `deviceId` | omitted | Default device for enqueue and session capture |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-sync-outbox) is the exhaustive source for every accepted field.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Delivery treats HTTP 200 and 409 as success. Eight failed attempts leave a row `failed`. The queue file uses mode `0o600`. A corrupt document fails plugin load.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Cloud sync subsystem](../../../docs/subsystems/sync.md)
- [`dsh-sync-protocol`](../sync-protocol/README.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as this package queues already-redacted events for HTTP delivery and does not add model context, tools, or session events of its own.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No Host-to-Client remote** — the header chip cannot read live outbox status until a later transporter exists.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
