# DSH Studio 上游固定版本

[English](upstream-pin.md) | 中文

本文记录 Studio 分支所跟踪的 DeepSeek Harness 提交。

## 固定版本

| 字段 | 值 |
| --- | --- |
| 上游远端 | `upstream` → `https://github.com/deepseek-ai/deepseek-harness.git` |
| 固定提交 | `571902028a75c64c1d767f4ae5fd099485f0ddf0` |
| 上游版本 | `0.2.1-alpha.3` |
| Studio 分支 | `studio/main` |

固定提交表格字段是仓库引用检查的明确例外。

## 同步流程

1. `git fetch upstream`
2. 在明确的升级 PR 中，将 `upstream/master` 合并或向前合并到 `studio/main`。
3. 在同一 PR 中更新本文件的固定提交和版本。
4. 合并后重新运行 mac-arm64、mac-x64 和 win-x64 的桌面冒烟检查。

同步时不重写或删除已提交的 Studio 定制历史。优先向前合并；只有重写尚未作为受保护基线共享的 Studio 自有分支时，才使用 `--force-with-lease`。

## 已核对的 Studio 扩展接口

以下 Host 接口是 Studio 定制所依赖的基线：

- `ctx.llm.registerAdapter` — 模型提供方
- `ctx.authorization.registerFlow` — 浏览器与设备码登录
- `ctx.credentials` 引用和记录 — 机密存储
- `ctx.sessionPersistence` — 追加、刷写与恢复
- `OPTIONAL_BUNDLES` — 官方可选插件，包括 Agent Teams

产品方案：[dsh-workbench-proposal.md](dsh-workbench-proposal.zh.md)。
