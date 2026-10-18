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

The web-app bundle mounts this plugin with the Host `pet` module. The Web character starts near the bottom-right corner; drag it to reposition it, with the position saved on this device. With the per-device "Throw on fling" setting (on by default, off under reduced motion), the character follows the pointer on a spring, and releasing a fast drag throws it: it falls with gravity, bounces off the viewport edges, slows on the floor, and is saved where it lands; grabbing it in the air catches it. The physics is adapted from upstream dsh-pet (see `NOTICE`). Append `?dsh-pet-window=1` to preview the pet-window surface in a browser. Desktop opens a separate transparent always-on-top window on that URL. The Desktop main window then shows no in-page character. In the pet window, dragging the character more than 4 px moves the window instead of opening the bubble, a fling throws the window across the displays with the same physics when the Desktop bridge offers it, and an open panel or menu keeps the whole window on screen, and the Desktop tray can show or hide the pet through the same Host setting. `CommandOrControl+Shift+Space` toggles the quick ask from anywhere and shows the pet again after it was hidden.

Right-click the character for its menu: Quick ask, Open main window (Desktop only), notifications on or off, do not disturb for one hour, and Hide pet. Escape closes the menu. Open main window brings the Desktop main window forward and opens the Session the pet is showing; the Open main window buttons on approval and question cards open that card's Session. On Web, where there is no separate window, those card buttons open the Session in the current page.

System notifications are off until you turn them on from the menu, which also asks the browser or Desktop for permission. When on, the pet notifies about a new approval request and about a Session that finishes or fails, but only while you are not looking at the pet's document and no do-not-disturb hour is running. Clicking a notification brings the app forward and opens the notified Session. Both settings are stored per device in `localStorage` (`dsh-pet:preferences`) and are not synced; the Desktop pet window and main window follow each other's writes through `storage` events.

The Settings panel has a **Dafeiyu** page (`settings.section`, id `pet`) on Web and in the Desktop main window, registered while ui-settings is mounted and the Host serves the `pet` entry. It edits the Host [`pet`](../../pet/pet/README.md) fields through `configForms`: Show desktop pet, the three notification categories (new approval, task finished, task failed), and Restrict which tools can be approved from the pet with its tool list (off by default, so the pet can approve every tool). The page also holds the per-device notification switch and states whether the pet runs in the Desktop window or inside the page.

Approval cards keep both buttons disabled for 800 ms after they appear, and Enter never approves. An approval whose tool the settings restrict shows no buttons; it explains the restriction and offers Open main window. Deciding in the pet and deciding in the main window answer the same Host request; the first answer wins and the other surface closes its card.

When the agent asks a question (`ask_user_question`) and no approval is waiting, the bubble shows a question card. Questions that only offer single-choice options are answered in the pet, after the same 800 ms delay: one click for a single question, or one choice per question and then Submit. Free-text and multi-select questions show a button that opens the main window.

Built-in motion is fetched on demand from the Host, with the small embedded frame set as a fallback. The idle-only Actions menu item opens the pack's categories (for the built-in pack: small actions, play, interactions, snacks, rest, work, and movement) and then their clips, with Back at each level; named actions use the dictionary and pack-only clips such as the three click responses use the pack's zh/en label. Packs without categories list the actions directly. Optional body-area clicks select head, body, or tail actions; the default single click still opens the panel. Per-device settings control quiet/standard/lively idle intervals, wandering (off by default), effects, and reduced motion. Work, questions, approvals, dragging, and an open panel displace idle play. Per-device preferences also include the name (default 大肥鱼), a 50–200% size slider, idle/rest/play selection, and the allowed autonomous-action list. When the pack's `motion.json` lists categories, the autonomous chain draws a category by weight among those for the life state and then a clip in it without repeating the last one; the built-in pack's small-actions category (stretching, yawning, daydreaming, observing, grooming, and looking around) serves idle, and its play category (bubbles, celebration, bubble chasing, ball play, and tail spinning) serves play. Packs without categories use those same two fixed lists. Clips that are named actions respect the allowed-action list. A clip marked as a turn, such as looking around, leaves the character facing the other way, and later clips are mirrored to match unless marked unmirrorable. Rest plays an entry, a persistent sleeping loop, and a wake-up exit; work interrupts it and completion restores the selected state. Autonomous movement plays start, directional swimming, and stop phases while the native or page origin changes. Twenty menu actions include ten additional sets: daydreaming, observing, swimming, grooming, bubble chasing, ball play, tail spinning, reading, pondering, and pillow sleep. The four replaced interactions and ten new sheets contain 666 actual frames played at the per-action 6–10 fps recorded in the import recipe. Sprite playback uses animation frames, waits for image loading, and shares decoded sheets across phase changes. Thinking rotates among available thought, idea, and reading clips without extra model requests. When the Host moment enters a new time-of-day slot or festival phase (and once after start), an idle pet with no panel or menu open shows a greeting or festival line from the pack's local table in its bubble for eight seconds; a change while busy is skipped, and no model is asked.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

