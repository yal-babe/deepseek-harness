---
description: "Plugin marketplace settings section: Hub-style categories, search, sort, installed list, and custom install, plus a Codex source."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-plugin-marketplace

English | [中文](README.zh.md)

## Summary

Open **Plugin marketplace** in Settings for Hub-style browse (categories, search, Star/Fork/updated sort, installed list, custom install) over the community catalog, plus a Codex source. The sidebar **Plugins** page is unchanged.

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

Web compositions that mount [plugin-catalog](../../boot/plugin-catalog/README.md) and this client package show the section next to **Built-in plugins**. Host search pages the community and Codex feeds with Hub categories and sort. Community DSH bundles install through plugin-manager; Codex skills materialize under `$DSH_HOME/skills`. Compatibility badges always show; unsupported entries keep Install disabled. Feed failures show a retryable error instead of an empty list.

Each installation keeps its own disabled Install button with a spinner and Host-reported stage percentage; other plugins remain installable concurrently. Codex file completion contributes to progress, and successful installation reaches 100%. Installed rows expose enable/disable and uninstall actions without separate activation-status badges. Shared profile writes remain coordinated by plugin-manager. Outcome toasts survive closing Settings.

Community activation uses the same plugin-manager operation and inventory as the built-in Plugins page, and follows management changes. Switch between card and list layouts; action rows share a bottom alignment. Details render Markdown in a wider, scrollable dialog.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package registers `settings.section` id `marketplace` (order 16). The browser half owns dictionaries under `settings.marketplace` and a `MarketplaceStore` that calls `remote.pluginCatalog` (and `remote.pluginManager` for custom specs). Toasts report install outcomes and restart requirements; there is no notification center.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [plugin-catalog](../../boot/plugin-catalog/README.md) — Host catalog Remote.
- [ui-settings-plugins](../ui-settings-plugins/README.md) — Built-in plugins section (unchanged).
- [ui-plugin-manager](../ui-plugin-manager/README.md) — sidebar Plugins page (unchanged).

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Codex MCP and hooks are not one-click installed** — the detail page documents the gap; operators configure those surfaces separately.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
