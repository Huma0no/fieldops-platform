CREATE TABLE IF NOT EXISTS invite_codes (
  code         TEXT PRIMARY KEY,
  technician_id TEXT NOT NULL REFERENCES technicians(id),
  expires_at   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);

ALTER TABLE visits ADD COLUMN IF NOT EXISTS updated_at TEXT;
