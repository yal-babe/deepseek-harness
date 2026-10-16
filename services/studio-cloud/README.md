# DSH Studio Cloud

English | [中文](README.zh.md)

Standalone personal cloud service providing username/password and email login, invite onboarding, personal synchronization, administrative UI, and optional ciphertext sync storage. Delivers authentication and selected object synchronization to Web and desktop clients through an isolated Studio Host service, while model account credentials remain separate.

## Docker Launch

Requires Docker Compose and Node.js 24 (used when generating initial configuration). Run in this directory:

```sh
npm run setup
docker compose up -d --build
```

`setup` creates `.env` with `0600` permissions, generating independent database password, admin password, and master key without overwriting existing files. Read `BOOTSTRAP_PASSWORD` from that file to log in; the default admin interface is at `http://localhost:8788/admin` with username `admin`.

When local network access is needed, edit `.env`: set `BIND_ADDRESS` to the required listen address, and `PUBLIC_URL` to the origin browser clients use, such as `http://192.168.1.20:8788`. HTTP requires explicitly setting `ALLOW_HTTP=true`; HTTPS can be provided via reverse proxy with `PUBLIC_URL` set to the corresponding HTTPS URL. Origin mismatches are rejected by the admin CSRF check.

HTTP supports intranet use, but passwords and tokens have no transport encryption; optional end-to-end encryption does not protect login traffic. The database exposes no host ports. Application and database use independent persistent volumes.

`BOOTSTRAP_PASSWORD` can be cleared from deployment configuration after initial setup. Never rotate or lose `MASTER_KEY`: SMTP/S3 credentials and service backups depend on it for decryption. Database backups do not replace operational backups of persistent volumes and master keys.

## Provided Features

- Administrators create personal accounts and issue/revoke one-time invitations; open registration is disabled.
- Password login with account username or verified email, initial temporary password change, and email binding and recovery via configured SMTP.
- Browser cookie sessions with CSRF verification; device APIs use access tokens with rotating refresh tokens. Changing passwords, resets, disabling, or revoking invalidates previous credentials.
- Five JSON sync object kinds: `profile`, `preference`, `project`, `conversation`, and `plugin`; user-isolated with version conflict detection, atomic batch commit, idempotent retries, incremental cursors, and consistent snapshot pagination.
- Personal quota covers active sync payload, delta history, and file upload reservation space. Exceeded quotas permit deletions and downloads; temporary snapshots, account metadata, and backups do not count against personal quota.
- Optional E2EE mode: verifies AES-256-GCM encrypted envelopes, storing ciphertext and wrapped keys; server holds no user decryption keys.
- Admin dashboard provides user management, invitations, sync metadata, SMTP, S3/MinIO configuration, capacity and retention policies, backup/restore, and audit logs.
- Scheduled backups and expiration cleanup; shortening retention policies requires explicit confirmation. Cleanup retains minimal tombstones, preventing older devices from directly reviving original object IDs.

Plain sync objects reside in PostgreSQL, with chunked files stored in persistent application volumes. S3/MinIO holds encrypted backup copies containing database records and file bytes. Plugin sync stores JSON configuration/data per plugin namespace without installing, executing plugins, or syncing model credentials; plugin-specific field schemas and version conversions are defined by individual plugins.

## Administration and Storage

The admin dashboard is located at `/admin`. The email invitation, binding, and password recovery confirmation page is `/account`, dedicated to account operations rather than serving as a full client portal. Authenticated personal accounts can change passwords, and signed-in users can visit `/account#action=bind` to bind an email.

SMTP supports TLS or STARTTLS. The S3 configuration page accepts endpoint, region, bucket, credentials, and path addressing, compatible with external MinIO; buckets are not automatically created. The admin read API never exposes SMTP passwords or S3 credentials.

Dedicated backup buckets are recommended for this service. Existing backups prevent direct endpoint/bucket switching; migrate externally before updating configuration. This release avoids bundling MinIO images to avoid unpullable registry dependencies; connect existing MinIO or maintain separate deployments.

Background checks run every minute for backup intervals and daily for retention cleanup. The application deploys as a single instance; multi-instance coordination and zero-downtime horizontal scaling are outside this release scope. Immediate backups and explicit cleanup are also available in admin. Backups include database snapshots and referenced file chunks, excluding login sessions and one-time tokens; local encrypted files default to volume `data/backups/`, while configured S3 creates simultaneous remote copies deleted together upon retention expiration.

Raw backup size is bounded by `backupMaxBytes`; exceeding limits fails explicitly, requiring raised limits or native database backups. Restoring replaces all users, settings, and sync data, revoking active logins and resetting sync generations. Historical backups cannot capture deletions made after backup creation, requiring confirmation of the target restore point.

When restoring a database from scratch, verify that local backup files and the original `MASTER_KEY` are placed in the volume, then execute this offline restore procedure where `<backup-id>` is the backup UUID:

```sh
docker compose stop app
docker compose run --rm --no-deps app node dist/restore.js <backup-id> --confirm
docker compose up -d app
```

Web restoration also requires local encrypted files and does not directly pull from S3; missing local files must be retrieved from S3 by operations. Restoring forces all devices to log in again and obtain fresh sync snapshots.

## API Overview

