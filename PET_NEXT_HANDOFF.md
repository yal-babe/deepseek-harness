# 大肥鱼实现与验证交接

最新反馈的程序改进与剩余正式动画工作见[行为改进交接](PET_BEHAVIOR_HANDOFF.md)。本文件记录此前一批工作的验证范围。
日期：2026-10-17。分支：`studio/main`。完整范围见 [实现方案](PET_IMPLEMENTATION_PLAN.md)。本文记录本轮继续实施后的状态，替代此前仅完成基础定位的交接。

## 本轮已实现

- 保留设置入口“大肥鱼”及鱼形图标。
- 保留 Web 拖动、位置保存和面板独立定位；展开方向选择空间较多的一侧，长内容滚动。
- 接入原仓库全部 16 组、3,444 帧动作，转为透明 VP9 视频，总计约 3.6 MB，按动作加载。源版本、源视频哈希、帧数及输出哈希写入 `motion.json`，保留上游 MIT 许可。
- 增加四组生成动作图集：吐泡泡、打盹唤醒、蹭手摆尾、跃起鞠躬。每组八姿态，4×2 图集，用户已确认动作方向；这些是关键姿态动画，没有插帧成 24 fps。
- Host `/pet-motion` 只提供随包允许列表中的媒体，支持 GET、HEAD、单段 Range，请求路径不参与文件路径拼接；路由随插件卸载而移除。Desktop 复用已有 `dsh-app` HTTP 转发，不新增外部媒体源。
- 支持随机待机，不连续重复上一段；每段结束后开始下一次休息计时。安静 45～90 秒、标准 25～45 秒、活泼 12～22 秒。
- 空闲右键菜单提供原有摸头、戳身体、尾巴、吃 Token、伸懒腰、哈欠，以及新增动作。默认单击仍打开面板；开启部位互动后点击头、身体、尾巴触发动作，双击摸头。
- 工作／等待状态打断装饰动作；拖拽播放悬空片段，松手播放完整落地，再显示最新任务。完成提示可以在 Host 转为空闲后播完，新的任务仍能打断。
- 泡泡可点击戳破；爱心、落地涟漪、完成星光和休息月牙均有数量和时长上限。支持关闭特效和减少动态，默认无声音。
- Web 与 Desktop 支持设备级空闲自主移动，默认关闭。页面输入、工作、审批、打开面板、悬停、隐藏等会暂停对应行为；Desktop 主进程验证布尔 IPC 请求并负责边界限制、动画取消和位置保存。
- 面板、菜单和按钮改用 DSH 通用组件或现有主题变量，输入框适配明暗主题，快速提问目标选择使用通用 Menu。

## 关键代码

- `packages/pet/pet/src/builtin-assets.ts`：内置媒体映射及 HTTP 响应。
- `packages/pet/pet/src/index.ts`：可选 webServer 注入，`pet.pack()` 优先有效开发包，否则提供内置媒体。
- `packages/pet/pet/tools/import-motion.py`：从已检出的 dsh-dafeiyu 帧目录重新编码视频，保留生成图集条目。
- `packages/pet/pet/packs/whaletail-maid/motion.json`：视频与图集记录；资源与许可随 `packs/**` 分发。
- `packages/client/ui-pet/src/client/PetMotion.tsx`、`PetSprite.tsx`、`motion.ts`：动作优先级、媒体播放、随机休息与特效。
- `packages/client/ui-pet/src/client/preferences.ts`：活动频率、互动、自主移动、特效、减少动态均在设备本地保存，不同步到云端。
- `packages/client/ui-pet/src/client/usePagePosition.ts`：Web 位置与自主移动。`page-position.ts`：边界计算。
- `apps/desktop/src/pet-window.ts`：原生窗口有界移动、悬停停止、隐藏与卸载清理。

## 验证

- 相关测试：23 个文件、203 项通过，涵盖 Host、Client、Desktop、托盘与 preload。
- 真实 Loader YAML 组合测试覆盖媒体获取、HEAD、Range、非法请求、图集 MIME 与插件卸载后的路由消失。
- Chromium 实际解码：视频为 206×172，待机时长 10.122 秒，画布采样验证透明背景和不透明角色。
- Chromium 实际组件冒烟：Web 拖动成功，右键触发图集动作；检查明暗主题菜单和面板，无运行时错误。
- 完整制品构建：7 项通过，包括原生插件、Host、Desktop、Client 与 Web 构建。这不是桌面安装包打包验收。
- 双语文档三组配对检查通过；Agent Note 格式检查通过。最终 lint、文案、Web 集成和推送前检查结果见后续补充。

## 后续与验证边界

- Windows／macOS 真机验证仍需进行：点击穿透、显示器缩放、多显示器、全局快捷键、系统通知和原生自主移动。当前 Desktop 依靠模拟 Electron 的测试，不能当作真机验收。
- 四组新动作只有八个关键姿态，仍可继续做更密的中间帧和细节一致性修整；不得把这些图集描述为完整 24 fps 原创视频。
- 完整应用的长期 CPU／内存曲线还未测量；已避免全部帧进入入口 bundle，但不宣称满足某个未测量的内存上限。
- 后续动作批次（鼠标注视、工作眼镜／小本子、举牌、乌云等）按方案效果评估后再排期。
- 开发宠物包仍仅支持原有帧格式；新增视频／图集投影用于内置媒体，没有开放第三方脚本、商城、声音或 Live2D。
- 角色仍固定显示大小；Web 边界按当前 112×142 的交互区域计算。未来增加大小设置时，须同时调整位置、面板及原生窗口约束。
- 临时构建环境 `/tmp/dafeiyu-node` 使用当前 Node 二进制及官方同版本开发头文件；`/tmp/dafeiyu-bin/pnpm` 只用于本机补齐构建环境，不随仓库提交。

## 本机参考与产物

原仓库参考检出位于 `/tmp/dsh-dafeiyu-reference`；后续环境需重新获取。生成图集原始文件保留在任务的 `/workspace/generated_images`，正式使用的四张图集已复制进宠物包，错误布局的生成草稿未随包分发。浏览器截图保存在本机 `/tmp/dafeiyu-browser-*.png`；它们不是必须提交的构建输入。

## 最终检查补充

- 完整 `typecheck` 的 5 项检查已通过。新增真实 Loader 测试使用 Loader 的内置模块注册表装配正式服务，不伪造 Node 内部加载器。
- 文案检查通过，三个双语文档配对检查通过，修改文件的定向 lint 通过。
- 广域 `doc-sync` 未通过：文档站构建触及 JavaScript 堆上限，文档图生成报告已有 `plugin-catalog/install-progress` 的 `CatalogInstallProgress` 类型链接未分类；后续检查未全部跑完。
- 完整 Web 回放检查未通过：`document-preview.e2e.ts` 的五个文档预览用例超时；其余广域运行已停止，没有宣称整个 Web 测试通道通过。桌宠自己的 Loader、Client 与 Chromium 组件冒烟结果独立记录在上文。

- 新增落地后立即选择动作的时序回归：明确的菜单选择在落地完成后执行，工作期间的旧装饰请求不补播；Chromium 实际组件回归已重跑通过。
- 此前全量 GUI 检查出现账号设置用例失败；本轮以桌宠及相邻 Desktop 的定向回归为依据，没有宣称全量 GUI 检查通过。
