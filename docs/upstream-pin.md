# DSH Studio upstream pin

English | [中文](upstream-pin.zh.md)

English reference for the DeepSeek Harness commit this Studio fork tracks.

## Pin

| Field | Value |
| --- | --- |
| Upstream remote | `upstream` → `https://github.com/deepseek-ai/deepseek-harness.git` |
| Pinned commit | `86a402200d95fecef4529d969836f1fe13c6cb0d` |
| Upstream version | `0.2.1-alpha.4` |
| Studio branch | `studio/main` |

The pinned-commit table field is an explicit exception to the repository reference check.

## Sync procedure

1. `git fetch upstream`
2. Merge or merge-forward `upstream/master` into `studio/main` on an explicit upgrade PR.
3. Update the pinned commit and version in this file in the same PR.
4. Re-run Desktop smoke on mac-arm64, mac-x64, and win-x64 after the merge.

Do not rewrite or delete committed Studio customization history when syncing. Prefer merge-forward; use `--force-with-lease` only when rewriting a Studio-owned branch that has not been shared as a protected base.

## Extension seams verified for Studio

These Host seams are the contract baseline for Studio customization:

- `ctx.llm.registerAdapter` — model providers
- `ctx.authorization.registerFlow` — browser and device-code login
- `ctx.credentials` refs and records — secret storage
- `ctx.sessionPersistence` — append, flush, resume
- `OPTIONAL_BUNDLES` — Official opt-in plugins, including Agent Teams

Product proposal: [dsh-workbench-proposal.md](dsh-workbench-proposal.md).
