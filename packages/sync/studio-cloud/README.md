---
description: "Studio account login and explicitly selected personal-object sync, with Host-owned credentials and isolated durable queues."
kind: "package-reference"
---

# @deepseek-ai/dsh-studio-cloud

English | [中文](README.zh.md)

## Summary

Host-owned Studio login, separate from model-provider authorization. Mount `@deepseek-ai/dsh-studio-cloud` in the Web or desktop profile. The service requires `credentials`; the browser calls its generated `studioCloud` Remote and never receives cloud tokens. Signing in downloads existing cloud data without enabling uploads. Users separately choose upload categories and automatic synchronization; device names default to the operating-system hostname. Refresh rotation is single-flight and persists pending rotation before sending requests. Signing out aborts active requests, deletes the local grant, and reports whether device revocation succeeded. Model credentials and local Sessions remain intact.

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

The device-local `server.json` under the state directory stores the HTTP or HTTPS origin independently of the account grant. Settings → Cloud services saves it once for login and recovery; no HTTP checkbox is required. The unauthenticated `testConnection(origin)` operation validates `/v1/capabilities` without saving configuration, acquiring credentials, or starting synchronization. An existing signed-in origin migrates automatically. Sign out before changing issuers. Storage outages retain the cached account identity and origin while exposing a retryable failure.

The Web and Desktop profiles mount this service separately from the legacy batch outbox. The default state directory is located under `$DSH_HOME/studio-cloud`; service origin and account hashes isolate the persisted queue, cursor, and local project mappings. The sync loop default interval is 30000ms and executes only when uploads and automatic synchronization are both enabled.

Contributions declare a namespace, payload version, top-level field allowlist, exporter, and importer. Export filters fields before text redaction. The built-in preference contributor includes theme, language, chat presentation, Coding Tools visibility, and model provider settings; custom provider headers stay local; project metadata excludes local directory paths, and downloaded projects require an explicit workspace binding. Unknown payload versions remain visible in preview but cannot be imported. Unregistered plugin configuration and storage are never exported.

Selected conversations use `dsh-session-2`, retaining original Session IDs and event-position source ranges; `dsh-session-1` remains readable. Token activity uses token-meter's normalized durable settlements, including failed and retried calls, without comparing message content. Totals preserve provider-reported totals; missing usage, contradictory copies, and unresolved ancestry are explicitly incomplete. Cache-write counts and unknown-detail flags remain separate from provider balances. Update all devices before exporting the new format; see the [upgrade guide](../../../docs/upgrade-guide/v0.2.1-rc.2/studio-usage-sources/guide.md).

Login restores a cloud snapshot and later downloads use an incremental cursor. Locked model credentials remain deferred. Upload categories include future objects; advanced preview retains explicit local/cloud conflict resolution. Subsequent sync uses the incremental cursor and retains immutable queued requests until acknowledgement. A failed import retains its checkpoint. Pausing retains all local data.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The service implementation manages single-flight token rotation, durable outbox queues, incremental sync engine cycles, and session continuation receipts without coupling to model provider transports.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Service lifecycle, Cordis registration, and Remote method handlers |
| [`src/transport.ts`](src/transport.ts) | HTTP client, refresh rotation, and device revocation transport |
| [`src/sync-engine.ts`](src/sync-engine.ts) | Durable outbox, incremental cursor processing, and contributor dispatch |
| [`src/cloud-sessions.ts`](src/cloud-sessions.ts) | Cloud history streaming, snapshot previews, and session continuation fork |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Studio Cloud Service](../../../services/studio-cloud/README.md) — Backend HTTP server and PostgreSQL/S3 durable storage.
- [Studio Account Settings](../../client/ui-settings-account/README.md) — Client UI for account login and sync preview controls.

-----

<a id="model-experience"></a>
## Model Experience

None, as personal cloud identity and object sync add no model context or tools.

#### KV Cache effect

None; synchronization does not modify model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- DeepSeek, Codex, Antigravity grants and managed model API keys sync only after selecting their categories and unlocking an independent passphrase of at least 12 characters. AES-256-GCM encrypts them before the sync queue, previews, or HTTP transport; scrypt derives an account-bound key locally. Studio tokens, device identity, ambient environment values, execution permissions, and local code directories are excluded.
- The passphrase and key are held in Host memory only; restart or Studio sign-out locks credential sync. New devices use the same passphrase. Password recovery cannot recover encrypted credentials. Ordinary data remains unencrypted unless the server independently enables whole-space encryption, which this client does not support.
- Plugin inventory restores for review; arbitrary plugin storage requires an owner-registered contribution and plugins are not installed or enabled automatically.
- Arbitrary unapproved plugin code execution is prevented during restore.
- Legacy forks need original ancestors to recover exact source ranges. Histories migrated from another Session format generation have unavailable event-position attribution until a compatible export is available; their activity is labeled incomplete rather than guessed.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
