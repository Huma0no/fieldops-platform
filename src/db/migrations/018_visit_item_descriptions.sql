ALTER TABLE visit_items ADD COLUMN IF NOT EXISTS description text;

UPDATE catalog_items
SET tech_supplied = true
WHERE item_name = 'Other';
