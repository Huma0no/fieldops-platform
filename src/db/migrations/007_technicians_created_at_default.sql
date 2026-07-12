-- Add DEFAULT now() to technicians.created_at so inserts don't require it explicitly.
ALTER TABLE technicians
  ALTER COLUMN created_at SET DEFAULT now()::text;
