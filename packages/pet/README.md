---
description: "The pet group map: the built-in Studio Pet Host module."
kind: "package-group"
---

# pet/ — Studio Pet

English | [中文](README.zh.md)

## Summary

The pet group holds the built-in Studio Pet. The Host module folds live Session events into one pet snapshot. The [ui-pet](../client/ui-pet/README.md) Client plugin renders it in the page and in the Desktop pet window.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`pet`](pet/README.md) | Host fold of Session events into the pet snapshot; `pet` Remote | `ctx.pet` |

The web-app bundle mounts `pet` and `ui-pet` in the Web and Desktop profiles.

-----

<a id="related-documentation"></a>
## Related documentation

- [Phase 0 findings](../../.agents/notes/proposed/feature/2026-10-17-studio-pet-phase0-findings.md) — validated assumptions and open questions.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
