---
description: "pet 组地图：内置桌宠 Host 模块。"
kind: "package-group"
---

# pet/ — 桌宠

[English](README.md) | 中文

## 摘要

pet 组承载内置桌宠。Host 模块把运行中的会话事件汇总成一份桌宠快照。[ui-pet](../client/ui-pet/README.zh.md) Client 插件在页面内与 Desktop 桌宠窗口中渲染它。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`pet`](pet/README.zh.md) | 在 Host 汇总会话事件为桌宠快照；`pet` Remote | `ctx.pet` |

web-app bundle 在 Web 与 Desktop profile 中挂载 `pet` 与 `ui-pet`。

-----

<a id="related-documentation"></a>
## 相关文档

- [Phase 0 结论](../../.agents/notes/proposed/feature/2026-10-17-studio-pet-phase0-findings.zh.md) — 已验证的假设与开放问题。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
