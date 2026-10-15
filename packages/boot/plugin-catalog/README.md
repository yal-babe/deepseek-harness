---
description: "Aggregated plugin marketplace catalog for Settings: community (dsh-plugin.org) and Codex (openai/plugins) feeds with Host-side search and install dispatch."
kind: "package-reference"
---

# @deepseek-ai/dsh-plugin-catalog

English | [中文](README.zh.md)

## Summary

Host Remote that downloads and caches the community plugin directory and the Codex marketplace feed, pages search results for the Settings marketplace UI, and dispatches installs: community DSH bundles through [plugin-manager](../plugin-manager/README.md), Codex skills into `$DSH_HOME/skills`.

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

Base-backed Web profiles compose this service next to `plugin-manager`. The Settings **Plugin marketplace** page ([ui-settings-plugin-marketplace](../../client/ui-settings-plugin-marketplace/README.md)) calls `pluginCatalog.search` / `get` / `installEntry` / `uninstall` / `setEnabled` with Hub category, sort, and installed-only filters plus a Codex source. Feed URLs and cache lifetime are Config fields (`communityOrigin`, `communityLocale`, `codexMarketplaceUrl`, `cacheTtlMs`, `fetchTimeoutMs`). A failed or invalid feed throws `plugin-catalog/feed-failed`; the UI must show a retryable error rather than an empty list.

Community entries with a parseable install spec are `compatibility: full` and install through `pluginManager.inspect` + `installBundle`. Codex entries that expose skills are `partial` (skills materialize under `$DSH_HOME/skills/codex-<name>`); MCP/hooks-only surfaces are `unsupported` or documented as partial gaps in the detail notes.

Installed community bundles use plugin-manager activation. Disabled Codex skills remain under `$DSH_HOME/disabled-skills` outside discovery roots; enabling restores them under `$DSH_HOME/skills`. Updates preserve their activation state, and uninstall removes active and disabled files.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`PluginCatalog` is a `TypertRemoteService` namespace `pluginCatalog`. Community rows come from `GET {communityOrigin}/plugins.{locale}.json` (compact Hub wire fields). Codex rows come from the openai/plugins `marketplace.json`, with detail enrichment from each plugin's `.codex-plugin/plugin.json` and GitHub Contents listing of the skills directory. Search filters and paginates on the Host so the browser never receives the full ~14k community dump. Install dispatch never deletes unrelated credentials; community uninstall uses `removeBundle`, Codex uninstall removes only the materialised skills directory.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-settings-plugin-marketplace](../../client/ui-settings-plugin-marketplace/README.md) — Settings section UI.
- [plugin-manager](../plugin-manager/README.md) — community bundle install.
- [dsh-skill](../../skill/skill/README.md) — skill loading from `$DSH_HOME/skills`.
- [hooks-codex](../../experimental/hooks-codex/README.md) — Codex hooks adapter (not one-click installed).

-----

<a id="model-experience"></a>
## Model Experience

None, as this package exposes no model-facing tools or prompts.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Codex MCP servers and hooks are not one-click installed** — the catalog records them for compatibility badges; operators configure `dsh-mcp-client` / `dsh-hooks-codex` separately.
- **Community API shape is pinned to the Hub compact JSON** — a feed redesign fails loud until parsers are updated.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Community contract: `https://api.dsh-plugin.org/plugins.{en|zh}.json`. Codex contract: `https://raw.githubusercontent.com/openai/plugins/main/.agents/plugins/marketplace.json` plus per-plugin `plugin.json`.

</details>
