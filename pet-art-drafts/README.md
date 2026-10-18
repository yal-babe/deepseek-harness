# Dafeiyu animation drafts

English | [中文](README.zh.md)

`bubbles-64-draft.png` is a generated bubble-blowing animation draft based on the approved character, targeting an 8×8 sheet of 64 frames. The original is 1254×1254 RGBA. It is absent from the shipped motion manifest and does not count toward the ten additional action sets.

Review character baselines, cell alignment, face and hand continuity, the bubble release position, and the transition between the last and first frames. Inspect individual frames and normal-speed playback in the actual player before replacing a production asset; cell count alone does not establish smooth motion.

Source: the project's existing character reference, processed by the image-generation tool. This draft does not change the source or license records of the upstream MIT assets. Further production keeps the approved character design; the ten additional sets and four replacements are specified in the [implementation plan](../PET_BEHAVIOR_IMPROVEMENT_PLAN.md).

`character-reference.png` preserves the original eight-pose bubble sheet used as the character reference before replacement. Production now uses fourteen reviewed and normalized source sheets (666 actual frames); see the [motion manifest](../packages/pet/pet/packs/whaletail-maid/motion.json) and [import recipe](../packages/pet/pet/tools/generated-motion.recipe.json). The older 64-frame target draft remains excluded.
