---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-15-session-team-activation

[English](2026-10-15-session-team-activation.md) | 中文

## 概述

增加必需的会话级团队开启记录。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

新读取方对没有 team/mode 的已有日志保留隐式团队。新普通对话及其单向开启通过必需的 team/mode 事件记录。旧读取方通过 validateStoredEvents 在执行前拒绝未知必需事件并保留原始日志；该事件不可忽略，历史迁移未修改。

<a id="verification"></a>
## 验证

团队投影、会话工具开启及模式持久化专项测试；storage-contract 的未知必需事件拒绝测试。

<a id="dev-note"></a>
## 开发备注

无。
