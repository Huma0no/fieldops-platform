-- Add brand/validity/revised metadata to lineset configs
ALTER TABLE catalog_lineset_configs
  ADD COLUMN IF NOT EXISTS brand              TEXT,
  ADD COLUMN IF NOT EXISTS revised_available  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS valid_from         DATE,
  ADD COLUMN IF NOT EXISTS valid_before       DATE;

INSERT INTO catalog_lineset_configs (config_key, reference_length_ft, adjust_rate_oz_per_ft, brand, revised_available, valid_from, valid_before)
VALUES
  ('TRANE-PRE-2025', 10, 0.47, 'Trane', false, NULL,         '2025-05-01'),
  ('TRANE-MID-2025', 25, 0.47, 'Trane', true,  '2025-05-01', '2026-01-01'),
  ('TRANE-2026',     15, 0.47, 'Trane', false, '2026-01-01', NULL),
  ('LENNOX-30',      30, 0.60, 'Lennox', true,  NULL,         NULL),
  ('LENNOX-15',      15, 0.60, 'Lennox', false, NULL,         NULL),
  ('GOODMAN',        15, 0.60, 'Goodman', false, NULL,        NULL),
  ('DAIKIN',         15, 0.60, 'Daikin',  false, NULL,        NULL)
ON CONFLICT (config_key) DO NOTHING;
