# Agent Note: Studio Pet Phase 0 findings

Status: proposed

English | [中文](2026-10-17-studio-pet-phase0-findings.zh.md)

## Problem

The Studio Pet design (v0.4) marks four integration points as assumptions: (a) the pet and the main window can both show an approval without double decisions; (b) a separate Desktop pet window can reuse the Host's authenticated connection; (c) quick ask with dropped files works through existing Remotes; (d) a global shortcut can summon the pet. Phase 0 is a vertical slice that tests these assumptions before character packs, drag, sounds, and the TALKING state are built. This note records what the slice verified, how far, and what remains open.

## Proposal

Keep the Phase 0 architecture for Phase 1: the Host module owns the snapshot, every Client answers approvals through ui-approval, and Desktop opens a second Client window. Phase 1 should add a tray or menu toggle and a Web "show pet" entry, persist the visible state and window position, navigate the main window to the clicked Session in `openMain`, and add TALKING, compaction, and retry states. Before that, run the Electron app once on Windows and macOS to confirm (b) and (d), including click-through over transparent pixels and multi-monitor placement.

## Findings

### Approval race (a)

Verified by design and unit tests; not exercised end to end. The Host `pet` module cannot decide approvals itself: `approval/request` is a waterfall that the Gateway forwards to every connected Client, and only a Client result settles it. A Host-side `decide` would need a new entry point in user-approval or the Gateway. Instead, each Client answers through the `PendingApproval` that ui-approval already publishes in `uiSession.sessionStatus`. The Gateway takes the first result and sends `cancel` to the other Clients, which aborts their `PendingApproval`, so the second window's card disappears. Within one surface, `PetApprovalBridge` rejects a second submission and reports `already-settled` when the request is gone. `tests/approvals.client.spec.ts` simulates the main window and the pet window racing on one shared settle point. Limitation: session status exposes only the highest-precedence pending interaction per Session, so a second parallel approval in the same Session is visible in the pet only after the first one settles.

### Shared authenticated connection (b)

Compiled and unit-tested; not runtime-verified, because the box has no display to run Electron. The pet window loads the main application URL with `?dsh-pet-window=1` and the same preload. HTTP goes through the `dsh-app://app/` protocol handler, which attaches the Host cookie for any window. The WebSocket cookie allowlist is per `webContents`, so `main.ts` now also accepts `pet.owns(webContentsId)`, and the locale bootstrap accepts the pet window. Boot IPC already accepts any application sender. The pet window is a second full Client: it runs its own Gateway connection and plugin set. That costs one more renderer process (roughly the memory of a second main window); `DSH_DESKTOP_PET=0` turns it off.

### Quick ask with files (c)

Verified at the Client level with unit tests. `sendQuickAsk` runs `session.create` when the target is a new Session, uploads each dropped file through `ctx.fileUpload.upload`, then calls `session.prompt` in queue mode with the uploaded references. A failure reports the failing stage (`create`, `upload`, or `prompt`) and keeps the draft. No Host change was needed.

### Global shortcut (d)

Registration code is unit-tested with a mocked `globalShortcut`; not runtime-verified. `CommandOrControl+Shift+Space` shows the pet window, forces the bubble open, and focuses the quick-ask box. Registration failure logs a warning and leaves the pet usable. The shortcut is currently the only way to show the pet again on Desktop after the user hides it.

## Alternatives considered

- **Host-side approval decisions** — a `pet.decide` Remote would let the pet answer without a ui-approval object, but the waterfall can only be settled by a Client result; it needs a user-approval or Gateway change and would bypass the existing per-Client cancellation. Rejected for Phase 0.
- **Pet window as a slim page without the full Client** — would save memory but needs its own authentication and Remote wiring; rejected until (b) is confirmed on real hardware and memory is measured.
- **Render the pet inside the main window only** — the simplest option, but the pet would disappear whenever the main window is hidden, which defeats the purpose of a desktop pet.

## Acceptance criteria

- On a real Desktop run, the pet window connects without a second login, shows the focused Session state, and clicks pass through transparent pixels.
- An approval decided in either window closes the card in the other, and the Host records exactly one decision.
- A quick ask with dropped files lands in the chosen Session with the files attached.
- The global shortcut shows a hidden pet and focuses the quick-ask box on Windows and macOS.

## Risks

- **Bundle size** — the 36 embedded frames add about 300 KB of base64 to the client bundle; character packs must load lazily instead.
- **Third-party notice** — the whale-tail maid art is MIT (Copyright (c) 2026 PC2005-cloud). Its license ships next to the frames, but the THIRD_PARTY_NOTICES generator does not scan assets, so packaged notices omit it until the generator covers them.
- **Memory** — the second renderer doubles client memory on low-end machines.
- **Generated docs** — on the base branch `gen-cordis-catalog`, `gen-cordis-api`, `gen-doc-graphs`, and `gen-persistence-catalog` already fail on unrelated packages, so the pet entries added to those generators were not regenerated or checked.
