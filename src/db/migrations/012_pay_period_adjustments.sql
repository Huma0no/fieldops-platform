CREATE TABLE IF NOT EXISTS pay_period_adjustments (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  pay_period_id  text NOT NULL REFERENCES pay_periods(id),
  technician_id  text NOT NULL REFERENCES technicians(id),
  amount         real NOT NULL,
  note           text,
  created_at     text NOT NULL
);

CREATE INDEX IF NOT EXISTS pay_period_adjustments_period_idx ON pay_period_adjustments (pay_period_id);
