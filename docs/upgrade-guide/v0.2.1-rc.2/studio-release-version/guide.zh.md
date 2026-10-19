---
kind: upgrade-guide
description: DSH Studio 桌面端改用独立产品版本及可配置更新源，不再沿用上游的发布标识。
---

# Studio 发布版本

[English](guide.md) | 中文

## 变更

Studio 桌面端从 `0.1.0` 开始独立发布，由 `apps/desktop/studio-release.json` 声明；内置 Harness 包保留上游版本。Studio Cloud 通过 `services/studio-cloud/package.json` 独立管理版本，当前为 `0.1.0`。

未配置 `DSH_STUDIO_UPDATE_URL` 的 Studio 安装包不内置更新源。安装后可在通用设置保存设备级更新源。除非显式配置，否则不写入上游强制升级策略。

## 迁移

1. 显示 `0.2.1-rc.2` 的现有安装无法自动升级到数值更低的 Studio `0.1.0`。首次改用 Studio 发布线需要手动安装；若安装器拒绝版本切换，先卸载程序并保留用户数据，再安装 Studio。保留 `$DSH_HOME`、项目及云服务数据卷。
2. 在 `apps/desktop/studio-release.json` 维护 Studio 版本；在 `services/studio-cloud/package.json` 及其锁文件独立维护服务端版本，不要为匹配 Studio 而重写上游包版本。
3. 打包时配置 `DSH_STUDIO_UPDATE_URL`，或在通用设置保存对应系统的通用更新目录并重启客户端。稳定版使用 `latest`，预发布使用 `nightly`。
4. 按[Studio 在线更新](../../../user/studio-online-updates.zh.md)启用可选 Docker 执行器。保持现有 Compose 项目名，以继续使用原有数据库与应用数据卷。
5. 客户端设置分别显示已安装 Studio 版本与内置运行时版本；服务端通过 `/v1/version` 和管理概览展示已安装版本。
