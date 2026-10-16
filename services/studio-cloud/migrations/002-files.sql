CREATE TABLE cloud_files (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, id uuid NOT NULL,
 bytes bigint NOT NULL CHECK(bytes>0), sha256 text NOT NULL, part_bytes integer NOT NULL CHECK(part_bytes>0),
 complete boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,id)
);
CREATE TABLE cloud_file_parts (
 user_id uuid NOT NULL, file_id uuid NOT NULL, part integer NOT NULL CHECK(part>=0),
 sha256 text NOT NULL, bytes integer NOT NULL CHECK(bytes>0), PRIMARY KEY(user_id,file_id,part),
 FOREIGN KEY(user_id,file_id) REFERENCES cloud_files(user_id,id) ON DELETE CASCADE
);
ALTER TABLE sync_objects ADD COLUMN file_refs jsonb NOT NULL DEFAULT '[]';
