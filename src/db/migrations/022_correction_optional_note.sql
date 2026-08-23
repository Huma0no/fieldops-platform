-- Dispatcher corrections no longer require a pre-editor reason. Keep the
-- technician's request content distinct from optional administrative context.

ALTER TABLE corrections RENAME COLUMN reason TO request_message;
ALTER TABLE corrections ALTER COLUMN request_message DROP NOT NULL;
ALTER TABLE corrections DROP CONSTRAINT corrections_reason_nonblank_check;
ALTER TABLE corrections ADD COLUMN note text;
