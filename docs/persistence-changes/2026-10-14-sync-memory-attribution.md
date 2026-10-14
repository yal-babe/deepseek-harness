---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-14-sync-memory-attribution

English | [中文](2026-10-14-sync-memory-attribution.zh.md)

## Summary

Adds producer-owned sync-memory snapshot attribution.

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
    previous: "2026-10-05-working-directory-attribution"
    after: "227089ad663f1eb1bcebf70def82a808391a6a9ae54fc42e0044bb7e21989c94"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-05-working-directory-attribution"
    after: "3718350b3cad03d3f0cce09b85e0f744262d85e51f06c82b0e98300c0b0a459c"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-07-title-reasoning-effort"
    after: "4cc97c7b4b1f0e1c9396e2c73a2664b1fe12ead54ce975b9efe01ed20c101963"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-05-working-directory-attribution"
    after: "265f9d81ebad792342389e575e2502ce32db49baebbf661a42f0c07481864c8a"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing records remain valid. The additive sync-memory source kind is attribution only; the declared source policy preserves unknown attribution without interpreting it. The Session format remains unchanged.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/sync --coverage.enabled=false: 6 files and 69 tests passed.

<a id="dev-note"></a>
## Dev Note

None.
