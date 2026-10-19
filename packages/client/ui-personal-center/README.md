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

Web profiles mount this plugin. **Personal** in the sidebar (`sidebar.panellist` id `personal-center`, order 5) opens the same-id main panel. Opening the panel paints the last `localStorage` snapshot when one exists, then refreshes Host `usageStats` and `providerQuota`. A failed refresh keeps the cache and offers Retry. Clicking a recent session opens it in the workspace. Archived sessions and sessions with a known zero total do not appear in recents; unavailable consumption remains visible.

Desktop sidebar clicks report `sidebar_menu_click` with `menu_name` `personal`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser half registers the sidebar icon (`IconUserOutlineRegular`) and the main panel. The store caches `usageStats.snapshot` under `dsh.usage-stats.v2:<host>` without credentials. Live `tokenUsage` changes request a coalesced Host usage refresh only while the page or pet summary is visible, without querying provider balances. Visibility leases are independent and release on hiding or unmounting; reopening explicitly refreshes the snapshot. The browser does not move historical consumption into today's bucket. Totals preserve exact provider counts and label incomplete accounting; unavailable cache details are not displayed as zero. Model rows distinguish provider/model pairs. Quota summaries call the same `providerQuota` Remote as [ui-settings-account](../ui-settings-account/README.md). Explicit page refreshes also query DeepSeek name and balance.

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

The daily heatmap shows 53 weeks with blue intensity levels; cumulative mode preserves the daily calendar.

The activity calendar uses blue daily cells, month labels below the grid, and accessible date and token tooltips.

Dashboard sections share one border-box width. Usage lists separate names and numeric totals; recent-session rows expose a full-row action and adapt metadata at narrow widths.

The full-year activity grid shrinks with its container; Antigravity quotas retain their named groups.

The DeepSeek card separates recharge and gift wallets, shows gift expiry when supplied, and keeps unavailable balances distinct from empty gift wallets. Provider windows show their reset instant in Asia/Shanghai.

The optional `pet.panel.metrics` contribution reuses this page’s store for recorded Token totals, the focused Session, and DeepSeek wallets. It refreshes when the pet panel opens, when a visible task finishes or fails, and on manual refresh, without polling or a separate cumulative counter. The displayed scope excludes archived/deleted sessions and usage absent from provider responses; it is not lifetime account billing. When the user picks Check balance in the pet menu, the contribution refreshes the same data and reports one reading per DeepSeek CNY wallet, measured against the ¥20 reference the upstream pet uses (an overdraft counts as all used), plus the most used standard Codex quota window; USD wallets and unknown values report nothing.

The pet panel reuses this page’s wallet and quota-window components, including DeepSeek gift expiry, Codex remaining windows, and Antigravity model groups and reset times. Balance requests and live recorded-usage observation keep their existing owners.
