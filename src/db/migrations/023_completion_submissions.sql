-- Durable server acknowledgement for FieldOps immutable completion snapshots.
-- The client retries the same submission_id after an ambiguous transport
-- result; this row makes acceptance idempotent without duplicating effects.

CREATE TABLE IF NOT EXISTS completion_submissions (
  submission_id text PRIMARY KEY,
  visit_id text NOT NULL REFERENCES visits(id),
  technician_id text NOT NULL REFERENCES technicians(id),
  terminal_intent text NOT NULL CHECK (terminal_intent IN ('completed', 'temporarily', 'cancelled')),
  snapshot jsonb NOT NULL,
  accepted_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS completion_submissions_visit_id_idx
  ON completion_submissions(visit_id);
