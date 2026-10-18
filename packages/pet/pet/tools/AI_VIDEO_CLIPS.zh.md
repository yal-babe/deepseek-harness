# 添加 AI 视频片段

内置宠物包 `whaletail-maid` 现在只随包附带透明 VP9 视频。原先的十四组生成图集已移除，它们的动作名保留为槽位：用 `import-ai-video.py` 以同名导入 AI 生成的视频后，客户端无需改代码即可播放。本文说明一个片段从绿幕视频到随包媒体的完整步骤。

## 准备

- 工具：带 `libvpx-vp9` 的 FFmpeg 与 ffprobe（FFmpeg 自带的 VP9 解码器会丢弃 alpha），Python 3.10 或更新版本；不需要其他 Python 依赖。
- 源视频：纯色绿幕（`#00FF00`）背景的 mp4，固定机位，角色全程完整入画且不贴边。需要站立衔接的一端（见下文 `--stand`）应与 `idle` 第一帧的站姿一致，脚底在同一水平线。
- 存放位置：源视频放在仓库和宠物包之外，例如 `~/dsh-pet-sources/ai-video/sleep_enter.mp4`，不要提交；宠物包只带编码后的 `assets/motion/<名称>.webm`。用 `--source-ref` 记录日后找到源文件的方式（如 `ai-video/sleep_enter.mp4`），脚本同时记录源文件的 SHA-256。
- 生成记录：记下生成工具、模型、提示词（或提示词文件及章节标题）、参考图、种子和日期，导入时如实填写，不要补写不知道的信息。

## 槽位

| 名称 | 播放时机 | 导入要点 |
| --- | --- | --- |
| `pillow_enter`、`pillow_loop`、`pillow_wake` | 休息状态首选：入睡、持续睡眠、醒来；优先于内置的上游小憩 `doze_*` | 三段使用同一机位；`pillow_loop` 加 `--follow pillow_enter`，`pillow_wake` 加 `--follow pillow_loop`；不加入分类 |
| `sleep_enter`、`sleep_loop`、`sleep_wake` | 休息状态次选（没有 `pillow_loop` 时） | 同上，换成 `sleep_*` |
| `sleep` | 菜单“休息一下”的单段动作 | 两端站立；加入分类后才出现在菜单 |
| `swim_start`、`swim_loop`、`swim_stop` | 有 `swim_loop` 后开启自主滑行：起步、定向游动、停下 | 生成时角色须面朝左，客户端向右移动时镜像；`swim_loop` 加 `--follow swim_start`，`swim_stop` 加 `--follow swim_loop`；不加入分类 |
| `celebrate` | 任务成功时以 35% 概率替代 `success`；菜单“开心庆祝” | 两端站立 |
| `thinking_chin`、`thinking_idea`、`work_read` | 思考状态在 `thinking` 与这些片段间轮换；有 `thinking_chin` 后上游 `thinking_deep` 退出轮换 | 两端站立；不加入分类 |
| `bubbles`、`play_bubbles`、`play_ball`、`play_tailspin` | 娱乐状态的自主动作及菜单 | `--category play` |
| `idle_daydream`、`idle_observe`、`idle_groom` | 空闲状态的自主动作及菜单；有 `idle_daydream` 后上游 `whisper_daydream` 不再自主播放 | `--category small` |
| `nuzzle` | 菜单“蹭蹭手” | `--category interact` |

内置包有分类，菜单和自主动作都从分类中选取，因此菜单或自主动作要用的片段必须用 `--category` 加入一个分类（每个片段最多属于一个分类）。休息、游动和思考的分段由客户端按名称直接调用，不要加入分类，否则会被当作普通动作随机播放。上表以外的新名称也可以导入，此时用 `--label-zh` 与 `--label-en` 提供菜单名称。

缺少片段时客户端播放替代：休息播放上游小憩 `doze_enter`／`doze_loop`／`doze_wake`（或被惊醒 `doze_startle`）；娱乐从 `click_bounce`、`click_huff`、`turn_run` 中抽取；没有 `swim_loop` 时只靠 `crab_walk`、`float_step` 行走移动；庆祝播放 `success`；思考在 `thinking` 与 `thinking_deep` 间轮换。上游片段的名称不占用槽位，导入同名 AI 视频片段后自动优先。

## 导入命令

在 `packages/pet/pet` 目录运行。先加 `--dry-run` 只检查不写入，确认通过后去掉 `--dry-run` 再运行一次：