- `PetStore` consumes `pet.watch()` through `ctx.remote.$stream`; a carrier loss or terminal failure makes the character `DISCONNECTED` until the next frame.
- Approvals are not decided through the Host. Each Client already answers the forwarded `approval/request` waterfall with ui-approval's `PendingApproval`. The pet reads those objects from `uiSession.sessionStatus`, matches them to Host pending entries by Session and tool call, and answers them through `PetApprovalBridge`, which rejects a second submission from the same surface. The Gateway settles the waterfall with the first result and cancels the other Clients, so the main window and pet window cannot both decide.
- Questions follow the same path: ui-user-questions publishes each request as a `PendingQuestion` in `uiSession.sessionStatus`, and `PetQuestionBridge` answers that object once. Settled review cards and plan reviews are skipped.
- Notifications compare two consecutive Host frames (`diffNotices`); the first frame after connecting never notifies, and subagent Sessions are skipped. In Desktop only the pet window runs ui-pet, so each change notifies once; several Web tabs each notify.
- Closing the panel with its close button, Escape, an outside click, or its trigger preserves the mounted quick-ask draft and attachments. Pending approvals remain in the Host and a different pending request can reopen the panel. The pet declares `pet.panel.metrics`, a root-scoped list slot carrying visibility, focused Session id, and task state; the personal-center owner supplies usage and balances without the pet importing that feature’s runtime.

- Quick ask runs `session.create` (for a new Session), `fileUpload.upload` for each dropped file, then `session.prompt` in queue mode.
- The Desktop bridge (`window.dshDesktopPet`) toggles click-through when the pointer enters or leaves the character and bubble, follows Host visibility, and forwards the global shortcut.
- Frames: the built-in pack `whaletail-maid@1.0.0` from [`@deepseek-ai/dsh-pet/packs/whaletail-maid`](../../pet/pet/README.md#pet-packs), six frames each of the idle, thinking, working, waiting, success, and error clips, cropped and scaled to 160 px. Its `pet.json` is validated with `parsePetPack` when the bundle loads, and the frames are embedded as data URLs. The character and its frames and media come from [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet); its assets are for non-commercial use only and derivative works must credit that address ([terms](../../pet/pet/README.md#pet-packs)). The settings page ends with a Character credit line that links the address taken from the built-in `pet.json` `license.source`. When the Host offers a development pack through `pet.pack()` (`DSH_PET_DEV`), the Client validates it again and renders it with a Dev pack marker under the character; an invalid or incomplete pack keeps the built-in one.

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as this package renders the pet in the browser and registers nothing model-facing.

#### KV Cache effect

None; a quick ask is an ordinary user prompt.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Media support** — built-in clips use transparent VP9 videos and fourteen generated sprite sheets. Generated art may still benefit from visual refinement; frame count is not a guarantee of pose continuity. Development packs still use frames. Sounds and talking state are not implemented; Desktop movement needs platform testing.
- **One approval per Session** — Session status exposes the highest-precedence pending interaction, so a second parallel approval in the same Session is answered in the main window.
- **Re-show entry points** — hiding leaves a small whale handle in the Web page corner. Desktop offers the global shortcut, the Settings page, and on Windows the tray; macOS has no menu-bar entry yet.

<a id="dev-note"></a>
### Dev Note

None.
