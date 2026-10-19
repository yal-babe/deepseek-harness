---
kind: upgrade-guide
description: "Studio conversation exports carry version-two usage source ranges that older Studio clients cannot read."
---

# Studio conversation usage attribution

English | [中文](guide.zh.md)

## Change

Studio exports selected conversations as `dsh-session-2`, adding original Session source ranges for Token accounting across devices and forks. Older Studio clients reject these payloads. Updated clients still read `dsh-session-1`; unavailable ancestry is labeled incomplete instead of deduplicating unrelated calls by content. Official Harness Session logs and Agent execution are unchanged.

Personal Center groups models by provider and model, preserves authoritative totals independently of cache details, and rebuilds its browser usage cache. Existing model-row API consumers must read `provider` alongside `model`. Cloud activity responses add cache-write totals and optional missing-data flags; these are recorded usage, not provider invoices. Per-Session rows retain inherited consumption to match chat; global totals deduplicate inherited requests, so displayed Session rows are not additive.

## Migration

1. Update every Studio device before exporting newly synchronized conversations. No cloud server database migration is required for this payload change.
2. Keep original parent sessions or their downloaded histories available when re-exporting older forked conversations. Source ranges can then be recovered without uploading unselected conversation bodies. Missing historical ancestry cannot be reconstructed from content alone.
3. Open Personal Center to rebuild the usage snapshot. Verify that refreshing preserves dates and totals, independent providers remain separate, and syncing an ancestor with its descendant does not count inherited calls twice. Do not delete Session logs or cloud histories to clear a browser cache.
