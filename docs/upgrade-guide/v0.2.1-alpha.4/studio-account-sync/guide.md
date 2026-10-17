---
kind: upgrade-guide
description: "Startup no longer requires provider authorization, and Studio upload categories replace automatic per-object synchronization."
---

# Studio identity and optional synchronization

English | [中文](guide.zh.md)

## Change

The sidebar represents DSH Studio identity. DeepSeek, Codex, Antigravity and API Key authentication remain separate in Settings. Startup allows local use without Studio or provider login. `ui-settings-models.credentialOnboarding` now defaults to `false`; explicit model authorization remains available.

Studio sign-in downloads existing cloud data. Upload categories and automatic synchronization require explicit selection. Existing per-object selections remain readable, but automatic background synchronization is disabled until enabled in Cloud sync. Credentials require an independent sync passphrase; Studio password recovery does not recover it.

## Migration

1. Save an HTTP or HTTPS origin in Settings → Server configuration, then use Account sign-in. Existing signed-in origins migrate automatically. Login and recovery reuse the saved origin without an HTTP checkbox. Select upload categories and automatic synchronization in Cloud sync.
2. For model credentials, enter and confirm a separate passphrase of at least 12 characters. Use the same passphrase on other devices. Restarting the Host or signing out requires unlocking again.
3. Configure provider accounts in Account balance or Models. Local data and provider credentials remain available when signing out of Studio.
4. Verify the sidebar shows the Studio display name, and only checked categories upload. Projects require local workspace binding; plugin inventory requires local review before installation.

See the [sync package](../../../../packages/sync/studio-cloud/README.md) for supported preferences, encryption, and restoration limits.
