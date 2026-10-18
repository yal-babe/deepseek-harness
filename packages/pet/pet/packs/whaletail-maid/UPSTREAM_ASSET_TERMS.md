# Upstream asset terms: PC2005-cloud/dsh-pet

The whale-tail maid character, its animations, and the frames and videos in this pack derive from [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) by PC2005-cloud. Original author: <https://github.com/PC2005-cloud/dsh-pet>.

## Terms quoted from upstream

The `## 许可` section of the upstream root `README.md`, quoted verbatim. The text is identical at both pinned commits below:

> - 代码：MIT
> - 素材（动画/提示词/源视频）：允许开源使用，**禁止商用**
> - **二次创作（二创）约定**：基于本项目的衍生 / 改版 / 换皮作品，在**任何介绍、展示、分发该作品的地方**，须附上原作者 GitHub 地址：<https://github.com/PC2005-cloud/dsh-pet>

The `## 📄 许可` section of the upstream `dsh-pet/README.md` at the baseline commit, quoted verbatim:

> - 代码：MIT
> - 素材（动画/提示词/源视频）：允许开源使用，**禁止商用**

English summary (not a substitute for the quoted text): code is MIT; assets (animations, prompts, source videos) may be used in open source but not commercially; derivative, modified, or reskinned works must give the original author's GitHub address wherever the work is introduced, shown, or distributed.

The upstream `LICENSE` files (repository root and `dsh-pet/`) contain the standard MIT text with `Copyright (c) 2026 PC2005-cloud` and no asset exception; the README terms above add the asset restriction. [MOTION_LICENSE.txt](MOTION_LICENSE.txt) and [LICENSE](LICENSE) preserve that MIT text, which covers code only.

## Pinned upstream commits

| Role | Commit | Notes |
| --- | --- | --- |
| Source of the 16 shipped videos | `549fff2ea33c2acfb16612c76912c6137da4a758` | Recorded in `motion.json` → `upstream.commit` |
| Merge baseline | `091b27b40f9eeecc814bedb691fe214ec2b48299` | Plugin `dsh-pet/package.json` version `0.3.7`; recorded in `motion.json` → `upstreamBaseline`; the 14 upstream source videos have the same SHA-256 here as at the source commit |

## How these terms apply to this pack

- The 16 `.webm` clips are cropped, scaled, and re-encoded from upstream animations through qcytsn/dsh-dafeiyu frames. They are upstream assets under the terms above.
- The 94 further `.webm` clips are cropped and re-encoded directly from the upstream `assets/webm` files at the merge baseline; together with the 16 above they cover all 106 upstream clips. They are: click_bounce, click_shy, click_huff, look_around, crab_walk, float_step, turn_run, the six balance_* tiers, doze_enter, doze_loop, doze_wake, doze_startle, whisper_daydream, and thinking_deep; the small actions hum_tune, desk_tap, squat_squish, curtsy, startled_jump, twirl_show, tail_slap, mirror_check, outfit_swap, jot_notes, write_code, brush_teeth, fan_cool, whisper_wipe_desk, whisper_screen; the dances maid_dance, otaku_dance, sway_dance; the talents violin, flute, card_magic, dove_magic, juggling, conjure_flower, blue_whale, butterfly_bloom; the games rubiks_cube, toy_car, game_rage, water_gun, balloon, kite, unwrap_gift, spin_top, pet_cat, rocking_horse, shuttlecock, gomoku, swing_ride, jump_grab, animal_friends; the meals and snacks breakfast, lunch, dinner, plain_rice, snack_munch, snack_caught, ice_cream, hairy_crab, tanghulu, longevity_noodles, watermelon, hotpot, what_to_eat; and the seasons and festivals falling_leaves, mooncake, snowman, fireworks, zongzi, nian_gao, qingtuan, laba_porridge, chongyang_cake, red_envelope, write_fu, needle_threading, lion_dance, pumpkin_treats, dogwood_chrysanthemum, river_lantern, little_ghost, christmas_tree, sky_lantern, tangyuan, dumplings. They are upstream assets under the terms above.
- The `assets/frames/*.webp` fallback frames show the same upstream character; this pack does not record their exact import path, and treats them as upstream assets under the terms above.
- The pack no longer ships generated sprite sheets. Any AI-video clip later added with `tools/import-ai-video.py` and showing the same character is treated as a derivative work of the upstream character under the same terms, including the credit requirement; its generation is recorded in `motion.json`.
- qcytsn/dsh-dafeiyu labels these assets MIT; the upstream README terms above are more restrictive, and this pack follows the upstream terms.
- These assets are for non-commercial use only. Before any commercial distribution of dsh studio, remove or replace them (for example with self-produced character footage).
- The upstream font (`上首软糖体.ttf`) and meme images (`assets/memes/`) are not shipped; the upstream repository states no license for them.
- Any page, README, or settings screen that introduces or shows this character links <https://github.com/PC2005-cloud/dsh-pet>.
