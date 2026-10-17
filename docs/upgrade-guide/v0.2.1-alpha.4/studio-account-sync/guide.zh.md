---
kind: upgrade-guide
description: "启动不再要求模型认证，Studio 上传分类替代自动逐对象同步。"
---

# Studio 身份与可选同步

[English](guide.md) | 中文

## 变更

侧边栏显示 DSH Studio 身份。DeepSeek、Codex、Antigravity 和 API Key 认证在设置中独立配置。启动时可以不登录 Studio 或模型账号，直接在本地使用。`ui-settings-models.credentialOnboarding` 默认改为 `false`，仍可手动配置模型认证。

Studio 登录后下载已有云端数据，上传分类与自动同步需要显式开启。已有逐对象选择仍可读取，但需在云同步中开启自动同步才会后台运行。模型凭据使用独立同步加密口令，找回 Studio 密码无法恢复此口令。

## 迁移

1. 打开设置 → 云同步，登录后勾选上传分类，并按需开启自动同步。
2. 同步模型凭据时输入并确认至少 12 个字符的独立口令，其他设备使用相同口令。重启 Host 或退出 Studio 后需重新解锁。
3. 在账号余额或模型设置中配置提供商账号。退出 Studio 保留本地数据及模型凭据。
4. 确认侧边栏显示 Studio 账户名，且仅勾选分类上传。项目需要绑定本地工作区，插件清单恢复后需审阅再安装。

支持的偏好、加密与恢复限制见[同步包](../../../../packages/sync/studio-cloud/README.zh.md)。
