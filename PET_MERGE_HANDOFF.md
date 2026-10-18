# dsh-pet 合并（M0–M5）交接记录

日期：2026-10-18。分支：`studio/pet-merge`，未推送。本文件记录把上游 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（合并基线 commit `091b27b`，插件 0.3.7）中值得保留的逻辑、素材和交互合入 Studio 内置桌宠的结果、验证范围和保留事项。实现依据是仓库外的合并方案 `dsh-pet-merge-plan.zh.md`（M0–M5）和用户决定：Q2 不做模型碎碎念与对话，Q3 不做多开，Q4 不做 Safari。

## 提交清单

基线是提交“fix(pet): preserve source resolution and refine local animation behavior”，合并工作是其后的全部提交。查看完整列表与哈希：`git log --oneline --reverse 'studio/pet-merge^{/preserve source resolution}..studio/pet-merge'`。

- **M0 许可与署名**：fix(pet): label whaletail-maid assets with the upstream dsh-pet terms；feat(ui-pet): credit the dsh-pet character source on the settings page；docs(pet): add a NOTICE for code adapted from PC2005-cloud/dsh-pet。
- **M1 Host 逻辑**：feat(pet): pick local lines by time of day and festival；feat(pet): announce only the final round of a goal；feat(pet): hold a result while subagent descendants still work；feat(pet): carry the local time-of-day and festival moment in snapshots；fix(pet): report the last in-progress todo as current。
- **M2 素材描述与动画链**：feat(pet): validate motion.json and keep import tools from overwriting each other；feat(pet): import the first batch of dsh-pet clips with categories；feat(pet): offer the pack's local line table with the pack；feat(ui-pet): draw autonomous clips from weighted pack categories and keep turned facing；feat(ui-pet): open actions by category in the right-click menu；feat(ui-pet): speak time-of-day and festival lines in the bubble。
- **M3 物理、行走与 Windows 兜底**：feat(pet): import walking clips with travel measured from their steps；feat(ui-pet): port the dsh-pet drag and throw physics；feat(ui-pet): throw the Web character with drag physics；feat(desktop): throw the pet window across displays；feat(ui-pet): walk with measured travel on Web and Desktop；feat(desktop): add Windows click-through and keep-on-top safeguards；fix(ui-pet): keep the JSDoc on the page point type；build(pet): publish the pet NOTICE files under the files policy。
- **M4 可选能力**：feat(pet): import the balance tiers and record event tiers and click areas；feat(ui-pet): play pack event tiers, click responses, balance, and local lines；feat(ui-personal-center): answer pet balance requests。
- **M5 交接**：docs(pet): add the dsh-pet merge handoff（本文件）。

## 各阶段交付

- **M0**：内置包 `whaletail-maid` 的素材许可由误写的 MIT 改为上游素材条款（非商用、二创须署名）；包内新增 `UPSTREAM_ASSET_TERMS.md` 逐字引用上游 README 许可节并固定 commit；设置页末尾显示角色来源与链接；`packages/pet/pet/NOTICE`、`packages/client/ui-pet/NOTICE` 附上游 MIT 原文。
- **M1**：本地时段／节日台词选择（`./time-context`、`./lines`，不调用模型）；目标（goal）只在最后一轮报成功或失败；子代理后代仍在工作时成功结果先保持（配置 `holdCompletionsWhileBusy`，默认开；`completionQuietMs`，默认 1500）；快照新增 `moment` 字段（改了 PetSnapshot 线上类型，需重新生成 Typert）；以最后一个进行中的 todo 为当前项。
- **M2**：`motion.json` 升到格式 2 并有浏览器安全的校验器（`./motion`）；第 1 批上游片段（三个点击回应、东张西望转身，5,799,580 字节）与分类；`pet.pack()` 携带包内台词表；自主动画链按分类权重抽取，转身后保持朝向；右键菜单“动作…”按分类→片段两级展开；时段／节日变化时气泡说本地台词。
- **M3**：三个行走片段（5,411,888 字节），按脚底接触点测得每帧位移；移植上游拖拽弹簧、甩抛、反弹、落地摩擦物理；Web 设备偏好“甩动抛出”；Desktop 跨显示器抛掷，主进程校验并限速、限制在显示器内、只保存落点；行走按媒体播放位置移动页面或窗口；Windows 默认开启指针轮询（恢复点击穿透判断）与置顶看门狗，环境变量 `DSH_PET_POINTER_POLL`、`DSH_PET_TOPMOST_WATCHDOG`（`1`／`0`）可在任何平台开关；不加应用级 `--force-device-scale-factor`。
- **M4**：第 3 批导入六档余额片段（8,415,507 字节）；`motion.json` 记录上游事件档位（余额 6 档、工作状态 6 档；碎碎念档位已支持，素材未导入）和按部位的点击回应。任务状态按包内工作状态档位播放（内置包输出不变）；可交互单击按头部（上 35%）、身体、尾巴（下 28%）轮换包内回应；包有余额档位时，空闲菜单出现“查看余额”，桌宠经 `pet.panel.metrics` 请求个人中心，按已用比例最高的读数播放对应档位并说出文案，15 秒无读数则说“暂时查不到余额”，从不自动查询；任务成功／出错、审批等待、空闲满 20 分钟时说包内本地台词（`turn.success`、`turn.error`、`approval.waiting`、`idle.long`），设备级“说本地台词”可全部关闭；允许自主播放列表扩展到仅存在于宠物包的片段（分类成员、转身、行走），设置页按包内名称列出。个人中心对余额请求刷新数据后回报：DeepSeek 人民币钱包按上游 ¥20 参考值计算（透支视为用完），Codex 取已用最多的标准额度窗口；美元钱包和未知值不回报。

