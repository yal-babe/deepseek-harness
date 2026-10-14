---
description: "The OS-keychain credentials provider for users and maintainers choosing, configuring, or debugging Desktop secret storage and its file-backend fallback."
kind: "package-reference"
---

# @deepseek-ai/dsh-credentials-os

English | [中文](README.zh.md)

## Summary

`dsh-credentials-os` stores API keys and other secrets in the OS keychain on macOS and Windows, so those values are not sitting in a YAML file under your harness home. Desktop seeds this store for new profiles. Credential lookup follows the same precedence as the file store: the launch environment wins, then the keychain, then project and home `.env` files. You can switch `backend` to `file` to keep the YAML document instead. Linux has no keychain backend here, so `backend: os` keeps secrets only in process memory until you choose `file`.

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

This package gives a composition an OS-backed credential store: save API keys once, and every request that names them uses them without writing the secret into `$DSH_HOME/.credentials.yaml`.

### When to choose it

Choose it on Desktop when secrets should live in macOS Keychain or Windows DPAPI rather than a YAML file. Keep `@deepseek-ai/dsh-credentials-local` (or this package with `backend: file`) for headless, Web, and Linux profiles, and whenever you need to edit secrets as a file.

### Setting it up

```yaml
- id: credentials
  disabled: true
- insert:
    - id: credentials-os
      name: '@deepseek-ai/dsh-credentials-os'
      config:
        backend: os
        service: dsh-studio
```

| Field | Default | Meaning |
|---|---|---|
| `backend` | `os` | `os` uses the keychain plus an index file; `file` fully delegates to `dsh-credentials-local` |
| `service` | `dsh-studio` | Keychain / DPAPI service name |
| `path` | `<harness home>/.credentials-os-index.yaml` (os) or `.credentials.yaml` (file) | Index or credentials-document path |
| `dshHome` | `$DSH_HOME` or `~/.dsh` | Harness home used when `path` is omitted |
| `watch` | `true` | File backend only: reload the YAML document when it changes on disk |
| `debounceMs` | `100` | File backend only: wait this long after a change before reloading, in milliseconds |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-credentials-os) is the exhaustive source for every accepted field and its JSDoc.

Desktop new profiles write that `id: credentials` patch into the profile `cordis.patch.yml`. Existing profiles keep `credentials-local` until you add the same patch. Apply it as a `--patch` overlay when diagnosing a checkout that is not Desktop.

### Storing and removing keys

Save a key with `set`, remove it with `unset`, and check whether a key is configured with `describe` — the same operations the credential API provides:

```ts
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

declare const ctx: Context

const ref = credentialRef('DEEPSEEK_API_KEY')
await ctx.credentials.set(ref, 'sk-…')
await ctx.credentials.describe(ref)
await ctx.credentials.unset(ref)
```

A key you save is usable by the next request that names it. `describe` reports `source: 'keychain'` for OS-stored values. Records use the same operations as the file store (`readRecord`, `describeRecord`, `listRecords`, `modifyRecord`, `deleteRecord`).

### Where keys come from

Keys are resolved in one fixed order — the first place that has a value wins:

| Place | Writable? | Wins over |
|---|---|---|
| The environment you launched in (`DEEPSEEK_API_KEY=… dsh`) | no | everything |
| The OS keychain (or the YAML file when `backend: file`) | yes (`set`/`unset`) | both `.env` files |
| Your project's `.env` (`<invocation cwd>/.env`) | not here | your home `.env` |
| Your home `.env` (`$DSH_HOME/.env`) | not here | nothing |

The launching environment wins because a per-run override is this run's explicit intent; writes to a shadowed reference are refused. A newly saved keychain value immediately overrides older `.env` values.

### The index file

The OS backend writes `$DSH_HOME/.credentials-os-index.yaml` with reference names and record kinds only — never secret values. Secrets live in the OS store under service `dsh-studio` (configurable). The file is owner-only on POSIX, the same as the YAML credentials document.

```yaml
version: 1
refs:
  DEEPSEEK_API_KEY: true
records:
  llm-pi-ai/openai-codex: grant
```

### What can go wrong

- **A key the launching environment supplies is read-only** — `DEEPSEEK_API_KEY=… dsh` wins for this run; saving or removing it is refused. Clear the variable in the launching shell first.
- **An empty value cannot be saved** — storing an empty string is refused; remove the key instead.
- **An index that names a missing secret fails at startup** — the index and the OS store must agree; a live write that cannot parse the index refuses rather than overwriting it.
- **Linux `backend: os` does not persist** — there is no keychain backend; use `backend: file`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **Secrets stay out of YAML.** The index is an address book; `OsSecretStore` holds values. Tests inject `MemoryOsSecretStore`.
- **One honest precedence.** The inherited environment wins; everything below it loses to the managed store, whether that store is the keychain or the file backend.
- **File backend is the local provider.** `backend: file` constructs `LocalCredentialProvider` in an isolated `credentials` scope and forwards every seam method, including its watcher.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Provider: backend selection, layer resolution, OS write paths under the index lock |
| [`src/index-file.ts`](src/index-file.ts) | Index parse and render: refs as presence markers, records as kinds |
| [`src/os-store.ts`](src/os-store.ts) | `OsSecretStore`: memory (tests/Linux), macOS `security`, Windows DPAPI files |

### Resolution and write paths

`resolve` and `describe` read the inherited environment snapshot, the in-memory OS snapshot, and the `.env` fallbacks. OS `set`/`unset`/`modifyRecord` queue onto one exclusive chain, re-read the index under the writer lock, commit the secret then the index (or the index then the secret on delete), and fire `credentials/reference-updated` or `credentials/record-updated` only after the commit.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Credential-reference seam](../credentials/README.md) — `resolve`, `describe`, `set`, `unset`, the record operations, and the seam's update events.
- [File credentials store](../credentials-local/README.md) — the YAML provider this package delegates to when `backend: file`.
- [Credentials subsystem reference](../../../docs/subsystems/credentials.md) — `CredentialRef`, per-operation resolution, UI-safe `CredentialInfo`.
- [Launch environment snapshot](../../util/launch-environment/README.md) — the frozen layer snapshot resolution reads instead of `process.env`.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the consumers of `ctx.credentials`, which own any model-facing behavior a stored value enables.

#### KV Cache effect

No direct invalidation; stored values never enter a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the provider is a poor fit or needs special operational care. They are current package constraints, not a task backlog.

- **Linux `backend: os` is in-process only** — `createPlatformOsSecretStore` returns memory storage; secrets do not survive restart. Use `backend: file` on Linux.
- **External keychain edits are invisible until restart** — the OS backend does not watch the keychain or the index; only this process's writes update the snapshot.
- **Same-reference concurrent writes are last-write-wins** — the index lock keeps concurrent writers from dropping each other's entries, but two writers editing one reference still resolve to the later write.
- **A crash between secret and index commits can orphan a secret** — `set` writes the OS store first; `unset` updates the index first, so a listed missing secret cannot pass boot.
- **Windows stores DPAPI files under LocalAppData** — not Windows Credential Manager. Protection is the signed-in user, not a separate keychain item.
- **File backend is still same-UID readable** — `backend: file` is `dsh-credentials-local`; agent tool processes can read that document.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

A Linux secret-service (libsecret) backend would make `backend: os` persist on that platform. Helper-command and KMS-backed stores remain possible siblings; none is shipped.

</details>