```sh
python3 tools/import-ai-video.py ~/dsh-pet-sources/ai-video/sleep_enter.mp4 --name sleep_enter --tool "<生成工具>" --model "<模型>" --prompt-file ~/dsh-pet-sources/ai-video/prompts.md --prompt-section "<章节标题>" --reference ../../../pet-art-drafts/character-reference.png --source-ref ai-video/sleep_enter.mp4 --despill --dry-run
python3 tools/import-ai-video.py ~/dsh-pet-sources/ai-video/sleep_loop.mp4 --name sleep_loop --follow sleep_enter --tool "<生成工具>" --prompt "<提示词原文>" --source-ref ai-video/sleep_loop.mp4 --despill
python3 tools/import-ai-video.py ~/dsh-pet-sources/ai-video/play_ball.mp4 --name play_ball --category play --tool "<生成工具>" --prompt "<提示词原文>" --source-ref ai-video/play_ball.mp4 --despill
```

Windows 上把 `python3` 换成 `py -3`，并把每条命令写在一行内。常用参数：

- `--prompt TEXT` 或 `--prompt-file FILE --prompt-section TITLE`：二选一，必填，连同 `--tool` 写入来源记录；提示词文件只记录文件名、章节和摘要。
- `--key green|blue|none|0xRRGGBB`：抠像颜色，默认 `green`；已带 alpha 的源（WebM、ProRes 4444）用 `none`。`--similarity`（默认 0.12）、`--blend`（默认 0.06）调整抠像范围，`--despill` 去除边缘绿色溢出。
- `--stand auto|first|last|both|none`：哪一端是站姿。默认按名称：`*_enter`、`*_start` 为第一帧，`*_wake`、`*_exit`、`*_stop` 为最后一帧，`*_loop` 两端都不是，其余两端都是。站立端会按 `idle` 第一帧的高度、脚底线和水平中心缩放定位。
- `--follow CLIP`：本段接在另一个 AI 视频片段之后，沿用它的缩放和位移，并检查本段第一帧与它最后一帧衔接；两端都不站立的片段必须提供。
- `--start`、`--duration`：只截取源视频中的一段（秒）。
- `--loop`：循环播放（`*_loop` 自动循环）；`--turn` 表示播放后朝向反转；`--no-mirror` 禁止镜像。
- `--category ID`：追加到已有分类；`--replace`：重新导入已有的 AI 视频片段；`--pack DIR`：指定其他宠物包。

脚本只管理来源类型为 `ai-video` 的片段，拒绝覆盖其他导入工具的片段。重新运行 `import-dshpet-webm.py` 或 `import-motion.py` 时，AI 视频片段及其分类成员都会保留。

## 逐段检查

脚本把编码结果重新解码，抽取 12 帧检查，任一项失败都不写入（除非确认后加 `--force`）：

1. 每个抽样帧都同时有不透明和透明像素。
2. 没有不透明像素接触画布边缘（角色未被裁切）。
3. 不透明像素中残留绿色不超过 1%，否则加 `--despill` 或调大 `--similarity`。
4. 站立端的脚底线和水平中心与 `idle` 第一帧相差不超过 `--tolerance`（默认 6 像素），高度相差不超过 10%。
5. 循环片段最后一帧与第一帧的 alpha 差不超过 2%。
6. 使用 `--follow` 时，本段第一帧与前一段最后一帧的 alpha 差不超过 2%。

自动检查通过后再人工看一遍：在 Web 或桌面端触发该动作，确认画面无闪烁、无残留绿边、与相邻分段衔接自然、镜像方向正确。

## 导入之后

1. 查看 `git diff packages/pet/pet/packs/whaletail-maid/motion.json`，确认新片段的 `source` 记录（`kind` 为 `ai-video`、生成工具、提示词、抠像与 `normalization`）以及分类变化。
2. 在 `packs/whaletail-maid/MOTION_ASSETS.txt` 补充一行说明新片段的来源；描绘上游角色的片段沿用上游素材条款（禁止商用并署名 <https://github.com/PC2005-cloud/dsh-pet>）。
3. 在仓库根目录运行 `node_modules/.bin/vitest run packages/pet/pet/tests packages/client/ui-pet/tests --coverage.enabled=false`。
4. 重新构建 dsh-pet（`tsc -b`、`tsdown`），并重新打包桌面端，使新的媒体文件随包分发。
5. 提交 `assets/motion/<名称>.webm`、`motion.json` 和说明文件；源视频不提交。
