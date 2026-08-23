-- Unify technician-requested and dispatcher-initiated corrections under one
-- lifecycle while keeping applied source-data changes auditable.

ALTER TABLE corrections RENAME COLUMN requested_by TO initiator_id;
ALTER TABLE corrections RENAME COLUMN message TO reason;

ALTER TABLE corrections ADD COLUMN origin text NOT NULL DEFAULT 'technician_requested';
ALTER TABLE corrections ADD COLUMN applied_by text REFERENCES technicians(id);
ALTER TABLE corrections ADD COLUMN affected_domains jsonb;
ALTER TABLE corrections ADD COLUMN before_state jsonb;
ALTER TABLE corrections ADD COLUMN after_state jsonb;

ALTER TABLE corrections ADD CONSTRAINT corrections_origin_check
  CHECK (origin IN ('technician_requested', 'dispatcher_initiated'));
ALTER TABLE corrections ADD CONSTRAINT corrections_reason_nonblank_check
  CHECK (length(btrim(reason)) > 0) NOT VALID;

ALTER TABLE edit_log ADD COLUMN actor_id text REFERENCES technicians(id);
ALTER TABLE edit_log ADD COLUMN correction_id text REFERENCES corrections(id);
CREATE INDEX edit_log_correction_id_idx ON edit_log(correction_id);
