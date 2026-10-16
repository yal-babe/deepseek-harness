# DSH Studio Cloud

[English](README.md) | 中文

独立的个人云端服务，包含账号密码与邮箱登录、邀请开通、个人同步、管理界面，以及可选的密文同步存储。通过独立的 Studio Host 服务向 Web 与桌面客户端提供登录和所选数据同步，模型账号授权保持独立。

## Docker 启动

需要 Docker Compose 和 Node.js 24（生成初始配置时使用）。在本目录执行：

```sh
npm run setup
docker compose up -d --build
```

`setup` 创建权限为 `0600` 的 `.env`，生成独立的数据库密码、管理员密码和主密钥，已有文件不会覆盖。读取该文件的 `BOOTSTRAP_PASSWORD` 登录；默认管理地址为 `http://localhost:8788/admin`，账号为 `admin`。

需要局域网访问时修改 `.env`：将 `BIND_ADDRESS` 改为所需监听地址，`PUBLIC_URL` 改为浏览器实际使用的服务 origin，例如 `http://192.168.1.20:8788`。HTTP 必须显式设置 `ALLOW_HTTP=true`；HTTPS 可通过反向代理提供，将 `PUBLIC_URL` 设为对应 HTTPS 地址。来源不匹配会被管理接口的 CSRF 检查拒绝。

HTTP 支持内网使用，但密码和令牌没有传输加密；可选端到端加密不保护登录链路。数据库不向宿主机公开端口。应用和数据库分别使用持久卷。

首次初始化后可以清空部署配置中的 `BOOTSTRAP_PASSWORD`。不要更换或丢失 `MASTER_KEY`：SMTP/S3 凭据和服务备份依赖它解密。数据库备份不替代持久卷和主密钥的运维备份。

## 已提供的功能

- 管理员创建个人账号、发出/撤销一次性邀请；无开放注册。
- 账号或已验证邮箱加密码登录，首次临时密码修改，邮箱绑定和找回；邮件通过管理页配置的 SMTP 发送。
- 浏览器 Cookie 会话与 CSRF 校验；设备 API 使用访问令牌和轮换刷新令牌。改密、重置、禁用或撤销会话后，旧凭据失效。
- `profile`、`preference`、`project`、`conversation`、`plugin` 五类 JSON 同步对象；按用户隔离，支持版本冲突、批次原子提交、幂等重试、增量游标和一致性分页快照。
- 个人额度覆盖当前同步载荷、增量历史及文件上传预留空间。超额允许删除和下载；临时快照、账号元信息和服务备份不计入个人额度。
- 可选 E2EE 模式：校验 AES-256-GCM 加密信封，存储密文和封装密钥；服务端不持有用户解密密钥。
- 管理页面提供用户、邀请、同步元信息、SMTP、S3/MinIO、容量及保留策略、备份恢复和审计。
- 定时备份和到期清理；缩短保留策略需要显式确认。删除内容清理后保留精简删除标记，旧设备不能直接复活原对象 ID。

普通同步对象保存在 PostgreSQL，分块文件保存在服务持久卷。S3/MinIO 用于包含数据库和文件内容的加密备份副本。插件同步是按插件命名空间保存 JSON 配置/数据，不安装、运行插件或同步模型凭据；插件专属字段清单和版本转换留待具体插件确定。

## 管理与存储

管理页地址为 `/admin`。邮箱邀请、绑定和密码找回的确认页为 `/account`，仅用于本服务的账号操作，不是客户端接入或完整用户门户。个人账号登录后可修改密码，已登录用户也可访问 `/account#action=bind` 绑定邮箱。

SMTP 支持 TLS 或 STARTTLS。S3 页面可配置 endpoint、region、bucket、访问凭据和路径寻址，可连接外部 MinIO；服务不自动创建存储桶。管理接口读取配置时不会返回 SMTP 密码或 S3 凭据。

建议备份桶只供本服务使用。已有备份时不能直接切换 endpoint/bucket；需要外部迁移后再调整。本版本不捆绑 MinIO 镜像，避免依赖不可拉取的镜像；可以使用已有 MinIO 或独立维护其部署。

后台每分钟检查备份间隔，每日执行保留清理。应用按单实例部署；跨实例任务协调和无中断横向扩容不在本版支持范围内。也可在管理页立即备份或显式清理。备份包含数据库业务快照及其引用的文件分块，排除登录会话和一次性令牌；本地加密文件默认保存在应用卷 `data/backups/`，配置 S3 后同时生成远程副本，到期清理同时删除两份。

备份原始数据大小受 `backupMaxBytes` 限制；超过时明确失败，需调整上限或使用数据库原生备份。恢复会替换全部用户、配置及同步数据，撤销登录并重置同步代次。旧备份无法包含备份时间之后的删除记录，恢复前需确认恢复点。

当数据库需要从头恢复时，先保证本地备份文件及原 `MASTER_KEY` 已放回持久卷，然后执行以下离线恢复流程，`<backup-id>` 为备份文件名中的 UUID：

```sh
docker compose stop app
docker compose run --rm --no-deps app node dist/restore.js <backup-id> --confirm
docker compose up -d app
```

Web 恢复同样需要本地加密文件，尚不支持直接从 S3 下载并恢复；丢失本地文件时需由运维从 S3 取回原文件。恢复完成后所有设备重新登录并重新获取同步快照。

## API 概览

