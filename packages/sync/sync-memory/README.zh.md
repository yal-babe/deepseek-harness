---
description: "带 FTS 检索的项目记忆 CRUD；匹配记录只通过已记录的 user/message 快照进入模型。"
kind: "package-reference"
---

# @deepseek-ai/dsh-sync-memory

[English](README.md) | 中文

## 摘要

`dsh-sync-memory` 即 `ctx.syncMemory`：用于脱敏项目记忆的本地 SQLite FTS 存储。在合格的 `agent/pre-step` 进入时，它追加一条持久 `user/message`，其 source kind 为 `sync-memory`。除该已记录快照外，没有任何内容进入模型。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

```yaml
- name: '@deepseek-ai/dsh-sync-memory'
  config:
    projectId: proj-1
    maxInjectRecords: 8
    maxInjectChars: 4000
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `projectId` | 必填 | 拥有存储记录的云项目 |
| `storePath` | `$DSH_HOME/sync-memory.sqlite` | SQLite 文件，或 `:memory:` |
| `maxInjectRecords` | `8` | 一次注入的最大记录数 |
| `maxInjectChars` | `4000` | 拼接字符数上限 |

`create`、`revise`、`search` 与 `remove` 是 CRUD 方法。`search('')` 按新近度列出存活行。`text` 与 `source` 中的密钥在存储前脱敏。

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-sync-memory)是每个受支持字段的详尽来源。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

插件前置一个 `agent/pre-step` 监听器：先委托，再用最近一条用户消息中的词元搜索，按配置上限接纳记录，并追加 `createUserMessage`，source 为 `{ kind: 'sync-memory', form: 'snapshot', sections: [{ name: 'sync-memory', text }] }`。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [云同步子系统](../../../docs/subsystems/sync.zh.md)
- [`dsh-sync-protocol`](../sync-protocol/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

### 已接纳的项目记忆快照

#### 模型看到的内容

每次注入都是一条 user 角色消息。`<kind>` 是 `MemoryKind`；`<text>` 是已经脱敏的正文。

##### 本字段的逐字文本（如需要）

```markdown
Relevant project memory:
- (<kind>) <text>
```

#### Token 影响

有条件且有上限：没有接纳到存活记录时省略；否则一条快照，记录在 `maxInjectRecords` 与 `maxInjectChars` 处停止。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与延期工作

- **检索是词法 FTS** — 没有嵌入排序；仅含标点的查询回退为按新近度排序。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
