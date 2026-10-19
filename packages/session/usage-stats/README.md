---
description: "Host Remote that folds unarchived Session logs into local usage statistics for Personal Center."
kind: "package-reference"
---

# @deepseek-ai/dsh-usage-stats

English | [中文](README.zh.md)

## Summary

Host Remote that folds unarchived Session logs into local usage statistics for Personal Center. The snapshot contains token totals, session counts, tool names, model ids, and local-calendar day buckets. Archived workspace sessions are omitted. The snapshot contains no event bodies or credentials.

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

Base-backed Web profiles compose this service next to session-query. Personal Center calls `usageStats.snapshot(timezoneOffsetSeconds)` with seconds east of UTC. The Client caches the last snapshot in `localStorage`; changes to live `tokenUsage` request a coalesced Host refresh while a summary is visible instead of modifying calendar buckets in the browser. Opening a hidden summary explicitly refreshes it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`UsageStats` is a `TypertRemoteService` namespace `usageStats`. `snapshot` lists sessions through `sessionQuery`, excludes archived workspace ids, and uses token-meter's shared request accounting for message and failed-attempt settlements, including embedded stream usage. Final samples replace earlier samples within one attempt; retries contribute separate calls. Calls retain their settlement dates and provider/model attribution. Exact provider totals are preserved independently of cache details; missing or invalid usage marks totals incomplete, and missing cache buckets remain unknown. Global totals, model rows, and day buckets count original source positions once; inherited tool calls and activity are excluded from child contributions. Per-Session rows include the full inherited prefix, matching chat consumption, so those rows must not be summed to reconstruct the global total. Recents omit known zero-total sessions but retain unavailable usage; `sessionCount` counts every unarchived session. Session observations reuse session-query's bounded, revision-checked preparation cache; each observation lease is released before the next read.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-personal-center](../../client/ui-personal-center/README.md) — sidebar panel that caches and displays this snapshot.
- [session-query](../../session-query/session-query/README.md) — session listing and log reads.
- [workspace](../../workspace/workspace/README.md) — archived session ids.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package exposes no model-facing tools or prompts.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Usage stays on this device** — the snapshot is folded from local Session logs; it is not uploaded.
- **Archived sessions are excluded** — restoring an archived session makes it eligible on the next snapshot.

<a id="dev-note"></a>
### Dev Note

None.
