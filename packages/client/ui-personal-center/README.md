---
description: "Sidebar Personal Center: local usage statistics and Codex/Antigravity quota summaries."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-personal-center

English | [中文](README.zh.md)

Desktop product events use the optional [product analytics service](../product-analytics/README.md); ordinary Web interactions are excluded.

## Summary

Sidebar Personal Center: local usage statistics and Codex/Antigravity quota summaries. The entry sits under Plugins. The panel shows DeepSeek balance, token KPIs by method, remaining Codex and Antigravity windows (not subscription names), a 26-week token heatmap, per-model and per-tool totals, and recent unarchived sessions that recorded tokens.

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

Web profiles mount this plugin. **Personal** in the sidebar (`sidebar.panellist` id `personal-center`, order 5) opens the same-id main panel. Opening the panel paints the last `localStorage` snapshot when one exists, then refreshes Host `usageStats` and `providerQuota`. A failed refresh keeps the cache and offers Retry. Clicking a recent session opens it in the workspace. Archived sessions and sessions with zero tokens never appear in recents.

Desktop sidebar clicks report `sidebar_menu_click` with `menu_name` `personal`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser half registers the sidebar icon (`IconUserOutlineRegular`) and the main panel. The store caches `usageStats.snapshot` under `dsh.usage-stats.v1:<host>` (no tokens or credentials) and merges the open session's `tokenUsage` projection. Quota summaries call the same `providerQuota` Remote as [ui-settings-account](../ui-settings-account/README.md). DeepSeek name and balance come from the account Remote on the same refresh.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [usage-stats](../../session/usage-stats/README.md) — Host fold of unarchived logs.
- [provider-quota](../../api/provider-quota/README.md) — Codex and Antigravity quota views.
- [ui-settings-account](../ui-settings-account/README.md) — Settings three-card quota page.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package exposes no model-facing tools or prompts.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Usage is not uploaded** — the heatmap and KPIs are local Session folds plus a browser cache.
- **Heatmap cells use ink/surface tokens** — they are intensity squares, not a GitHub contribution graph.

<a id="dev-note"></a>
### Dev Note

None.
