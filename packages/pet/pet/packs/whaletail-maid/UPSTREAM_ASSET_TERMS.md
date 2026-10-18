# Upstream asset terms: PC2005-cloud/dsh-pet

The whale-tail maid character, its animations, and the frames, videos, and sprite sheets in this pack derive from [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) by PC2005-cloud. Original author: <https://github.com/PC2005-cloud/dsh-pet>.

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
- The 13 further `.webm` clips (click_bounce, click_shy, click_huff, look_around, crab_walk, float_step, turn_run, and the six balance_* tiers) are cropped and re-encoded directly from the upstream `assets/webm` files at the merge baseline. They are upstream assets under the terms above.
- The `assets/frames/*.webp` fallback frames show the same upstream character; this pack does not record their exact import path, and treats them as upstream assets under the terms above.
- The 14 generated sprite sheets were generated for dsh studio from a reference of the same character. This pack treats them as derivative works of the upstream character and applies the same terms, including the credit requirement.
- qcytsn/dsh-dafeiyu labels these assets MIT; the upstream README terms above are more restrictive, and this pack follows the upstream terms.
- These assets are for non-commercial use only. Before any commercial distribution of dsh studio, remove or replace them (for example with self-produced character footage).
- The upstream font (`上首软糖体.ttf`) and meme images (`assets/memes/`) are not shipped; the upstream repository states no license for them.
- Any page, README, or settings screen that introduces or shows this character links <https://github.com/PC2005-cloud/dsh-pet>.
