---
description: "Built-in Studio Pet Host module: folds live Session events into one pet snapshot served on the pet Remote."
kind: "package-reference"
---

# @deepseek-ai/dsh-pet

English | [中文](README.zh.md)

## Summary

Built-in Studio Pet Host module: folds live Session events into one pet snapshot served on the `pet` Remote. The snapshot carries one aggregated character state, a per-Session view, pending approvals, running jobs, and the "show desktop pet" flag. It carries no message bodies, tool arguments, or credentials. The module never answers approvals; Clients answer them through the existing approval flow.

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

The web-app bundle mounts this service in the Web and Desktop profiles next to the [ui-pet](../../client/ui-pet/README.md) Client plugin. Clients call `pet.watch()` for a stream of complete `PetSnapshot` frames and `pet.getSnapshot()` for one read. `pet.setVisible(boolean)` toggles every pet surface without stopping the fold. `pet.pin(sessionId | null)` chooses the Session the bubble follows. `pet.acknowledge(sessionId)` ends a `SUCCESS` or `ERROR` hold once the user saw the result. All methods are owner-only under the default remote-access policy.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`PetService` is a `TypertRemoteService` registered at the Host root, so its `session/event` and `session/disposed` listeners see every Session. `PetReducer` is a pure incremental fold:

- `turn/start` sets `THINKING`; `tool/call` sets `WORKING` with an activity classified from the tool name; `tool/result` returns to `THINKING` once no tool is open.
- `turn/end` maps `completed` and `max-tokens` to `SUCCESS`, `error` to `ERROR`, and every other reason to `IDLE`. Results hold for `successHoldMs` / `errorHoldMs`; a timer re-emits when a hold ends.
- `approval/asked` and `approval/decided` (audit events written by user-approval) track pending approvals, including those of subagent Sessions that are otherwise untracked. Any pending approval makes the character `WAITING`.
- `todo/write` gives progress, `session/title` gives the title, and `job/registered` / `job/settled` list running jobs.

Character priority is `WAITING > ERROR > SUCCESS > WORKING > THINKING > IDLE`. A pinned Session wins focus unless `waitingPreempts` lets a `WAITING` Session take it. `watch()` coalesces changes inside `snapshotDebounceMs`. A fold failure is logged and never reaches the Session append path.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-pet](../../client/ui-pet/README.md) — in-page character and the Desktop pet window.
- [user-approval](../../interaction/user-approval/README.md) — the approval waterfall and its audit events.
- [Studio Pet design notes](../../../.agents/notes/proposed/feature/2026-10-17-studio-pet-phase0-findings.md) — Phase 0 findings.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package exposes no model-facing tools or prompts.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Phase 0 scope** — `TALKING`, compaction and retry states, and persisted settings are not implemented; `visible` resets to the configured value when the Host restarts.
- **No Host-side approval decision** — deciding from the Host would need user-approval to cancel forwarded Client requests; Clients answer instead.

<a id="dev-note"></a>
### Dev Note

None.
