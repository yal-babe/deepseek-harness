---
description: "面向用户与维护者的 OS 钥匙串凭据提供方：选择、配置或排查 Desktop 机密存储及其文件后端回退。"
kind: "package-reference"
---

# @deepseek-ai/dsh-credentials-os

[English](README.md) | 中文

## 概述

`dsh-credentials-os` 在 macOS 和 Windows 上把 API 密钥和其他机密存进 OS 钥匙串，因此这些值不会躺在 harness home 下的 YAML 文件里。Desktop 会为新 profile 预置该存储。凭据查找优先级与文件存储相同：启动环境优先，其次是钥匙串，然后是项目与 home 的 `.env`。你可以把 `backend` 换成 `file` 来继续使用 YAML 文档。Linux 没有钥匙串后端，因此 `backend: os` 只把机密留在进程内存中，直到你改选 `file`。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

本包为组合提供 OS 后端凭据存储：API 密钥只需保存一次，之后每个按名引用它们的请求都会用到，且不会把机密写入 `$DSH_HOME/.credentials.yaml`。

### 何时选择

在 Desktop 上、希望机密进入 macOS Keychain 或 Windows DPAPI 而不是 YAML 文件时选择它。无头、Web 与 Linux profile，以及需要以文件方式编辑机密时，继续使用 `@deepseek-ai/dsh-credentials-local`（或本包的 `backend: file`）。

### 设置

```yaml
- id: credentials
  disabled: true
- insert:
    - id: credentials-os
      name: '@deepseek-ai/dsh-credentials-os'
      config:
        backend: os
        service: dsh-studio
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `backend` | `os` | `os` 使用钥匙串加索引文件；`file` 完全委托给 `dsh-credentials-local` |
| `service` | `dsh-studio` | 钥匙串 / DPAPI 服务名 |
| `path` | `<harness home>/.credentials-os-index.yaml`（os）或 `.credentials.yaml`（file） | 索引或凭据文档路径 |
| `dshHome` | `$DSH_HOME` 或 `~/.dsh` | `path` 缺省时使用的 harness home |
| `watch` | `true` | 仅文件后端：YAML 文档在磁盘上变化时重载 |
| `debounceMs` | `100` | 仅文件后端：变化后等待这么久再重载，单位为毫秒 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-credentials-os)完整列出了所有受支持字段及其 JSDoc，是这些信息的真源。

Desktop 新 profile 会把上述 `id: credentials` 补丁写入该 profile 的 `cordis.patch.yml`。已有 profile 继续使用 `credentials-local`，直到你加上同一补丁。在非 Desktop 的检出上排查时，也可作为 `--patch` 覆盖层应用。

### 存储与移除密钥

用 `set` 保存密钥，用 `unset` 移除，用 `describe` 检查是否已配置——与凭据 API 提供的操作相同：

```ts
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

declare const ctx: Context

const ref = credentialRef('DEEPSEEK_API_KEY')
await ctx.credentials.set(ref, 'sk-…')
await ctx.credentials.describe(ref)
await ctx.credentials.unset(ref)
```

你保存的密钥可被下一个按名引用它的请求使用。OS 存储的值在 `describe` 中报告 `source: 'keychain'`。记录使用与文件存储相同的操作（`readRecord`、`describeRecord`、`listRecords`、`modifyRecord`、`deleteRecord`）。

### 密钥来自何处

密钥按固定顺序解析——第一个有值的位置获胜：

| 位置 | 可写？ | 胜过 |
|---|---|---|
| 你启动时所在的环境（`DEEPSEEK_API_KEY=… dsh`） | 否 | 一切 |
| OS 钥匙串（或 `backend: file` 时的 YAML 文件） | 是（`set`/`unset`） | 两个 `.env` 文件 |
| 项目的 `.env`（`<invocation cwd>/.env`） | 不在此处 | 你的 home `.env` |
| 你的 home `.env`（`$DSH_HOME/.env`） | 不在此处 | 无 |

启动环境优先，因为按次运行的覆盖是本次运行的明确意图；对被遮蔽引用的写入会被拒绝。新保存的钥匙串值会立即覆盖 `.env` 中的旧值。

### 索引文件

OS 后端把 `$DSH_HOME/.credentials-os-index.yaml` 写成仅含引用名与记录 kind——绝不含机密值。机密存放在服务名 `dsh-studio`（可配置）下的 OS 存储中。该文件在 POSIX 上仅所有者可读写，与 YAML 凭据文档相同。

```yaml
version: 1
refs:
  DEEPSEEK_API_KEY: true
