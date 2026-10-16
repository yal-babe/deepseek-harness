CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE users (
 id uuid PRIMARY KEY, username text NOT NULL UNIQUE, password_hash text NOT NULL,
 email text UNIQUE, display_name text NOT NULL DEFAULT '', role text NOT NULL CHECK(role IN ('user','admin')) DEFAULT 'user',
 disabled boolean NOT NULL DEFAULT false, must_change_password boolean NOT NULL DEFAULT false,
 quota_bytes bigint, encryption_mode text NOT NULL DEFAULT 'plain' CHECK(encryption_mode IN ('plain','e2ee')),
 crypto jsonb, sync_seq bigint NOT NULL DEFAULT 0, sync_epoch uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_sessions (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 access_hash text NOT NULL UNIQUE, refresh_hash text NOT NULL UNIQUE, previous_refresh_hash text,
 csrf text NOT NULL, device_name text NOT NULL, access_expires timestamptz NOT NULL,
 refresh_expires timestamptz NOT NULL, revoked boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), last_seen timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE action_tokens (
 token_hash text PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('invite','email','reset')),
 user_id uuid REFERENCES users(id) ON DELETE CASCADE, email text, expires_at timestamptz NOT NULL,
 used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sync_objects (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('profile','preference','project','conversation','plugin')),
 parent_id text, namespace text, version integer NOT NULL, format_version integer NOT NULL,
 encrypted boolean NOT NULL, payload jsonb, bytes bigint NOT NULL, deleted_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,id),
 FOREIGN KEY(user_id,parent_id) REFERENCES sync_objects(user_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE sync_changes (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, seq bigint NOT NULL,
 object_id text NOT NULL, value jsonb NOT NULL, bytes bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,seq)
);
CREATE TABLE sync_requests (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, request_id uuid NOT NULL,
 digest text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,request_id)
);
CREATE TABLE settings (name text PRIMARY KEY, value jsonb NOT NULL);
CREATE TABLE audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id uuid,
 action text NOT NULL, target text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE backups (
 id uuid PRIMARY KEY, filename text NOT NULL, bytes bigint NOT NULL, remote boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON auth_sessions(user_id);
CREATE INDEX changes_age ON sync_changes(created_at);
CREATE INDEX objects_deleted ON sync_objects(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX tokens_expiry ON action_tokens(expires_at);
ALTER TABLE users ADD COLUMN sync_floor bigint NOT NULL DEFAULT 0;
CREATE TABLE sync_snapshots (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 seq bigint NOT NULL, epoch uuid NOT NULL, expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes'
);
CREATE TABLE sync_snapshot_items (
 snapshot_id uuid NOT NULL REFERENCES sync_snapshots(id) ON DELETE CASCADE,
 id text NOT NULL, value jsonb NOT NULL, PRIMARY KEY(snapshot_id,id)
);
