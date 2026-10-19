---
description: 配置独立 Studio 版本号、桌面更新源和管理员控制的 Docker 在线更新，保留用户数据卷。
---

# Studio 在线更新

[English](studio-online-updates.md) | 中文

## 版本号

桌面产品版本由 `apps/desktop/studio-release.json` 维护，从 `0.1.0` 开始。Electron 安装包元数据及在线升级比较使用此版本；内置 Harness 包保留上游版本。Studio Cloud 使用独立的 `services/studio-cloud/package.json` 及其锁文件，也从 `0.1.0` 开始。两端无需同时发布，同步协议仍为版本 1。

旧的上游编号安装首次改用独立桌面发布线需要手动安装：更新器会正确地将 `0.2.1-rc.2` → `0.1.0` 判为降级。保留用户数据；之后的 Studio 版本正常比较升级。

## 客户端更新源

通用设置展示已安装 Studio 版本，并提供 HTTP(S) 更新目录输入框。保存设备级覆盖地址后重启生效，留空使用打包时配置。现有更新入口检查版本、展示下载进度，并在安装重启前确认；正在进行的工作沿用现有任务停止确认。普通浏览器客户端不会安装桌面安装包。

打包时将 `DSH_STUDIO_UPDATE_URL` 设为目录根地址，例如 `https://downloads.example.com/studio/`；打包流程追加 `win-x64/`、`mac-x64/` 或 `mac-arm64/`。运行时填写的覆盖地址则直接对应当前系统，例如 `https://downloads.example.com/studio/win-x64/`。支持路径和 HTTP 内网地址，拒绝 URL 内嵌凭据、查询串及片段。

将 electron-builder 生成的安装包／压缩包、生成时附带的 blockmap，以及版本清单放入该目录，保持清单引用的文件名及 SHA-512 不变。稳定版设置 `DSH_DESKTOP_UPDATE_CHANNEL=latest`，Windows 使用 `latest.yml`，macOS 使用 `latest-mac.yml`；预发布使用 `nightly` 及其生成的清单。保留项目现有签名流程，配置更新源不会关闭签名或校验和检查。

根地址留空时，安装包不内置更新源；Studio 不自动使用上游发布站点或强制更新策略。发布由维护者执行，源中没有发布更高版本时不会有可下载更新。

## 服务端部署

默认 Compose 部署不启用 Docker 更新器也可以使用。`/v1/version` 返回已安装服务端版本，管理侧栏与“系统更新”页也会展示。

启用容器在线替换时，编辑现有部署的 `.env`：

```dotenv
COMPOSE_PROJECT_NAME=studio-cloud
STUDIO_DEPLOYMENT_DIR=/absolute/host/path/to/services/studio-cloud
UPDATE_IMAGE_REPOSITORY=registry.example.com/team/studio-cloud
UPDATE_MANIFEST_URL=
UPDATER_TOKEN=replace-with-at-least-32-random-characters
```

必须使用**现有** Compose 项目名，上面的 `studio-cloud` 只是示例；改名会生成另一组命名数据卷。`STUDIO_DEPLOYMENT_DIR` 是宿主机真实目录，包含 `.env`、`compose.yaml` 和 `compose.updates.yaml`。令牌在本机生成，例如执行 `node -p "require('node:crypto').randomBytes(32).toString('hex')"`。

在该目录启动可选部署：

```sh
docker compose -f compose.yaml -f compose.updates.yaml up -d --build
```

业务应用不挂载 Docker socket，仅独立更新器挂载 socket 和部署目录；启用它会赋予该容器宿主机 Docker 控制能力。执行器不开放宿主机端口，通过 `UPDATER_TOKEN` 认证业务服务。升级时保留该令牌及原有 `MASTER_KEY`。私有镜像仓库需要将对应 Docker 客户端配置只读挂入更新器的 `/root/.docker`；使用凭据助手时，执行器镜像还需提供该助手程序。执行器不会交互式登录镜像仓库。

## 服务端版本清单

构建并发布包含目标 `package.json` 版本的服务端镜像。通过 HTTP(S) 发布以下结构的 JSON 文件，将仓库及摘要替换为真实值：

```json
{
  "version": "0.1.1",
  "image": "registry.example.com/team/studio-cloud@sha256:<64 lowercase hex characters>",
  "notes": "Release notes",
  "minimumVersion": "0.1.0",
  "rollbackCompatible": false
}
```

在管理后台“系统更新”填写该文件地址；首个发布尚未准备时可以留空。`UPDATE_IMAGE_REPOSITORY` 是部署层允许列表，清单不能修改它；镜像必须固定到不可变摘要。支持 HTTP 内网发布源。配置的发布源被信任为代码来源，应保护该地址和镜像仓库。

检查更新，查看目标及说明，然后点击“备份并更新”。服务重新读取清单，拒绝过期目标，按原备份策略创建加密备份，再提交固定版本的更新任务；备份失败不会启动更新。执行器拉取准确镜像，将镜像写入 `.env`，仅对 `app` 执行带 `--no-deps --no-build` 的 Compose 重建。保留 PostgreSQL、其他服务和命名数据卷；就绪接口及 `/v1/version` 符合目标后才完成。重启期间后台会尝试重连，进度和备份编号保存在 `updater-state`。

## 失败与恢复

拉取或准备失败不会重建当前应用。替换后未能就绪，且清单以 `rollbackCompatible: true` 明确声明数据库兼容时，才自动回退**应用镜像**，不会自动恢复或覆盖数据库。若前一个镜像无法读取新迁移，保持该字段为 false；此时替换失败需要管理员结合记录的备份与保留的主密钥，按发布说明恢复。

执行器重启会把未完成任务标为中断，不猜测是否应重跑迁移；先查看应用镜像、就绪状态及任务记录，再决定重试。部署完成前保持镜像仓库可访问。离线／手动运行仍可使用原有 Compose 构建及备份恢复命令。

使用外部 PostgreSQL 时，在 `.env` 设置 `STUDIO_UPDATE_COMPOSE_FILE=compose.external-pg.yaml`，启动时改用 `-f compose.external-pg.yaml -f compose.updates.yaml`，后续手动命令保持同一文件。执行器与原有 `scripts/update.sh` 共用 `.studio-update/lock`，手动源码更新和在线镜像更新不能同时切换本部署；两者使用同一个持久化镜像键 `STUDIO_CLOUD_IMAGE`。