| Endpoint Group | Primary Routes |
| --- | --- |
| Capabilities | `GET /v1/capabilities`, returning protocol, payload version, and file limits; session restore capability is declared separately |
| Profile | `GET/PUT /v1/me/profile`, using request IDs and expected versions; display names and sync objects update atomically |
| Files | `POST /v1/files`; `GET /v1/files/:id`; `PUT /v1/files/:id/parts/:part`; `POST /v1/files/:id/complete`; `GET /v1/files/:id/content` |
| Authentication | `POST /v1/auth/login`, `/refresh`, `/logout`; `GET /v1/auth/session` |
| Invites and Email | `POST /v1/auth/accept-invite`, `/verify-email`, `/forgot-password`, `/reset-password` |
| Personal Security | `POST /v1/me/password`, `/email`; `GET /v1/me/devices`; `DELETE /v1/me/devices/:id` |
| Synchronization | `POST /v1/sync/push`; `GET /v1/sync/pull`, `/snapshot`, `/v1/data` |
| Encryption and Quota | `GET/PUT /v1/me/crypto`; `GET /v1/me/storage` |
| Administration | `/v1/admin/users`, `/invites`, `/settings`, `/data`, `/audit`, `/backups`, `/cleanup` |
| Health | `GET /health/live`, `/health/ready` |

Access and refresh TTLs are configurable via `ACCESS_TTL_SECONDS` and `REFRESH_TTL_SECONDS`, defaulting to 15 minutes and 30 days.

Device login returns `accessToken`, `refreshToken`, `expiresIn`, and `csrf`. Include `Authorization: Bearer <accessToken>` for personal APIs; browser login sets `client: "web"`, storing tokens in HttpOnly cookies and requiring same-origin `Origin` and `X-CSRF-Token` headers for writes. Permission or version errors return structured `error.code`.

Push requests contain `requestId` and `changes`. Each object specifies `id`, `kind`, `baseVersion`, `formatVersion`, `encrypted`, `payload`, and optional `parentId`, `namespace`, and `deleted`; plugins require `namespace`, and projects must precede referencing conversations. Deletions require matching base version and `payload: null`; deleted IDs cannot be revived through standard uploads. Deleted payloads within retention are accessible solely for operational recovery; per-object recycle bin APIs are not provided.

Conversations currently synchronize as versioned JSON objects without event-by-event append streaming; format versions are stored as payload metadata without server-side parsing, execution, or migration of client logs. One snapshot is retained per user for 30 minutes; subsequent requests replace existing snapshots.

E2EE can only be configured in an empty sync space, without encrypted migration of existing data, key rotation, or cross-device authorization flows. When enabled, each non-deleted payload must be `{algorithm:"AES-256-GCM",keyVersion,nonce,ciphertext}`, where nonce is 12-byte Base64 and ciphertext contains the auth tag. Key derivation, wrapping, new device authorization, and recovery UIs are deferred to client integrations; server tests do not imply client encryption readiness.

## Module Development and Testing

Node.js 24 and independent PostgreSQL are required prerequisites:

```sh
npm ci
npm run build
TEST_DATABASE_URL=postgresql://user:password@localhost:5432/test_database npm test
```

Tests run within random ephemeral schemas in the specified database and drop them upon completion, leaving existing data untouched. The test user requires schema creation privileges. Email tests substitute transport mocks; real SMTP delivery should be verified via the admin console.

S3-compatible integration tests run locally by starting the mock service in one terminal and running tests in another:

```sh
node tests/s3-fixture.mjs
TEST_DATABASE_URL=postgresql://user:password@localhost:5432/test_database TEST_S3_ENDPOINT=<address_from_previous_step> npm test
```

The test harness uses `S3RVER` test credentials; override via `TEST_S3_ACCESS_KEY` and `TEST_S3_SECRET_KEY` when testing against external MinIO instances. Tests manage dedicated ephemeral buckets. A real MinIO image is not run in this environment; test verification targets the S3-compatible mock service.

Browser verification targets an existing running service instance, creating a test user and invite without connecting client apps:

```sh
npx playwright install chromium
TEST_BASE_URL=http://localhost:8788 TEST_ADMIN_PASSWORD=your_test_admin_password npm run test:browser
```

See [DESIGN.md](DESIGN.md) for complete requirements and technical specifications.

## File Synchronization Rules

Upload creation uses client-generated immutable UUIDs, total byte length, and SHA-256 digests; the service immediately reserves account space and returns chunk size. Duplicate creation requests must share identical identifiers; duplicate parts must provide identical contents. Querying upload status resumes interrupted uploads, and completion checks verify chunk counts and whole-file digests. All status, completion, and download requests enforce account ownership.

Sync objects reference completed files belonging to the same account via `fileRefs`. Unfinished files or files from other accounts cannot be published. `FILE_PART_BYTES` defaults to 1048576, and `FILE_MAX_BYTES` defaults to 67108864; updating default part size does not affect existing uploads. Referenced files in active objects and history are retained; unreferenced files exceeding retention are pruned by cleanup. Backups and downloads acquire shared read locks, preventing deletion during concurrent cleanup.

Backup format 2 includes file content with checksum verification; format 1 database-only backups remain restorable. Restores verify file contents before committing transactions, after which all devices must re-authenticate. Clients must check capabilities first; standard sync clients encountering an E2EE space must not send plain payloads. File APIs only support unencrypted spaces.
