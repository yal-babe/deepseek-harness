---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-15-session-team-activation

English | [中文](2026-10-15-session-team-activation.zh.md)

## Summary

Adds required session-local Team activation records.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-15-session-team-activation
baseline: false
changes:
  - root: "event:team/mode"
    previous: null
    after: "e0b6b96289e5d7d3bcfb737cffe785d331ef26e95d2617f035c14f96a4067a35"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

New readers retain implicit Teams for old logs without team/mode. New normal conversations and their one-way activation are recorded as required team/mode events. Older readers refuse this unknown required event before execution through validateStoredEvents, retaining the raw log; it is not ignorable and no historical migration is changed.

<a id="verification"></a>
## Verification

Focused Team projection, scoped-tool activation and persisted-mode tests; storage-contract unknown-required-event refusal tests.

<a id="dev-note"></a>
## Dev Note

None.
