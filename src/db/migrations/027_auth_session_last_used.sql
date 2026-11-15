-- Sliding session expiry: sessions unused for 30 days are rejected.
-- NULL means the session was never refreshed; expiry then uses created_at.
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS last_used_at text;
