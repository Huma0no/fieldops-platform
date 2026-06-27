DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'technician_price_overrides_unique'
      AND conrelid = 'technician_price_overrides'::regclass
  ) THEN
    ALTER TABLE technician_price_overrides
      ADD CONSTRAINT technician_price_overrides_unique UNIQUE (technician_id, item_name);
  END IF;
END
$$;
