ALTER TABLE technicians ADD COLUMN IF NOT EXISTS commission_rate real NOT NULL DEFAULT 20;
ALTER TABLE pay_period_lines ADD COLUMN IF NOT EXISTS commission_rate_applied real NOT NULL DEFAULT 20;
