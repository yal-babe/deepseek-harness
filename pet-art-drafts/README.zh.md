# 大肥鱼动作制作样稿

[English](README.md) | 中文

`bubbles-64-draft.png` 为本轮生成的吐泡泡连续帧样稿，参考现有已确认角色，目标为 8×8 共 64 格。原图为 1254×1254 RGBA，尚未接入正式动作清单，也不计入新增十套动作。

样稿需要继续检查角色基线、格子切分、脸部与手部连续性、泡泡释放时的位置跳变，以及首尾衔接。须在真实播放器中逐帧和正常速度检查后才能替换正式资源；不能仅以格子数量宣布达到平滑动画要求。

来源：本项目既有角色参考图，经图像生成工具制作。该样稿不修改上游 MIT 资源的来源与许可证记录。后续制作仍保持原角色外观，具体十套动作和四套重制要求见[实施计划](../PET_BEHAVIOR_IMPROVEMENT_PLAN.md)。

`character-reference.png` 保留替换前用于角色参考的原八姿态吐泡泡图集。正式资源现为十四组经检查和归一化的图集，共 666 个实际帧，详见[动作清单](../packages/pet/pet/packs/whaletail-maid/motion.json)及[导入配方](../packages/pet/pet/tools/generated-motion.recipe.json)。旧的 64 帧目标样稿仍不参与正式播放。