| 接口组 | 主要路径 |
| --- | --- |
| 能力查询 | `GET /v1/capabilities`，返回协议、载荷版本与文件限制；会话恢复能力单独声明 |
| 资料 | `GET/PUT /v1/me/profile`，使用请求 ID 与预期版本，显示名与同步对象原子更新 |
| 文件 | `POST /v1/files`；`GET /v1/files/:id`；`PUT /v1/files/:id/parts/:part`；`POST /v1/files/:id/complete`；`GET /v1/files/:id/content` |
| 认证 | `POST /v1/auth/login`、`/refresh`、`/logout`；`GET /v1/auth/session` |
| 邀请与邮箱 | `POST /v1/auth/accept-invite`、`/verify-email`、`/forgot-password`、`/reset-password` |
| 个人安全 | `POST /v1/me/password`、`/email`；`GET /v1/me/devices`；`DELETE /v1/me/devices/:id` |
| 同步 | `POST /v1/sync/push`；`GET /v1/sync/pull`、`/snapshot`、`/v1/data` |
| 加密与用量 | `GET/PUT /v1/me/crypto`；`GET /v1/me/storage` |
| 管理 | `/v1/admin/users`、`/invites`、`/settings`、`/data`、`/audit`、`/backups`、`/cleanup` |
| 健康 | `GET /health/live`、`/health/ready` |

访问/刷新有效期可通过 `ACCESS_TTL_SECONDS`、`REFRESH_TTL_SECONDS` 配置，默认 15 分钟和 30 天。

设备登录返回 `accessToken`、`refreshToken`、`expiresIn` 和 `csrf`。携带 `Authorization: Bearer <accessToken>` 调用个人 API；浏览器使用 `client: "web"` 登录，令牌保存在 HttpOnly Cookie，写请求另带同源 `Origin` 和返回的 `X-CSRF-Token`。权限或版本错误使用结构化 `error.code` 返回。

上传请求包含 `requestId` 和 `changes`。每个对象包含 `id`、`kind`、`baseVersion`、`formatVersion`、`encrypted`、`payload`，可选 `parentId`、`namespace` 和 `deleted`；插件必须提供 `namespace`，项目需先于引用它的会话提交。删除需使用当前版本且 `payload: null`；已删除 ID 不允许普通上传复活。删除载荷在保留期内仅供运维恢复，本版未提供逐对象回收站恢复接口。

会话目前按版本化 JSON 对象同步，未实现逐事件追加协议；格式版本作为载荷元信息保存，不解析、执行或迁移客户端会话日志。快照一次每用户保留一份，30 分钟过期；重复创建会替换旧快照。

E2EE 只能在空同步空间配置，当前不支持已有数据加密迁移、密钥轮换或跨设备授权流程。开启后每份非删除载荷应为 `{algorithm:"AES-256-GCM",keyVersion,nonce,ciphertext}`，nonce 为 12 字节 Base64，ciphertext 包含认证标签。密钥派生、封装、新设备授权和恢复界面由后续接入方实现；服务端测试样本不能代表客户端已经具备加密功能。

## 本模块开发与验证

Node.js 24 和独立 PostgreSQL 为前置条件：

```sh
npm ci
npm run build
TEST_DATABASE_URL=postgresql://user:password@localhost:5432/test_database npm test
```

测试只在指定数据库创建随机 schema，结束后删除，不使用现有客户端数据。必须为测试账号提供建 schema 权限。邮件测试使用替代发送器，真实 SMTP 投递需配置后在管理页测试。

S3 兼容集成验证可在一个终端启动本地测试服务，再在另一个终端执行测试：

```sh
node tests/s3-fixture.mjs
TEST_DATABASE_URL=postgresql://user:password@localhost:5432/test_database TEST_S3_ENDPOINT=<address_from_previous_step> npm test
```

该测试服务使用 `S3RVER` 测试凭据；连接独立 MinIO 测试实例时通过 `TEST_S3_ACCESS_KEY`、`TEST_S3_SECRET_KEY` 覆盖。测试会创建自己的存储桶，仅用于专用测试环境。真实 MinIO 镜像未在当前环境运行验证，已验证的是 S3 兼容测试服务。

浏览器验证针对已运行的独立服务，创建一个测试账号和邀请，不连接客户端：

```sh
npx playwright install chromium
TEST_BASE_URL=http://localhost:8788 TEST_ADMIN_PASSWORD=your_test_admin_password npm run test:browser
```

完整需求及后续技术方案见 [DESIGN.md](DESIGN.md)。

## 文件同步规则

创建上传时使用客户端生成的不可变 UUID、总字节数与 SHA-256；服务立即为账号预留总空间，并返回分块大小。重复创建必须具有相同内容标识；重复分块必须具有相同内容。查询上传状态可恢复中断的传输，完成接口检查分块数量与完整文件摘要。所有状态、完成与下载请求均检查账号归属。

同步对象通过 `fileRefs` 引用已完成的同账号文件。未完成或其他账号的文件不能发布。`FILE_PART_BYTES` 默认 1048576，`FILE_MAX_BYTES` 默认 67108864；更改分块默认值不影响已有上传。当前对象和历史仍引用的文件均保留；超过删除保留期的无引用文件由清理操作移除。备份和下载持有文件读取锁，清理不会删除其正在读取的分块。

备份格式 2 包含文件内容并校验摘要；格式 1 的数据库备份仍可恢复。恢复前会验证文件内容，数据库事务提交后所有设备必须重新登录。客户端应先检查能力，普通同步客户端遇到 E2EE 空间时不得发送普通载荷。文件接口只支持普通空间。
