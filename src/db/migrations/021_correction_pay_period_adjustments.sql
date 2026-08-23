-- Corrections against closed or paid periods keep the original ledger immutable.
-- The resulting signed compensation delta is recorded once and paid in an open
-- destination period (or remains pending until one exists).

ALTER TABLE pay_period_adjustments RENAME COLUMN pay_period_id TO destination_pay_period_id;
ALTER TABLE pay_period_adjustments ALTER COLUMN destination_pay_period_id DROP NOT NULL;
ALTER TABLE pay_period_adjustments RENAME COLUMN amount TO delta_amount;
ALTER TABLE pay_period_adjustments RENAME COLUMN note TO reason;

ALTER TABLE pay_period_adjustments
  ADD COLUMN correction_id text UNIQUE REFERENCES corrections(id),
  ADD COLUMN visit_id text REFERENCES visits(id),
  ADD COLUMN original_pay_period_id text REFERENCES pay_periods(id),
  ADD COLUMN actor_id text REFERENCES technicians(id),
  ADD COLUMN original_amount real,
  ADD COLUMN corrected_amount real,
  ADD COLUMN status text NOT NULL DEFAULT 'applied',
  ADD COLUMN applied_at text;

ALTER TABLE pay_period_adjustments
  ADD CONSTRAINT pay_period_adjustments_status_check
  CHECK (status IN ('pending', 'applied'));

CREATE INDEX pay_period_adjustments_destination_period_idx
  ON pay_period_adjustments (destination_pay_period_id);
CREATE INDEX pay_period_adjustments_pending_idx
  ON pay_period_adjustments (technician_id, status);
