---
description: "Built-in Studio Pet character: in-page overlay on Web and the whole document inside the Desktop pet window."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-pet

English | [中文](README.zh.md)

## Summary

Browser half of the built-in Studio Pet. It mirrors the Host [`pet`](../../pet/pet/README.md) snapshot and renders a small animated character with a bubble. The bubble shows the focused Session, pending approvals, and a quick-ask box that accepts dropped files. On Web the character sits in `shell.overlay`. Inside the Desktop pet window (`?dsh-pet-window=1`) the plugin shadows `root`, so the whole transparent document is the pet.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The web-app bundle mounts this plugin with the Host `pet` module. Opening any Web page shows the character in the bottom-right corner. Append `?dsh-pet-window=1` to preview the pet-window surface in a browser. Desktop opens a separate transparent always-on-top window on that URL. The Desktop main window then shows no in-page character. In the pet window, dragging the character more than 4 px moves the window instead of opening the bubble, and the Desktop tray can show or hide the pet through the same Host setting. `CommandOrControl+Shift+Space` opens the quick ask from anywhere and shows the pet again after it was hidden.

Right-click the character for its menu: Quick ask, Open main window (Desktop only), notifications on or off, do not disturb for one hour, and Hide pet. Escape closes the menu. Open main window brings the Desktop main window forward and opens the Session the pet is showing; the Open main window buttons on approval and question cards open that card's Session. On Web, where there is no separate window, those card buttons open the Session in the current page.

System notifications are off until you turn them on from the menu, which also asks the browser or Desktop for permission. When on, the pet notifies about a new approval request and about a Session that finishes or fails, but only while you are not looking at the pet's document and no do-not-disturb hour is running. Clicking a notification brings the app forward and opens the notified Session. Both settings are stored per device in `localStorage` (`dsh-pet:preferences`) and are not synced; the Desktop pet window and main window follow each other's writes through `storage` events.

The Settings panel has a **Pet** page (`settings.section`, id `pet`) on Web and in the Desktop main window, registered while ui-settings is mounted and the Host serves the `pet` entry. It edits the Host [`pet`](../../pet/pet/README.md) fields through `configForms`: Show desktop pet, the three notification categories (new approval, task finished, task failed), and Restrict which tools can be approved from the pet with its tool list (off by default, so the pet can approve every tool). The page also holds the per-device notification switch and states whether the pet runs in the Desktop window or inside the page.

Approval cards keep both buttons disabled for 800 ms after they appear, and Enter never approves. An approval whose tool the settings restrict shows no buttons; it explains the restriction and offers Open main window. Deciding in the pet and deciding in the main window answer the same Host request; the first answer wins and the other surface closes its card.

When the agent asks a question (`ask_user_question`) and no approval is waiting, the bubble shows a question card. Questions that only offer single-choice options are answered in the pet, after the same 800 ms delay: one click for a single question, or one choice per question and then Submit. Free-text and multi-select questions show a button that opens the main window.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

- `PetStore` consumes `pet.watch()` through `ctx.remote.$stream`; a carrier loss or terminal failure makes the character `DISCONNECTED` until the next frame.
- Approvals are not decided through the Host. Each Client already answers the forwarded `approval/request` waterfall with ui-approval's `PendingApproval`. The pet reads those objects from `uiSession.sessionStatus`, matches them to Host pending entries by Session and tool call, and answers them through `PetApprovalBridge`, which rejects a second submission from the same surface. The Gateway settles the waterfall with the first result and cancels the other Clients, so the main window and pet window cannot both decide.
- Questions follow the same path: ui-user-questions publishes each request as a `PendingQuestion` in `uiSession.sessionStatus`, and `PetQuestionBridge` answers that object once. Settled review cards and plan reviews are skipped.
- Notifications compare two consecutive Host frames (`diffNotices`); the first frame after connecting never notifies, and subagent Sessions are skipped. In Desktop only the pet window runs ui-pet, so each change notifies once; several Web tabs each notify.
- Quick ask runs `session.create` (for a new Session), `fileUpload.upload` for each dropped file, then `session.prompt` in queue mode.
- The Desktop bridge (`window.dshDesktopPet`) toggles click-through when the pointer enters or leaves the character and bubble, follows Host visibility, and forwards the global shortcut.
- Frames: six frames each of the idle, thinking, working, waiting, success, and error clips of the whale-tail maid character, cropped and scaled to 160 px. The frames are MIT licensed, Copyright (c) 2026 PC2005-cloud; the license is in `src/client/assets/whaletail-maid/LICENSE.txt`.

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as this package renders the pet in the browser and registers nothing model-facing.

#### KV Cache effect

None; a quick ask is an ordinary user prompt.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **MVP scope** — no touch reactions, sounds, or talking state; dragging moves only the Desktop pet window, and the Web character stays in its corner. The frame set is a small embedded subset.
- **One approval per Session** — Session status exposes the highest-precedence pending interaction, so a second parallel approval in the same Session is answered in the main window.
- **Re-show entry points** — hiding leaves a small whale handle in the Web page corner. Desktop offers the global shortcut, the Settings page, and on Windows the tray; macOS has no menu-bar entry yet.

<a id="dev-note"></a>
### Dev Note

None.
