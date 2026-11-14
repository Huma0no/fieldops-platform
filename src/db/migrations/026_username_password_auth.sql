BEGIN;

ALTER TABLE technicians ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE technicians ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE technicians ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS technicians_username_ci_idx
  ON technicians (lower(username))
  WHERE username IS NOT NULL;

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash text PRIMARY KEY,
  technician_id text NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  created_at text NOT NULL,
  revoked_at text
);
CREATE INDEX IF NOT EXISTS auth_sessions_technician_id_idx ON auth_sessions (technician_id);

COMMIT;