本阶段新增媒体共 8,415,507 字节，未超过本阶段约 10 MB 的上限；合并以来新增媒体合计 19,626,975 字节。重新运行导入脚本时，既有片段逐字节不变。

## 许可与署名现状

- **代码**：移植自上游的源文件以 `Adapted from PC2005-cloud/dsh-pet (MIT), commit 091b27b, <上游路径>` 开头（单个改编函数在函数体内注释），`git grep "Adapted from PC2005-cloud/dsh-pet"` 可列出；`packages/pet/pet/NOTICE` 与 `packages/client/ui-pet/NOTICE` 附 MIT 原文，并登记在包文件策略中随包发布。`THIRD_PARTY_NOTICES.md` 由脚本生成，不手改。
- **素材**：上游动画、提示词和源视频仅限非商业使用，衍生作品在介绍、展示、分发处须注明 <https://github.com/PC2005-cloud/dsh-pet>。已在 `pet.json` 的 `license`、[包内条款](packages/pet/pet/packs/whaletail-maid/UPSTREAM_ASSET_TERMS.md)、`MOTION_ASSETS.txt`、pet 与 ui-pet 的 README 双语文档、Desktop README 和设置页署名。若 Studio 将来商业分发，必须先移除或替换这些素材。
- **未分发**：上游字体与表情包（来源许可不明）均未随包分发。

## Windows 手测清单

以下项目只在 Linux 上做了单元测试与构建，尚未在 Windows 真机验证。

1. **多显示器与缩放**：在 100%／125%／150%／200% 缩放的不同显示器间拖动桌宠；松手后角色身体留在工作区内，按显示器布局保存位置，插拔显示器后回到保存位置；画面清晰，点击区域与角色对齐。
2. **抛掷**：开启“甩动抛出”后快速甩动，窗口在工作区边缘和顶部反弹、落地减速，可在空中接住；跨显示器缝隙时不卡住；任务栏区域不被落点占用；3 秒无上报时抛掷结束。
3. **行走**：开启自主移动，行走片段移动窗口时脚步不打滑，到工作区边缘停下或转身，镜像片段反向行走，拖动或任务开始时中止并保存位置。
4. **点击穿透**：透明边缘的点击落到下层窗口，角色和气泡可点击；切换全屏应用或 Alt+Tab 后 Electron 不再转发鼠标移动时，轮询能恢复角色上的输入；拖动过程不被打断；面板或菜单打开时保持可交互。
5. **置顶**：最大化主窗口或其他应用后，桌宠在约 5 秒内回到最上层；全屏视频不黑屏，并记录桌宠是否覆盖全屏视频。
6. **开关**：`DSH_PET_POINTER_POLL=0`、`DSH_PET_TOPMOST_WATCHDOG=0` 分别关闭两项兜底；`DSH_DESKTOP_PET=0` 不打开桌宠窗口。
7. **托盘**：托盘菜单显示／隐藏桌宠，与设置页和 Web 桌宠同步。
8. **透明视频解码**：新增的点击、行走和余额片段在 Windows Chromium 中背景透明，没有黑框。
9. **查看余额（M4）**：在 Desktop 桌宠窗口右键选择“查看余额”；已登录 DeepSeek 人民币钱包时播放对应档位并显示金额，未登录或刷新失败时 15 秒内显示“暂时查不到余额”；面板展开与收起时都能工作。
10. **点击回应（M4）**：开启“可交互”后分别单击头部、身体、尾巴，回应随机且不连续重复；双击触发头部回应；回应播放中或距上次不足 1.2 秒的单击被忽略。
11. **台词（M4）**：任务成功／出错后显示对应台词并在 8 秒后消失；审批等待时收起面板可见等待台词，审批结束后消失；空闲 20 分钟显示一次空闲台词；关闭“说本地台词”后都不再显示。
12. **设置（M4）**：在主窗口设置页切换“角色包动作”各项和“说本地台词”，桌宠窗口的自主动画与台词随之变化，重启后保持。

## 延期与未做事项

