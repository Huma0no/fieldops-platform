-- Each session ends at a fixed time chosen at login: 7 days ("Keep me signed in")
-- or the next 03:00 in the company time zone. FieldOps is pre-production, so
-- existing sessions (which have no expiry) are removed; their users sign in again.
BEGIN;
DELETE FROM auth_sessions;
ALTER TABLE auth_sessions ADD COLUMN expires_at text NOT NULL;
COMMIT;
