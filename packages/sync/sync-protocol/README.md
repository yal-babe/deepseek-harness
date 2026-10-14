---
description: "Shared Studio cloud-sync types and pure helpers: branded ids, batch validation, and secret redaction."
kind: "package-reference"
---

# @deepseek-ai/dsh-sync-protocol

English | [中文](README.zh.md)

## Summary

`dsh-sync-protocol` is the Cordis-free library for Studio cloud sync. Callers brand `StudioProjectId`, `DeviceId`, `SyncBatchId`, and `MemoryId`, validate `SyncBatch` payloads, and redact secrets before enqueue or HTTP commit. It owns no plugin, queue, or HTTP listener.

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

Import constructors and helpers from `@deepseek-ai/dsh-sync-protocol`. Identifiers must match `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`. `validateBatch` rejects empty batches, oversized batches (default cap 100), invalid ids, and decreasing `seq` values; equal consecutive `seq` values are allowed. `redactSecrets` / `redactJsonValue` replace `sk-` tokens, `Bearer` credentials, `api_key` / `secret` / `token` / `password` fields, and PEM blocks with `[REDACTED]`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

| File | Role |
|---|---|
| [`src/types.ts`](src/types.ts) | Batch, envelope, lease, memory, and status types |
| [`src/ids.ts`](src/ids.ts) | Brand constructors and identifier grammar |
| [`src/validate.ts`](src/validate.ts) | `validateBatch` |
| [`src/redact.ts`](src/redact.ts) | Secret substitution |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Cloud sync subsystem](../../../docs/subsystems/sync.md) — the same types with source-equivalent fences.
- [sync group map](../README.md) — outbox, server, and memory consumers.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package only brands identifiers, validates batches, and redacts strings; consumers own every model-visible use of the redacted values.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Redaction is pattern-based** — values that do not match the listed secret forms remain in the payload; callers must not treat redaction as a confidentiality proof.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