records:
  llm-pi-ai/openai-codex: grant
```

### 可能出错的情况

- **启动环境提供的密钥只读** — `DEEPSEEK_API_KEY=… dsh` 在本次运行中获胜；保存或移除会被拒绝。先在启动 shell 中清除该变量。
- **不能保存空值** — 存储空字符串会被拒绝；改为移除该密钥。
- **索引列出缺失机密时启动失败** — 索引与 OS 存储必须一致；现场写入若无法解析索引会拒绝，而不是覆盖它。
- **Linux 上 `backend: os` 不持久化** — 没有钥匙串后端；使用 `backend: file`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

### 设计理念

- **机密不进入 YAML。** 索引是地址簿；`OsSecretStore` 保存值。测试注入 `MemoryOsSecretStore`。
- **一套诚实的优先级。** 继承的环境获胜；其下的一切都输给托管存储，无论该存储是钥匙串还是文件后端。
- **文件后端就是本地提供方。** `backend: file` 在隔离的 `credentials` 作用域中构造 `LocalCredentialProvider`，并转发每一条 seam 方法，包括其监视器。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 提供方：后端选择、分层解析、索引锁下的 OS 写路径 |
| [`src/index-file.ts`](src/index-file.ts) | 索引解析与渲染：refs 为存在标记，records 为 kind |
| [`src/os-store.ts`](src/os-store.ts) | `OsSecretStore`：内存（测试/Linux）、macOS `security`、Windows DPAPI 文件 |

### 解析与写路径

`resolve` 与 `describe` 读取继承的环境快照、内存中的 OS 快照以及 `.env` 回退。OS 的 `set`/`unset`/`modifyRecord` 排入一条独占链，在写锁下重读索引，先提交机密再提交索引（删除时先索引后机密），并且只在提交之后触发 `credentials/reference-updated` 或 `credentials/record-updated`。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [凭据引用 seam](../credentials/README.zh.md) — `resolve`、`describe`、`set`、`unset`、记录操作以及 seam 的更新事件。
- [文件凭据存储](../credentials-local/README.zh.md) — `backend: file` 时本包委托的 YAML 提供方。
- [凭据子系统参考](../../../docs/subsystems/credentials.zh.md) — `CredentialRef`、按操作解析、可安全用于 UI 的 `CredentialInfo`。
- [启动环境快照](../../util/launch-environment/README.zh.md) — 解析所读取的冻结分层快照，而不是 `process.env`。

-----

<a id="model-experience"></a>
## 模型体验

经由 `ctx.credentials` 的消费方间接生效：消费方拥有存储值所启用的全部模型可见行为。

#### KV Cache 影响

无直接失效；存储值绝不进入请求前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明本提供方何时不合适，或何时需要特别的运维注意。它们是当前包约束，不是任务积压。

- **Linux 上 `backend: os` 仅在进程内** — `createPlatformOsSecretStore` 返回内存存储；机密不能跨重启存活。在 Linux 上使用 `backend: file`。
- **外部钥匙串编辑直到重启都不可见** — OS 后端不监视钥匙串或索引；只有本进程的写入会更新快照。
- **同一引用的并发写入是后写胜出** — 索引锁让并发写入者不会丢掉彼此的条目，但两个写入者编辑同一个引用时仍以较后的写入为准。
- **机密与索引提交之间崩溃可能留下孤儿机密** — `set` 先写 OS 存储；`unset` 先更新索引，因此列出的缺失机密不能通过启动。
- **Windows 把 DPAPI 文件存在 LocalAppData 下** — 不是 Windows Credential Manager。保护范围是已登录用户，不是单独的钥匙串条目。
- **文件后端仍可被同一 UID 读取** — `backend: file` 就是 `dsh-credentials-local`；agent 工具进程可以读取该文档。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：开放问题与尚未决定的探索方向。它明确不具权威性——已交付的行为与限制以上文和包代码为准。

Linux secret-service（libsecret）后端会让 `backend: os` 在该平台上持久化。辅助命令与 KMS 后端存储仍可作为平级包；目前没有任何一种随附。

</details>
