---
description: "Project memory CRUD with FTS retrieval; matching records reach the model only as logged user/message snapshots."
kind: "package-reference"
---

# @deepseek-ai/dsh-sync-memory

English | [中文](README.zh.md)

## Summary

`dsh-sync-memory` is `ctx.syncMemory`: a local SQLite FTS store for redacted project memory. On eligible `agent/pre-step` entries it appends one durable `user/message` whose source kind is `sync-memory`. Nothing reaches the model except through that logged snapshot.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

```yaml
- name: '@deepseek-ai/dsh-sync-memory'
  config:
    projectId: proj-1
    maxInjectRecords: 8
    maxInjectChars: 4000
```

| Field | Default | Meaning |
|---|---|---|
| `projectId` | required | Cloud project that owns stored records |
| `storePath` | `$DSH_HOME/sync-memory.sqlite` | SQLite file, or `:memory:` |
| `maxInjectRecords` | `8` | Maximum records in one injection |
| `maxInjectChars` | `4000` | Maximum concatenated character count |

`create`, `revise`, `search`, and `remove` are the CRUD methods. `search('')` lists live rows by recency. Secrets in `text` and `source` are redacted before storage.

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-sync-memory) is the exhaustive source for every accepted field.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin prepends an `agent/pre-step` listener that delegates first, searches with tokens from the latest user message, admits records under the configured caps, and appends `createUserMessage` with source `{ kind: 'sync-memory', form: 'snapshot', sections: [{ name: 'sync-memory', text }] }`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Cloud sync subsystem](../../../docs/subsystems/sync.md)
- [`dsh-sync-protocol`](../sync-protocol/README.md)

-----

<a id="model-experience"></a>
## Model Experience

### Admitted project-memory snapshot

#### What the model sees

Each injection is one user-role message. `<kind>` is a `MemoryKind`; `<text>` is the already-redacted body.

##### Verbatim text for this field, when needed

```markdown
Relevant project memory:
- (<kind>) <text>
```

#### Token effect

Conditional and capped: omitted when no live record is admitted; otherwise one snapshot whose records stop at `maxInjectRecords` and `maxInjectChars`.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV Cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Retrieval is lexical FTS** — there is no embedding ranker; punctuation-only queries fall back to recency order.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
