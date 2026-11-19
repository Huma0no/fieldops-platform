-- Ghost deduction discarded (Kristo, 2026-11-19): column removed; no data existed.
ALTER TABLE pay_periods DROP COLUMN IF EXISTS ghost_deduction;
