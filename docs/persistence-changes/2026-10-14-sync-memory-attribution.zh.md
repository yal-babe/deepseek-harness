---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-14-sync-memory-attribution

[English](2026-10-14-sync-memory-attribution.md) | 中文

## 概述

新增生产者拥有的 sync-memory 快照归因。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

已有记录仍然有效。新增的 sync-memory source kind 仅用于归因；声明的 source 策略在不解释的情况下保留未知归因。Session 格式保持不变。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/sync --coverage.enabled=false：6 个文件、69 个测试通过。

<a id="dev-note"></a>
## 开发备注

无。
