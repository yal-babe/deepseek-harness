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

Base-backed Web profiles compose this service next to session-query. Personal Center calls `usageStats.snapshot(timezoneOffsetSeconds)` with seconds east of UTC. The Client may cache the last snapshot in `localStorage` and merge the open session's live `tokenUsage` projection; the Host snapshot remains the authority for unarchived history.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`UsageStats` is a `TypertRemoteService` namespace `usageStats`. `snapshot` lists sessions through `sessionQuery`, skips ids in `workspaceRegistry.archivedSessionIds` when that service exists, and folds `assistant/message` usage, `tool/call` names, and `request/context` model ids into day buckets in the Client-supplied offset. Recents omit sessions whose folded token total is zero; `sessionCount` still counts every unarchived session.

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
