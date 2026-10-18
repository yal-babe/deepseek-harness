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

Built-in motion is fetched on demand from the Host, with the small embedded frame set as a fallback. The idle-only Actions menu item opens the pack's categories (for the built-in pack: small actions, play, dances, talents, games, interactions, snacks, seasons and festivals, and movement) and then their clips, with Back at each level; named actions use the dictionary and pack-only clips such as the three click responses use the pack's zh/en label. Packs without categories list the actions directly. Optional body-area clicks select head, body, or tail actions; the default single click still opens the panel. Per-device settings control quiet/standard/lively idle intervals, wandering (off by default), effects, and reduced motion. Work, questions, approvals, dragging, and an open panel displace idle play. Per-device preferences also include the name (default 大肥鱼), a 50–200% size slider, idle/rest/play selection, and the allowed autonomous-action list. When the pack's `motion.json` lists categories, the autonomous chain draws a category by weight among those for the life state and then a clip in it without repeating the last one; the built-in pack's small-actions category (stretching, yawning, looking around, the three mumbling clips, and thirteen more small upstream clips) serves idle, its play category (the bounce and huff click responses and running on the spot) serves play, and its dance, talent, game, snack, and season-and-festival categories serve both. A category may name a cooldown group: after the chain plays one of its clips, every category of that group rests for the pause (for the built-in pack 3 minutes for dances, talents, and games together, 20 for snacks, 10 for festivals), twice as long when quiet and half as long when lively. The pack's `schedule` limits time-bound clips to their windows in device-local time: the built-in pack serves breakfast at 7–9, lunch at 11–13, dinner at 17–19, snacks at 15–17 and 21–23, toothbrushing at 5–9, seasonal clips in their months, and festival clips while the Host moment lists their festival (lunar festivals such as the Spring and Lantern Festivals, Dragon Boat, Qixi, Mid-Autumn, Double Ninth, and Laba come from the Host's offline ICU calendar). The per-device Festival and mealtime actions switch keeps them menu-only. Autonomous clips never start during work, questions, approvals, or dragging, and any of them ends when such a state begins. Packs without categories use two fixed lists of named actions (stretching, yawning, daydreaming, observing, and grooming for idle; bubbles, celebration, bubble chasing, ball play, and tail spinning for play), limited to the clips the pack has. Clips that are named actions respect the allowed-action list. A clip marked as a turn, such as looking around, leaves the character facing the other way, and later clips are mirrored to match unless marked unmirrorable. Rest plays an entry, a persistent sleeping loop, and a wake-up exit from the first family the pack has: the AI-video slots `pillow_enter`/`pillow_loop`/`pillow_wake` and `sleep_enter`/`sleep_loop`/`sleep_wake` come first, then the upstream nap `doze_enter`/`doze_loop`/`doze_wake` that the built-in pack ships, which wakes either gently or startled (`doze_startle`); a pack without any of them yawns once, loops `idle`, and stretches on waking. Work interrupts it and completion restores the selected state. Autonomous gliding plays start, directional swimming, and stop phases (`swim_start`, `swim_loop`, `swim_stop`) while the native or page origin changes; it runs for frame-only packs and for motion packs with `swim_loop`, so the built-in pack moves only with its walking clips. When the pack's `motion.json` carries chain weights (the built-in pack uses upstream's idle 10, turn 5, move 5), each idle round first chooses between the categories, a turn clip, and a walking clip; walking needs the wander setting and room ahead in the facing direction, turns around when there is none, and otherwise falls back to the categories. A walking clip moves the page origin or the Desktop window with its measured travel read from the media position, so the feet do not slide; mirrored clips walk the other way, and a drag, task, or hidden page ends the walk and saves the position. The flat action list and the allowed-action setting show only the named actions whose clip the pack has; for the built-in pack these are head pat, poke, touch tail, eat a token, stretch, and yawn. The other fourteen (bubbles, sleep, nuzzling, celebration, daydreaming, observing, swimming, grooming, bubble chasing, ball play, tail spinning, reading, pondering, and pillow sleep) are slots that AI-video clips with the matching names fill; see the [AI-video clip guide](../../pet/pet/tools/AI_VIDEO_CLIPS.zh.md). A request for a missing clip plays a stand-in: celebration plays `success`, nuzzling a head pat, the play actions `click_bounce` (tail spinning `turn_run`), daydreaming the daydream mumbling, the resting ones `idle_yawn`, pondering the deep thought, and reading `thinking`. Sprite-sheet playback remains for packs that ship sheets: it uses animation frames, waits for image loading, and shares decoded sheets across phase changes. Thinking rotates among available thought, idea, reading, and deep-thought clips without extra model requests. Upstream stand-ins (daydream mumbling for daydreaming, deep thought for pondering) step aside in autonomous play and the thinking rotation once the pack has the AI-video clip of that slot. When the Host moment enters a new time-of-day slot or festival phase (and once after start), an idle pet with no panel or menu open shows a greeting or festival line from the pack's local table in its bubble for eight seconds; a change while busy is skipped, and no model is asked.

