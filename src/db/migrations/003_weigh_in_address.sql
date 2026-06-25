ALTER TABLE weigh_in_data DROP CONSTRAINT IF EXISTS weigh_in_data_visit_id_fkey;
ALTER TABLE weigh_in_data DROP COLUMN IF EXISTS visit_id;
ALTER TABLE weigh_in_data ADD COLUMN IF NOT EXISTS address_id TEXT REFERENCES addresses(id);
ALTER TABLE weigh_in_data ADD CONSTRAINT weigh_in_data_address_system_unique UNIQUE (address_id, system_number);
