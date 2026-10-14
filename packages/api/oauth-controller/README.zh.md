---
description: "OAuth 界面使用经过认证的 Remote 操作和快照流。控制器提供尝试状态，不返回 token。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-oauth-controller

[English](README.md) | 中文

## 概述

OAuth 界面使用经过认证的 Remote 操作和快照流。控制器提供尝试状态，不返回 token。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用此包

`oauth` 命名空间提供 getState、start、cancel、signOut、answerPrompt、declinePrompt 和 watch。每个方法都以 `<scope>/<id>` 形式命名凭据键。watch 先发送完整初始状态，随后发送完整状态变化；断开连接只停止观察，不取消尝试。无效键、缺少提问，以及授权 flow 拒绝都以 `oauth/rejected` 返回。

[OAuth 桥](../../llm/llm-oauth-bridge/README.zh.md) 拥有尝试生命周期。

<a id="understand-the-implementation"></a>
## 理解实现

控制器向 `ctx.oauthBridge` 转发操作，不维护独立的 OAuth 状态。

<a id="further-exploration"></a>
## 深入探索

[添加 Remote API 的 cookbook](../../../docs/cookbook/adding-a-remote-api.zh.md) 记录声明、失败码与 Client 消费方式。

<a id="model-experience"></a>
## 模型体验

无，因为 OAuth 凭据只影响 HTTP 认证，不进入模型提示、Session 日志或工具结果。

#### KV Cache effect

不改变模型请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- UI 断线后可通过 watch 恢复状态，但不能在 Host 退出后恢复尝试。凭据值不对 Remote 暴露。

<a id="dev-note"></a>
### 开发备注

无。
