-- W3 (Weigh-In + Calc): factory charges per manufacturer + length replace the
-- Factory / Revised pair; manufacturers (oz/ft, default length) replace the
-- lineset configs for new readings. Spec: docs/shared/CATALOG.md.

CREATE TABLE IF NOT EXISTS catalog_manufacturers (
  name              text PRIMARY KEY,
  oz_per_ft         real NOT NULL CHECK (oz_per_ft > 0),
  default_length_ft real NOT NULL CHECK (default_length_ft > 0)
);

INSERT INTO catalog_manufacturers (name, oz_per_ft, default_length_ft) VALUES
  ('Daikin', 0.6, 15), ('Goodman', 0.6, 15), ('Lennox', 0.6, 30), ('Trane', 0.47, 15)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS catalog_equipment_charges (
  model        text NOT NULL REFERENCES catalog_equipment(model) ON UPDATE CASCADE ON DELETE CASCADE,
  manufacturer text NOT NULL REFERENCES catalog_manufacturers(name) ON UPDATE CASCADE,
  length_ft    real NOT NULL CHECK (length_ft > 0),
  charge_oz    real NOT NULL CHECK (charge_oz >= 0),
  PRIMARY KEY (model, manufacturer, length_ft)
);

-- Refuse to drop charges this migration cannot place.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM catalog_equipment e
    WHERE (e.factory_charge_oz IS NOT NULL AND e.brand NOT IN (SELECT name FROM catalog_manufacturers))
       OR (e.revised_charge_oz IS NOT NULL AND e.brand NOT IN ('Trane', 'Lennox'))
  ) THEN
    RAISE EXCEPTION 'catalog_equipment has charges with no manufacturer + length mapping';
  END IF;
END $$;

-- Factory → the brand's base length (Lennox: the seed's revised value is the
-- factory value + 15 ft × 0.6 oz/ft, so its factory value is the 15 ft charge).
INSERT INTO catalog_equipment_charges (model, manufacturer, length_ft, charge_oz)
SELECT e.model, e.brand, CASE WHEN e.brand = 'Lennox' THEN 15 ELSE m.default_length_ft END, e.factory_charge_oz
FROM catalog_equipment e JOIN catalog_manufacturers m ON m.name = e.brand
WHERE e.factory_charge_oz IS NOT NULL
ON CONFLICT DO NOTHING;

-- Revised → its length: Trane 25 ft, Lennox 30 ft.
INSERT INTO catalog_equipment_charges (model, manufacturer, length_ft, charge_oz)
SELECT e.model, e.brand, CASE e.brand WHEN 'Trane' THEN 25 ELSE 30 END, e.revised_charge_oz
FROM catalog_equipment e
WHERE e.revised_charge_oz IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE catalog_equipment DROP COLUMN IF EXISTS factory_charge_oz;
ALTER TABLE catalog_equipment DROP COLUMN IF EXISTS revised_charge_oz;

-- Lineset configs stay only for readings recorded before W3: no date windows.
ALTER TABLE catalog_lineset_configs DROP COLUMN IF EXISTS revised_available;
ALTER TABLE catalog_lineset_configs DROP COLUMN IF EXISTS valid_from;
ALTER TABLE catalog_lineset_configs DROP COLUMN IF EXISTS valid_before;
DELETE FROM catalog_lineset_configs
WHERE brand IS NULL AND config_key LIKE 'LC-%'
  AND config_key NOT IN (SELECT factory_line_config FROM weigh_in_data WHERE factory_line_config IS NOT NULL);

-- What the technician chose for each reading.
ALTER TABLE weigh_in_data ADD COLUMN IF NOT EXISTS manufacturer text;
ALTER TABLE weigh_in_data ADD COLUMN IF NOT EXISTS factory_length_ft real;
ALTER TABLE weigh_in_data ADD COLUMN IF NOT EXISTS oz_per_ft real;
ALTER TABLE weigh_in_data ADD COLUMN IF NOT EXISTS refrigerant text;
ALTER TABLE weigh_in_data ADD COLUMN IF NOT EXISTS factory_charge_source text
  CHECK (factory_charge_source IN ('catalog', 'edited'));