Pack event tiers and click responses: when `motion.json` declares `events.workStatus`, task states play its tiers (thinking, working, result for commands and tests, waiting, success, error) while searching keeps its own clip; the built-in pack declares the same clips it played before. When it declares `clicks`, an interactive click on the head, body, or tail (top 35%, middle, bottom 28%) plays one of that area's clips without repeating the last one; the built-in pack answers body clicks with a poke, a bounce, or a huff and head clicks with a pat or a shy surprise. When it declares `events.balance`, an idle pet's menu offers Check balance: the pet asks the `pet.panel.metrics` owners, plays the tier of the most used reading (six 20% bands, the last only at 100%) and speaks its label, or says that no balance is available after 15 seconds. Balance is never checked automatically. Besides moment lines, the pet speaks the pack's local `turn.success` and `turn.error` lines when a task ends, an `approval.waiting` line while an approval or question waits (shown when the panel is collapsed), and an `idle.long` line once after 20 idle minutes, with a whisper clip when the pack declares `events.whisper` (the built-in pack declares its three mumbling clips). The per-device Speak local lines switch turns all lines off. The autonomous-action list also covers pack-only clips that the chain can draw (category members, turns, and walks), listed by their pack labels.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

- `PetStore` consumes `pet.watch()` through `ctx.remote.$stream`; a carrier loss or terminal failure makes the character `DISCONNECTED` until the next frame.
- Approvals are not decided through the Host. Each Client already answers the forwarded `approval/request` waterfall with ui-approval's `PendingApproval`. The pet reads those objects from `uiSession.sessionStatus`, matches them to Host pending entries by Session and tool call, and answers them through `PetApprovalBridge`, which rejects a second submission from the same surface. The Gateway settles the waterfall with the first result and cancels the other Clients, so the main window and pet window cannot both decide.
- Questions follow the same path: ui-user-questions publishes each request as a `PendingQuestion` in `uiSession.sessionStatus`, and `PetQuestionBridge` answers that object once. Settled review cards and plan reviews are skipped.
- Notifications compare two consecutive Host frames (`diffNotices`); the first frame after connecting never notifies, and subagent Sessions are skipped. In Desktop only the pet window runs ui-pet, so each change notifies once; several Web tabs each notify.
- Closing the panel with its close button, Escape, an outside click, or its trigger preserves the mounted quick-ask draft and attachments. Pending approvals remain in the Host and a different pending request can reopen the panel. The pet declares `pet.panel.metrics`, a root-scoped list slot carrying visibility, focused Session id, task state, and a balance request counter with a callback for `PetBalanceReading` values (used percent and label); the personal-center owner supplies usage and balances and answers balance requests without the pet importing that feature’s runtime.

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

- **Media support** — built-in clips are transparent VP9 videos only; the generated sprite sheets were removed, and their actions wait for AI-video clips. Development packs still use frames. Sounds and talking state are not implemented, some upstream props, effects, and text are cut at the shared crop window, and balance readings cover only DeepSeek CNY wallets and Codex quota; Desktop movement needs platform testing.
- **One approval per Session** — Session status exposes the highest-precedence pending interaction, so a second parallel approval in the same Session is answered in the main window.
- **Re-show entry points** — hiding leaves a small whale handle in the Web page corner. Desktop offers the global shortcut, the Settings page, and on Windows the tray; macOS has no menu-bar entry yet.

<a id="dev-note"></a>
### Dev Note

None.
