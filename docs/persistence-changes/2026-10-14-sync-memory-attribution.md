---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-14-sync-memory-attribution

English | [中文](2026-10-14-sync-memory-attribution.zh.md)

## Summary

Adds producer-owned sync-memory snapshot attribution after the upstream user-rpc principal change.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-14-sync-memory-attribution
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-user-rpc-principal"
    after: "70d75ead14ac748fff324f7ef4cc9fc872b1cbc7c5cb304a73b7ed6dba2adf0e"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "5a5ba0a24d3ad04dcd597de7889a71153754309cd12a9a022a41ca3ad235fcdf"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-user-rpc-principal"
    after: "2c7304a5a6b8acb1204b166ed461e493963ab3036738ec39a019cc47726bbc49"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "f7dec4f39819f874c7c6ea41bce88f78750bbeb0b499666b1e8e1f29746bb635"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing records remain valid. The additive sync-memory source kind is attribution only; the declared source policy preserves unknown attribution without interpreting it. The Session format remains unchanged.

<a id="verification"></a>
## Verification

`pnpm exec vitest run scripts/doc-standard.spec.ts packages/sync`: 7 files and 98 tests passed. `pnpm exec tsx scripts/persistence-changes.ts --check`: all 65 roots match the acknowledgement history.

<a id="dev-note"></a>
## Dev Note

None.