- **碎碎念片段**：上游 3 段碎碎念中已导入发呆碎碎念（`whisper_daydream`，同时属于小动作分类），擦桌和对屏两段仍未导入；在配方中追加并写入 `events.whisper` 即可生效。
- **第 2 批常用片段**：小动作、玩耍、吃什么、时节、文字类片段每段约 1–1.8 MB，未导入。
- **其他余额来源**：opencode-go 与 commandcode 在 Studio 中没有额度或账号拥有者，接入需要新增带凭据的网络请求，未做。美元钱包没有可靠参考值，不回报。
- **自动余额提醒**：只在用户点“查看余额”时播放，不定时查询或提醒。
- **按设计决定不做**：模型碎碎念、对话、表情包和 `/chat` 命令（Q2）；多开与桌宠碰撞（Q3）；Safari／HEVC 透明视频（Q4）。
- **台词文本**：只使用包内既有的台词键，没有引入上游台词文本。
- **平台验证**：Windows 清单未执行；macOS 未验证。
- **既有检查失败**：`verify-repository-references` 报告 `PET_PHASE0_HANDOFF.md` 中的提交哈希；`check-workspace-constraints` 报告多个包版本与根版本不一致。两者都早于本次合并。

## 运行素材导入脚本

脚本位于 `packages/pet/pet/tools/`，需要带 `libvpx-vp9` 的 FFmpeg（FFmpeg 自带的 VP9 解码器会丢弃 alpha），编码统一为 412×344、`libvpx-vp9`、`yuva420p`、crf 18。

- `python3 packages/pet/pet/tools/import-dshpet-webm.py /path/to/dsh-pet [recipe.json]`：从上游仓库的固定 commit 用 `git show` 读取 webm（不读工作区），按 `tools/dshpet-webm.recipe.json` 的批次裁切重编码，写入 `motion.json` 的片段、分类、动画链权重、事件档位与点击回应，并记录源与输出 SHA-256。新增批次时在配方中追加条目再运行。
- `python3 packages/pet/pet/tools/import-motion.py /path/to/dsh-dafeiyu`：按 dsh-dafeiyu 帧清单重编码原有视频片段；保留带来源类型的片段、分类、动画链、事件档位、点击回应和上游基线记录。
- `python3 packages/pet/pet/tools/import-ai-video.py SOURCE --name NAME --tool TOOL --prompt TEXT [--category ID] [--follow CLIP] [--despill] [--dry-run]`：导入一个 AI 生成的绿幕（或已带 alpha 的）视频，按 `idle` 站姿归一化后编码，逐段检查通过才写入 `motion.json` 的 `ai-video` 记录；步骤见 [AI 视频片段指南](packages/pet/pet/tools/AI_VIDEO_CLIPS.zh.md)。原先的生成图集导入脚本及配方已随十四组图集一并移除。

导入后运行 `packages/pet/pet/tests`，确认 `motion.json` 校验与媒体集成测试通过，并核对新增字节数。

## 验证记录

- **类型检查**：`tsc -b --force` 覆盖 `packages/pet/pet`、`packages/client/ui-pet`、`packages/client/ui-personal-center`、`apps/desktop`，通过。
- **包级测试**：pet 104、ui-pet 166、ui-personal-center 24、Desktop 桌宠相关 43（`pet-window`、`pet-position`、`pet-fallbacks`）、`client-bundle-purity` 47、`check-workspace-constraints.spec` 135，全部通过。
- **文档检查**：`verify-translation-pairing`、`verify-md-links`、`verify-md-wrap`、`verify-export-jsdoc`、`verify-client-ui-i18n`、`verify-doc-budgets` 通过。
- **构建**：dsh-pet（tsc、tsdown、Typert 生成）、ui-pet 与 ui-personal-center 打包、Desktop 构建均成功。

## Windows 重建顺序

拉取分支后在 Windows 上依次执行：dsh-pet 的 `tsc -b`、tsdown 和 `scripts/generate-typert.ts`（快照与 `PetMotionView` 类型有变化）；`pnpm --filter @deepseek-ai/dsh-client-ui-pet run bundle`；`pnpm --filter @deepseek-ai/dsh-client-ui-personal-center run bundle`；`pnpm --filter @deepseek-ai/dsh-desktop run build`。M4 未改 Desktop 源码，但从 M3 之前的版本升级时仍需重建 Desktop。

## 后续建议

1. **AI 视频阶段 0**：按 AI 视频动画方案（仓库外 `pet-refactor-plan.zh.md`）检查 FFmpeg、Python 与候选生成工具，让一段绿幕测试片段走完抠像、归一化和编码，并给出参考图草案和逐片段检查容差；`motion.json` 已有 AI 视频来源记录字段，可直接承接。
2. **按预算补素材**：下一阶段优先导入 3 段碎碎念（约 3.3 MB），再分批导入第 2 批常用片段，每批记录字节数与解码抽检。
3. **执行 Windows 清单**，把结果补进本文件；根据实测调整指针轮询与看门狗的默认值。
4. **余额扩展**：如需定时提醒，先确定“不打扰”的频率与开关；如需其他服务，先在 Studio 中建立对应的额度拥有者。
5. **商业分发前**：用自有角色素材替换上游素材。
