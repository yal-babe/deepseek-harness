---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-14-sync-memory-attribution

[English](2026-10-14-sync-memory-attribution.md) | 中文

## 概述

在上游 user-rpc principal 变更之后，新增生产者拥有的 sync-memory 快照归因。

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
## 兼容性

已有记录仍然有效。新增的 sync-memory source kind 仅用于归因；声明的 source 策略在不解释的情况下保留未知归因。Session 格式保持不变。

<a id="verification"></a>
## 验证

`pnpm exec vitest run scripts/doc-standard.spec.ts packages/sync`：7 个文件、98 个测试通过。`pnpm exec tsx scripts/persistence-changes.ts --check`：全部 65 个根类型与确认历史一致。

<a id="dev-note"></a>
## 开发备注

无。
