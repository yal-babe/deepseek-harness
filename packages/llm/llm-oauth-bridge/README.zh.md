---
description: "为界面运行 ctx.authorization 尝试的 Host 服务。每个凭据键同时只跑一次尝试；通知与提问被缓冲进一份安全视图。"
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-oauth-bridge

[English](README.md) | 中文

## 概述

为界面运行 `ctx.authorization` 尝试的 Host 服务。每个凭据键同时只跑一次尝试；通知与提问被缓冲进一份安全视图。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用此包

`ctx.oauthBridge` 按 `parseCredentialKey` 解析的凭据键发起、取消与退出授权。若该键已有尝试在跑，`start` 返回当前视图。新的 `start` 会等到 flow 已提问、发出授权 URL 或结束后再返回，因此第一份快照是选择器或授权 URL，而不是空白的 in-flight idle。不含 URL 的通知保持 idle，不会结束这次等待。`watch` 先发送初始快照，随后发送变化；断开连接只停止观察，不取消尝试。带 URL 的通知会把状态设为 `waiting-browser` 并写入 `authorizeUrl`。提问会把状态设为 `prompting`，直到 `answerPrompt` 或 `declinePrompt`。结束时报告 `authorized`、`cancelled` 或 `failed`，并丢掉 `authorizeUrl`。`credentialConfigured` 跟随已存储的记录。

[oauth 控制器](../../api/oauth-controller/README.zh.md) 通过 Remote 暴露这些操作。

<a id="understand-the-implementation"></a>
## 理解实现

该桥为它发起的每次尝试提供授权交互，并不拥有协议。flow 仍由写入该凭据的插件注册，例如为 `openai-codex` 注册的 `llm-pi-ai`。

<a id="further-exploration"></a>
## 深入探索

[authorization](../../credentials/authorization/README.zh.md) seam 拥有 flow 注册与提交确认。[凭证子系统](../../../docs/subsystems/credentials.zh.md) 拥有记录存储。

<a id="model-experience"></a>
## 模型体验

无，因为 OAuth 凭据只影响 HTTP 认证，不进入模型提示、Session 日志或工具结果。

#### KV Cache effect

不改变模型请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 尝试只存在于发起它的进程中，因此界面重载或 Host 退出会放弃该尝试，需要重新开始。退出登录只删除本地记录，不会向签发方撤销授权。

<a id="dev-note"></a>
### 开发备注

无。
