-- W1b: technicians may add systems to a call and correct a system's
-- equipment. The Report applies those changes to visit_systems; every change
-- is logged with its before/after so Dispatch keeps the original order data
-- and can show "changed by tech" (who, when, what).
ALTER TABLE visit_systems ADD COLUMN added_by_technician boolean NOT NULL DEFAULT false;

CREATE TABLE visit_system_changes (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  visit_id      text NOT NULL REFERENCES visits(id),
  system_number integer NOT NULL,
  change        text NOT NULL CHECK (change IN ('added', 'equipment_modified')),
  before        jsonb,
  after         jsonb NOT NULL,
  technician_id text NOT NULL REFERENCES technicians(id),
  changed_at    text NOT NULL
);

CREATE INDEX visit_system_changes_visit_id_idx ON visit_system_changes (visit_id);
