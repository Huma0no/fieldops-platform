-- =============================================================================
-- FIELDOPS CATALOG SEED
-- Source of truth: docs/CATALOG_REVIEW.md (reviewed and approved)
--
-- TRUNCATE at top clears any existing test data and reloads from scratch.
-- CASCADE propagates to dependent tables (visit_items, etc.) — run only in
-- development / staging environments.
-- =============================================================================

TRUNCATE catalog_services, catalog_items, catalog_item_relations, catalog_equipment
  RESTART IDENTITY CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. catalog_services (7 rows)
--    "Finish" is a $0 persistence entry for Finish-only selection. With a
--    base service, Finish remains visit_services.is_finish instead.
--    multiplies_by_system_count: only AC and Heat
--    is_bundle: only AC & Heat (charged as one unit, not $30+$30)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO catalog_services (service_name, default_price, is_bundle, multiplies_by_system_count)
VALUES
  ('AC',         30, false, true),
  ('Heat',       30, false, true),
  ('AC & Heat',  30, true,  false),
  ('Prestart',   20, false, false),
  ('Drive Run',  10, false, false),
  ('Finish',      0, false, false),
  ('Cancel',      0, false, false)
ON CONFLICT (service_name) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2a. catalog_items — accessories (21 rows)
--    finish_addon_price: Weight-In-Data adds $10 when Finish is also selected
--    (read by the price engine from this column).
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO catalog_items
  (item_name, category, default_price, tech_supplied, multiplies_by_system_count, custom_price, finish_addon_price)
VALUES
--  item_name               category    price  tech   multi  custom  addon
  ('FIN180P',             'accessory',  10,   false, false, false,  null),
  ('FIN6-MD',             'accessory',  10,   false, false, false,  null),
  ('Float Switch',        'accessory',   5,   true,  true,  false,  null),
  ('Dehum',               'accessory',  10,   false, false, false,  null),
  ('F/A',                 'accessory',  10,   false, false, false,  null),
  ('Harmony',             'accessory',  40,   true,  false, false,  null),
  ('HZ322',               'accessory',  30,   true,  false, false,  null),
  ('UT3000',              'accessory',  30,   true,  false, false,  null),
  ('Bypass',              'accessory',   5,   false, false, false,  null),
  ('eBypass',             'accessory',  10,   false, false, false,  null),
  ('DAPC',                'accessory',  10,   true,  false, false,  null),
  ('AprilAir',            'accessory',  10,   false, false, false,  null),
  ('RDS',                 'accessory',  10,   true,  true,  false,  null),
  ('Trane Harness',       'accessory',  10,   false, true,  false,  null),
  ('Ecoil Wire',          'accessory',  10,   false, true,  false,  null),
  ('LP Kit Lennox 1stg',  'accessory',  20,   true,  true,  false,  null),
  ('LP Kit Lennox 2stg',  'accessory',  20,   true,  true,  false,  null),
  ('LP Kit Goodman',      'accessory',  20,   true,  true,  false,  null),
  ('Weight-In-Data',      'accessory',  10,   false, true,  false,    10),
  ('Out of town fee',     'accessory',  null, false, false, true,   null),
  ('Other',               'accessory',  null, true,  false, true,   null)
ON CONFLICT (item_name) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2b. catalog_items — fixes (12 rows)
--    "Other Fix" avoids collision with the accessory "Other".
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO catalog_items
  (item_name, category, default_price, tech_supplied, multiplies_by_system_count, custom_price)
VALUES
  ('Pressure Test',           'fix',  10,   false, false, false),
  ('Open Ecoil',              'fix',  30,   false, false, false),
  ('Wires Jammed',            'fix',   5,   false, false, false),
  ('Stuck Blower',            'fix',  20,   false, false, false),
  ('Cut Sheetrock',           'fix',  15,   false, false, false),
  ('Extended Wire',           'fix',   5,   false, false, false),
  ('Extended Wire(Furnace)',  'fix',   5,   false, false, false),
  ('Extended Wire(Cunit)',    'fix',   5,   false, false, false),
  ('Leaks Ecoil',             'fix',  20,   false, false, false),
  ('Leaks Cunit',             'fix',  20,   false, false, false),
  ('Leaks Wall',              'fix',  50,   false, false, false),
  ('Other Fix',               'fix',  null, false, false, true)
ON CONFLICT (item_name) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2c. catalog_items — thermostats (8 rows)
--    default_price = 0: thermostat cost is derived by the price engine, not
--    from a fixed catalog price. All tech supplied.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO catalog_items
  (item_name, category, default_price, tech_supplied, multiplies_by_system_count, custom_price)
VALUES
  ('T-4',        'thermostat', 0, true, false, false),
  ('T-6',        'thermostat', 0, true, false, false),
  ('T-10',       'thermostat', 0, true, false, false),
  ('T-8321',     'thermostat', 0, true, false, false),
  ('Ecobee',     'thermostat', 0, true, false, false),
  ('Daikin One', 'thermostat', 0, true, false, false),
  ('TH2110',     'thermostat', 0, true, false, false),
  ('S1200',      'thermostat', 0, true, false, false)
ON CONFLICT (item_name) DO NOTHING;



-- 2c. W2 Acc + Fix: labels, sub-option groups, default template, wide tiles
--     (same values as migration 032).
-- Labels (keys untouched).
UPDATE catalog_items SET label = 'EEV Wire'   WHERE item_name = 'Ecoil Wire';
UPDATE catalog_items SET label = 'Open eCoil' WHERE item_name = 'Open Ecoil';
UPDATE catalog_items SET label = 'Weigh-in'   WHERE item_name = 'Weight-In-Data';

-- Sub-options: one tile per group; each option is its own charged line.
UPDATE catalog_items SET group_label = 'LP Kit', option_label = 'Lennox 1Stg' WHERE item_name = 'LP Kit Lennox 1stg';
UPDATE catalog_items SET group_label = 'LP Kit', option_label = 'Lennox 2Stg' WHERE item_name = 'LP Kit Lennox 2stg';
UPDATE catalog_items SET group_label = 'LP Kit', option_label = 'Goodman'     WHERE item_name = 'LP Kit Goodman';
UPDATE catalog_items SET group_label = 'Leaks',  option_label = 'eCoil'       WHERE item_name = 'Leaks Ecoil';
UPDATE catalog_items SET group_label = 'Leaks',  option_label = 'Cunit'       WHERE item_name = 'Leaks Cunit';
UPDATE catalog_items SET group_label = 'Leaks',  option_label = 'Wall'        WHERE item_name = 'Leaks Wall';
UPDATE catalog_items SET group_label = 'Ext. Wire', option_label = 'Furnace'  WHERE item_name = 'Extended Wire(Furnace)';
UPDATE catalog_items SET group_label = 'Ext. Wire', option_label = 'Cunit'    WHERE item_name = 'Extended Wire(Cunit)';

-- Ext. Wire needs a location: the location-less item is retired from selection.
UPDATE catalog_items SET selectable = false WHERE item_name = 'Extended Wire';

-- Default template for a technician with no history (W0 reply).
UPDATE catalog_items SET template_rank = 1 WHERE item_name = 'UT3000';
UPDATE catalog_items SET template_rank = 2 WHERE item_name = 'HZ322';
UPDATE catalog_items SET template_rank = 3 WHERE item_name = 'FIN180P';
UPDATE catalog_items SET template_rank = 4 WHERE item_name = 'Float Switch';
UPDATE catalog_items SET template_rank = 5 WHERE item_name = 'Weight-In-Data';
UPDATE catalog_items SET template_rank = 1 WHERE item_name = 'Pressure Test';
UPDATE catalog_items SET template_rank = 2 WHERE item_name = 'Open Ecoil';
UPDATE catalog_items SET template_rank = 3 WHERE item_name IN ('Leaks Ecoil', 'Leaks Cunit', 'Leaks Wall');

-- Wide tiles (span 2 of 3 columns); group tiles are always wide.
UPDATE catalog_items SET tile_wide = true WHERE item_name IN ('UT3000', 'Harmony');

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. catalog_item_relations (10 rows)
--    No unique constraint on (item_name, relation_type, related_item_name),
--    so WHERE NOT EXISTS is used for idempotency instead of ON CONFLICT.
--
--    Companions (auto-activate when trigger is selected):
--      HZ322  → Bypass
--      UT3000 → DAPC, eBypass, Ecoil Wire
--
--    Zone board exclusion group (mutually exclusive):
--      HZ322 ↔ Harmony ↔ UT3000 — all 6 directional pairs
-- ─────────────────────────────────────────────────────────────────────────────

WITH to_insert (item_name, relation_type, related_item_name, exclusion_group_id) AS (
  VALUES
    ('HZ322',   'companion',       'Bypass',      null::text),
    ('UT3000',  'companion',       'DAPC',         null),
    ('UT3000',  'companion',       'eBypass',      null),
    ('UT3000',  'companion',       'Ecoil Wire',   null),
    ('HZ322',   'exclusion_group', 'Harmony',     'zone-boards'),
    ('HZ322',   'exclusion_group', 'UT3000',      'zone-boards'),
    ('Harmony', 'exclusion_group', 'HZ322',       'zone-boards'),
    ('Harmony', 'exclusion_group', 'UT3000',      'zone-boards'),
    ('UT3000',  'exclusion_group', 'HZ322',       'zone-boards'),
    ('UT3000',  'exclusion_group', 'Harmony',     'zone-boards')
)
INSERT INTO catalog_item_relations (item_name, relation_type, related_item_name, exclusion_group_id)
SELECT t.item_name, t.relation_type, t.related_item_name, t.exclusion_group_id
FROM to_insert t
WHERE NOT EXISTS (
  SELECT 1 FROM catalog_item_relations r
  WHERE r.item_name         = t.item_name
    AND r.relation_type     = t.relation_type
    AND r.related_item_name = t.related_item_name
);


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. catalog_equipment — indoor (76 models)
--    unit_type: 'furnace' | 'air_handler'
--    pESP: reference value from prior field readings (NULL = no field data available)
--    No refrigerant / btu / charge fields for indoor units.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO catalog_equipment (model, unit_type, brand, series, pesp)
VALUES

  -- Lennox ML180UH SERIES
  ('ML180UH045E36A', 'furnace', 'Lennox', 'ML180UH SERIES', 0.6),
  ('ML180UH070E36A', 'furnace', 'Lennox', 'ML180UH SERIES', 0.9),
  ('ML180UH070E36B', 'furnace', 'Lennox', 'ML180UH SERIES', 0.9),
  ('ML180UH090E48B', 'furnace', 'Lennox', 'ML180UH SERIES', null),
  ('ML180UH090E60C', 'furnace', 'Lennox', 'ML180UH SERIES', 1.0),
  ('ML180UH110E60C', 'furnace', 'Lennox', 'ML180UH SERIES', 1.0),
  ('ML180UH135E60D', 'furnace', 'Lennox', 'ML180UH SERIES', null),

  -- Lennox ML180UHV SERIES (dip switch)
  ('ML180UH030V36A', 'furnace', 'Lennox', 'ML180UHV SERIES(DIP SWITCH)', null),
  ('ML180UH045V36A', 'furnace', 'Lennox', 'ML180UHV SERIES(DIP SWITCH)', null),
  ('ML180UH070V36A', 'furnace', 'Lennox', 'ML180UHV SERIES(DIP SWITCH)', null),
  ('ML180UH070V48B', 'furnace', 'Lennox', 'ML180UHV SERIES(DIP SWITCH)', null),
  ('ML180UH090V48B', 'furnace', 'Lennox', 'ML180UHV SERIES(DIP SWITCH)', null),
  ('ML180UH110V60C', 'furnace', 'Lennox', 'ML180UHV SERIES(DIP SWITCH)', null),

  -- Lennox ML196UH SERIES (high efficiency)
  ('ML196UH030XE36B', 'furnace', 'Lennox', 'ML196UH SERIES(HIGH EFFICIENCY)', 0.7),
  ('ML196UH045XE36B', 'furnace', 'Lennox', 'ML196UH SERIES(HIGH EFFICIENCY)', 0.6),
  ('ML196UH070XE36B', 'furnace', 'Lennox', 'ML196UH SERIES(HIGH EFFICIENCY)', 0.7),
  ('ML196UH070XE48B', 'furnace', 'Lennox', 'ML196UH SERIES(HIGH EFFICIENCY)', null),
  ('ML196UH090XE36C', 'furnace', 'Lennox', 'ML196UH SERIES(HIGH EFFICIENCY)', null),
  ('ML196UH090XE48C', 'furnace', 'Lennox', 'ML196UH SERIES(HIGH EFFICIENCY)', 0.7),
  ('ML196UH090XE60C', 'furnace', 'Lennox', 'ML196UH SERIES(HIGH EFFICIENCY)', 1.0),
  ('ML196UH110XE60C', 'furnace', 'Lennox', 'ML196UH SERIES(HIGH EFFICIENCY)', 1.0),
  ('ML196UH135XE60D', 'furnace', 'Lennox', 'ML196UH SERIES(HIGH EFFICIENCY)', null),

  -- Lennox ML296UH SERIES
  ('ML296UH045XV36B', 'furnace', 'Lennox', 'ML296UH SERIES', null),
  ('ML296UH070XV36B', 'furnace', 'Lennox', 'ML296UH SERIES', null),
  ('ML296UH090XV48C', 'furnace', 'Lennox', 'ML296UH SERIES', null),
  ('ML296UH110XV60C', 'furnace', 'Lennox', 'ML296UH SERIES', null),

  -- Lennox EL196UH SERIES
  ('EL196UH030XE36BK', 'furnace', 'Lennox', 'EL196UH SERIES', 0.0),
  ('EL196UH045XE36BK', 'furnace', 'Lennox', 'EL196UH SERIES', 0.0),
  ('EL196UH070XE36BK', 'furnace', 'Lennox', 'EL196UH SERIES', 0.7),
  ('EL196UH090XE48CK', 'furnace', 'Lennox', 'EL196UH SERIES', 0.7),
  ('EL196UH110XE60CK', 'furnace', 'Lennox', 'EL196UH SERIES', 0.7),

  -- Lennox CBK45UHET SERIES (air handler)
  ('CBK45UHET024', 'air_handler', 'Lennox', 'CBK45UHET SERIES', null),
  ('CBK45UHET030', 'air_handler', 'Lennox', 'CBK45UHET SERIES', null),
  ('CBK45UHET036', 'air_handler', 'Lennox', 'CBK45UHET SERIES', null),
  ('CBK45UHET042', 'air_handler', 'Lennox', 'CBK45UHET SERIES', null),
  ('CBK45UHET048', 'air_handler', 'Lennox', 'CBK45UHET SERIES', null),
  ('CBK45UHET060', 'air_handler', 'Lennox', 'CBK45UHET SERIES', null),

  -- Lennox CBA25UH SERIES (air handler)
  ('CBA25UH018', 'air_handler', 'Lennox', 'CBA25UH SERIES', null),
  ('CBA25UH024', 'air_handler', 'Lennox', 'CBA25UH SERIES', null),
  ('CBA25UH030', 'air_handler', 'Lennox', 'CBA25UH SERIES', null),
  ('CBA25UH036', 'air_handler', 'Lennox', 'CBA25UH SERIES', null),
  ('CBA25UH042', 'air_handler', 'Lennox', 'CBA25UH SERIES', null),
  ('CBA25UH048', 'air_handler', 'Lennox', 'CBA25UH SERIES', null),
  ('CBA25UH060', 'air_handler', 'Lennox', 'CBA25UH SERIES', null),

  -- Trane S8X1/S8X2-S8B1
  ('S8X1A040M3PSC', 'furnace', 'Trane', 'S8X1/S8X2-S8B1', null),
  ('S8X1B040M2PSC', 'furnace', 'Trane', 'S8X1/S8X2-S8B1', 0.9),
  ('S8X1B060M4PSC', 'furnace', 'Trane', 'S8X1/S8X2-S8B1', 0.8),
  ('S8X1B080M4PSC', 'furnace', 'Trane', 'S8X1/S8X2-S8B1', null),
  ('S8X1C080M5PSC', 'furnace', 'Trane', 'S8X1/S8X2-S8B1', null),
  ('S8X1C100M5PSC', 'furnace', 'Trane', 'S8X1/S8X2-S8B1', null),
  ('S8X1D120M5PSC', 'furnace', 'Trane', 'S8X1/S8X2-S8B1', null),

  -- Goodman GR9S80 SERIES
  ('GR9S800403AU', 'furnace', 'Goodman', 'GR9S80 SERIES', 0.0),
  ('GR9S800603AU', 'furnace', 'Goodman', 'GR9S80 SERIES', 0.6),
  ('GR9S800604BU', 'furnace', 'Goodman', 'GR9S80 SERIES', null),
  ('GR9S800804BU', 'furnace', 'Goodman', 'GR9S80 SERIES', null),
  ('GR9S800805CU', 'furnace', 'Goodman', 'GR9S80 SERIES', null),

  -- Goodman AMSTU1300 SERIES (air handler)
  ('AMST24BU', 'air_handler', 'Goodman', 'AMSTU1300 SERIES', null),
  ('AMST30BU', 'air_handler', 'Goodman', 'AMSTU1300 SERIES', null),
  ('AMST36BU', 'air_handler', 'Goodman', 'AMSTU1300 SERIES', null),
  ('AMST36CU', 'air_handler', 'Goodman', 'AMSTU1300 SERIES', null),
  ('AMST42CU', 'air_handler', 'Goodman', 'AMSTU1300 SERIES', null),
  ('AMST48CU', 'air_handler', 'Goodman', 'AMSTU1300 SERIES', null),
  ('AMST48DU', 'air_handler', 'Goodman', 'AMSTU1300 SERIES', null),
  ('AMST60DU', 'air_handler', 'Goodman', 'AMSTU1300 SERIES', null),

  -- Daikin DR96TC / DD96TC SERIES
  ('DR96TC0403BN', 'furnace', 'Daikin', 'DR96TC/DD96TC SERIES', 0.5),
  ('DR96TC0603BN', 'furnace', 'Daikin', 'DR96TC/DD96TC SERIES', 0.5),
  ('DR96TC0803BN', 'furnace', 'Daikin', 'DR96TC/DD96TC SERIES', 0.5),
  ('DR96TC0804CN', 'furnace', 'Daikin', 'DR96TC/DD96TC SERIES', 0.5),
  ('DR96TC1005CN', 'furnace', 'Daikin', 'DR96TC/DD96TC SERIES', 0.5),
  ('DR96TC1005DN', 'furnace', 'Daikin', 'DR96TC/DD96TC SERIES', 0.5),
  ('DR96TC1205DN', 'furnace', 'Daikin', 'DR96TC/DD96TC SERIES', 0.5),
  ('DD96TC0403BN', 'furnace', 'Daikin', 'DR96TC/DD96TC SERIES', 0.5),
  ('DD96TC0603BN', 'furnace', 'Daikin', 'DR96TC/DD96TC SERIES', 0.5),
  ('DD96TC0804CN', 'furnace', 'Daikin', 'DR96TC/DD96TC SERIES', 0.5),
  ('DD96TC1005CN', 'furnace', 'Daikin', 'DR96TC/DD96TC SERIES', 0.5),
  ('DD96TC1205DN', 'furnace', 'Daikin', 'DR96TC/DD96TC SERIES', 0.5)

ON CONFLICT (model) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4b. catalog_equipment — outdoor (68 models)
--    unit_type: 'condenser' | 'heat_pump'
--    is_a2l: true for R-454B and R-32 (A2L class), false for R-410A (A1, legacy)
--    Factory charges live in catalog_equipment_charges (section 4c).
--    R-410A series included as legacy active per CATALOG_REVIEW.md.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO catalog_equipment
  (model, unit_type, brand, series, refrigerant, is_a2l, btu)
VALUES

  -- Lennox ML17XC1 — R-410A condenser (legacy)
  ('ML17XC1-018', 'condenser', 'Lennox', 'ML17XC1', 'R-410A', false, 18000),
  ('ML17XC1-024', 'condenser', 'Lennox', 'ML17XC1', 'R-410A', false, 24000),
  ('ML17XC1-030', 'condenser', 'Lennox', 'ML17XC1', 'R-410A', false, 30000),
  ('ML17XC1-036', 'condenser', 'Lennox', 'ML17XC1', 'R-410A', false, 36000),
  ('ML17XC1-042', 'condenser', 'Lennox', 'ML17XC1', 'R-410A', false, 42000),
  ('ML17XC1-047', 'condenser', 'Lennox', 'ML17XC1', 'R-410A', false, 47000),
  ('ML17XC1-059', 'condenser', 'Lennox', 'ML17XC1', 'R-410A', false, 59000),

  -- Lennox ML18XC2 — R-410A condenser (legacy)
  ('ML18XC2-036', 'condenser', 'Lennox', 'ML18XC2', 'R-410A', false, 36000),
  ('ML18XC2-048', 'condenser', 'Lennox', 'ML18XC2', 'R-410A', false, 48000),

  -- Lennox EL17XP1 — R-410A heat pump (legacy)
  ('EL17XP1-18', 'heat_pump', 'Lennox', 'EL17XP1', 'R-410A', false, 18000),
  ('EL17XP1-24', 'heat_pump', 'Lennox', 'EL17XP1', 'R-410A', false, 24000),
  ('EL17XP1-30', 'heat_pump', 'Lennox', 'EL17XP1', 'R-410A', false, 30000),
  ('EL17XP1-36', 'heat_pump', 'Lennox', 'EL17XP1', 'R-410A', false, 36000),
  ('EL17XP1-42', 'heat_pump', 'Lennox', 'EL17XP1', 'R-410A', false, 42000),
  ('EL17XP1-48', 'heat_pump', 'Lennox', 'EL17XP1', 'R-410A', false, 48000),
  ('EL17XP1-60', 'heat_pump', 'Lennox', 'EL17XP1', 'R-410A', false, 60000),

  -- Lennox ML14KC1 — R-454B condenser (all revised charges field-verified)
  ('ML14KC1-018', 'condenser', 'Lennox', 'ML14KC1', 'R-454B', true, 18000),
  ('ML14KC1-024', 'condenser', 'Lennox', 'ML14KC1', 'R-454B', true, 24000),
  ('ML14KC1-030', 'condenser', 'Lennox', 'ML14KC1', 'R-454B', true, 30000),
  ('ML14KC1-036', 'condenser', 'Lennox', 'ML14KC1', 'R-454B', true, 36000),
  ('ML14KC1-041', 'condenser', 'Lennox', 'ML14KC1', 'R-454B', true, 41000),
  ('ML14KC1-042', 'condenser', 'Lennox', 'ML14KC1', 'R-454B', true, 42000),
  ('ML14KC1-047', 'condenser', 'Lennox', 'ML14KC1', 'R-454B', true, 47000),
  ('ML14KC1-048', 'condenser', 'Lennox', 'ML14KC1', 'R-454B', true, 48000),
  ('ML14KC1-059', 'condenser', 'Lennox', 'ML14KC1', 'R-454B', true, 59000),
  ('ML14KC1-060', 'condenser', 'Lennox', 'ML14KC1', 'R-454B', true, 60000),

  -- Lennox ML17KC2 — R-454B condenser (revised charges not yet field-verified)
  ('ML17KC2-024', 'condenser', 'Lennox', 'ML17KC2', 'R-454B', true, 24000),
  ('ML17KC2-036', 'condenser', 'Lennox', 'ML17KC2', 'R-454B', true, 36000),
  ('ML17KC2-048', 'condenser', 'Lennox', 'ML17KC2', 'R-454B', true, 48000),
  ('ML17KC2-060', 'condenser', 'Lennox', 'ML17KC2', 'R-454B', true, 60000),

  -- Trane 4TTR — R-410A condenser (legacy)
  ('4TTR6024N1000AA', 'condenser', 'Trane', '4TTR', 'R-410A', false, 24000),
  ('4TTR5042A1000AA', 'condenser', 'Trane', '4TTR', 'R-410A', false, 42000),
  ('4TTR5048A1000AA', 'condenser', 'Trane', '4TTR', 'R-410A', false, 48000),
  ('4TTR5060A1000AA', 'condenser', 'Trane', '4TTR', 'R-410A', false, 60000),

  -- Trane 5TTR — R-454B condenser (partial revised charges)
  ('5TTR5018', 'condenser', 'Trane', '5TTR', 'R-454B', true, 18000),
  ('5TTR5024', 'condenser', 'Trane', '5TTR', 'R-454B', true, 24000),
  ('5TTR5030', 'condenser', 'Trane', '5TTR', 'R-454B', true, 30000),
  ('5TTR5036', 'condenser', 'Trane', '5TTR', 'R-454B', true, 36000),
  ('5TTR5042', 'condenser', 'Trane', '5TTR', 'R-454B', true, 42000),
  ('5TTR5048', 'condenser', 'Trane', '5TTR', 'R-454B', true, 48000),
  ('5TTR5060', 'condenser', 'Trane', '5TTR', 'R-454B', true, 60000),

  -- Goodman GLXS4BA — R-32 condenser
  ('GLXS4BA1810AA', 'condenser', 'Goodman', 'GLXS4BA', 'R-32', true, 18000),
  ('GLXS4BA2410AA', 'condenser', 'Goodman', 'GLXS4BA', 'R-32', true, 24000),
  ('GLXS4BA3010AA', 'condenser', 'Goodman', 'GLXS4BA', 'R-32', true, 30000),
  ('GLXS4BA3610AA', 'condenser', 'Goodman', 'GLXS4BA', 'R-32', true, 36000),
  ('GLXS4BA4210AA', 'condenser', 'Goodman', 'GLXS4BA', 'R-32', true, 42000),
  ('GLXS4BA4810AA', 'condenser', 'Goodman', 'GLXS4BA', 'R-32', true, 48000),
  ('GLXS4BA6010AA', 'condenser', 'Goodman', 'GLXS4BA', 'R-32', true, 60000),

  -- Goodman GLXS5BA — R-32 condenser
  ('GLXS5BA1810AA', 'condenser', 'Goodman', 'GLXS5BA', 'R-32', true, 18000),
  ('GLXS5BA2410AA', 'condenser', 'Goodman', 'GLXS5BA', 'R-32', true, 24000),
  ('GLXS5BA3010AA', 'condenser', 'Goodman', 'GLXS5BA', 'R-32', true, 30000),
  ('GLXS5BA3610AA', 'condenser', 'Goodman', 'GLXS5BA', 'R-32', true, 36000),
  ('GLXS5BA4210AA', 'condenser', 'Goodman', 'GLXS5BA', 'R-32', true, 42000),
  ('GLXS5BA4810AA', 'condenser', 'Goodman', 'GLXS5BA', 'R-32', true, 48000),
  ('GLXS5BA6010AA', 'condenser', 'Goodman', 'GLXS5BA', 'R-32', true, 60000),

  -- Goodman GLZS4BA — R-32 heat pump
  ('GLZS4BA1810AA', 'heat_pump', 'Goodman', 'GLZS4BA', 'R-32', true, 18000),
  ('GLZS4BA2410AA', 'heat_pump', 'Goodman', 'GLZS4BA', 'R-32', true, 24000),
  ('GLZS4BA3010AA', 'heat_pump', 'Goodman', 'GLZS4BA', 'R-32', true, 30000),
  ('GLZS4BA3610AA', 'heat_pump', 'Goodman', 'GLZS4BA', 'R-32', true, 36000),
  ('GLZS4BA4210AA', 'heat_pump', 'Goodman', 'GLZS4BA', 'R-32', true, 42000),
  ('GLZS4BA4810AA', 'heat_pump', 'Goodman', 'GLZS4BA', 'R-32', true, 48000),
  ('GLZS4BA6010AA', 'heat_pump', 'Goodman', 'GLZS4BA', 'R-32', true, 60000),

  -- Daikin DC6VSS — R-32 condenser (no charge for 4810 and 6010)
  ('DC6VSS2410', 'condenser', 'Daikin', 'DC6VSS', 'R-32', true, 24000),
  ('DC6VSS3010', 'condenser', 'Daikin', 'DC6VSS', 'R-32', true, 30000),
  ('DC6VSS3610', 'condenser', 'Daikin', 'DC6VSS', 'R-32', true, 36000),
  ('DC6VSS4210', 'condenser', 'Daikin', 'DC6VSS', 'R-32', true, 42000),
  ('DC6VSS4810', 'condenser', 'Daikin', 'DC6VSS', 'R-32', true, 48000),
  ('DC6VSS6010', 'condenser', 'Daikin', 'DC6VSS', 'R-32', true, 60000)

ON CONFLICT (model) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4c. catalog_manufacturers and catalog_equipment_charges (W3)
--    A factory charge per manufacturer + factory length. Former "factory"
--    values are the 15 ft charge; former "revised" values are Trane 25 ft
--    and Lennox 30 ft. A missing combination is typed by the technician.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO catalog_manufacturers (name, oz_per_ft, default_length_ft) VALUES
  ('Daikin', 0.6, 15), ('Goodman', 0.6, 15), ('Lennox', 0.6, 30), ('Trane', 0.47, 15)
ON CONFLICT (name) DO NOTHING;

INSERT INTO catalog_equipment_charges (model, manufacturer, length_ft, charge_oz)
VALUES
  ('ML17XC1-018', 'Lennox', 15, 72),
  ('ML17XC1-024', 'Lennox', 15, 82),
  ('ML17XC1-030', 'Lennox', 15, 104),
  ('ML17XC1-036', 'Lennox', 15, 136),
  ('ML17XC1-042', 'Lennox', 15, 146),
  ('ML17XC1-047', 'Lennox', 15, 157),
  ('ML17XC1-059', 'Lennox', 15, 190),
  ('ML18XC2-036', 'Lennox', 15, 128),
  ('ML18XC2-048', 'Lennox', 15, 177),
  ('EL17XP1-18', 'Lennox', 15, 92),
  ('EL17XP1-24', 'Lennox', 15, 90),
  ('EL17XP1-30', 'Lennox', 15, 111),
  ('EL17XP1-36', 'Lennox', 15, 131),
  ('EL17XP1-42', 'Lennox', 15, 156),
  ('EL17XP1-48', 'Lennox', 15, 140),
  ('EL17XP1-60', 'Lennox', 15, 158),
  ('ML14KC1-018', 'Lennox', 15, 78),
  ('ML14KC1-018', 'Lennox', 30, 92),
  ('ML14KC1-024', 'Lennox', 15, 78),
  ('ML14KC1-024', 'Lennox', 30, 87),
  ('ML14KC1-030', 'Lennox', 15, 90),
  ('ML14KC1-030', 'Lennox', 30, 99),
  ('ML14KC1-036', 'Lennox', 15, 109),
  ('ML14KC1-036', 'Lennox', 30, 118),
  ('ML14KC1-041', 'Lennox', 15, 119),
  ('ML14KC1-041', 'Lennox', 30, 128),
  ('ML14KC1-042', 'Lennox', 15, 114),
  ('ML14KC1-042', 'Lennox', 30, 123),
  ('ML14KC1-047', 'Lennox', 15, 125),
  ('ML14KC1-047', 'Lennox', 30, 134),
  ('ML14KC1-048', 'Lennox', 15, 142),
  ('ML14KC1-048', 'Lennox', 30, 151),
  ('ML14KC1-059', 'Lennox', 15, 152),
  ('ML14KC1-059', 'Lennox', 30, 161),
  ('ML14KC1-060', 'Lennox', 15, 142),
  ('ML14KC1-060', 'Lennox', 30, 151),
  ('ML17KC2-024', 'Lennox', 15, 100),
  ('ML17KC2-036', 'Lennox', 15, 104),
  ('ML17KC2-048', 'Lennox', 15, 126),
  ('ML17KC2-060', 'Lennox', 15, 149),
  ('4TTR6024N1000AA', 'Trane', 15, 148),
  ('4TTR5042A1000AA', 'Trane', 15, 130),
  ('4TTR5048A1000AA', 'Trane', 15, 114),
  ('4TTR5060A1000AA', 'Trane', 15, 152),
  ('5TTR5018', 'Trane', 15, 60),
  ('5TTR5024', 'Trane', 15, 58),
  ('5TTR5024', 'Trane', 25, 83),
  ('5TTR5030', 'Trane', 15, 56),
  ('5TTR5036', 'Trane', 15, 56),
  ('5TTR5036', 'Trane', 25, 80),
  ('5TTR5042', 'Trane', 15, 81),
  ('5TTR5048', 'Trane', 15, 106),
  ('5TTR5048', 'Trane', 25, 130),
  ('5TTR5060', 'Trane', 15, 95),
  ('5TTR5060', 'Trane', 25, 119),
  ('GLXS4BA1810AA', 'Goodman', 15, 53),
  ('GLXS4BA2410AA', 'Goodman', 15, 53),
  ('GLXS4BA3010AA', 'Goodman', 15, 63),
  ('GLXS4BA3610AA', 'Goodman', 15, 69),
  ('GLXS4BA4210AA', 'Goodman', 15, 83),
  ('GLXS4BA4810AA', 'Goodman', 15, 91),
  ('GLXS4BA6010AA', 'Goodman', 15, 94),
  ('GLXS5BA1810AA', 'Goodman', 15, 54),
  ('GLXS5BA2410AA', 'Goodman', 15, 65),
  ('GLXS5BA3010AA', 'Goodman', 15, 87),
  ('GLXS5BA3610AA', 'Goodman', 15, 88),
  ('GLXS5BA4210AA', 'Goodman', 15, 141),
  ('GLXS5BA4810AA', 'Goodman', 15, 138),
  ('GLXS5BA6010AA', 'Goodman', 15, 167),
  ('GLZS4BA1810AA', 'Goodman', 15, 70),
  ('GLZS4BA2410AA', 'Goodman', 15, 70),
  ('GLZS4BA3010AA', 'Goodman', 15, 81),
  ('GLZS4BA3610AA', 'Goodman', 15, 83),
  ('GLZS4BA4210AA', 'Goodman', 15, 139),
  ('GLZS4BA4810AA', 'Goodman', 15, 174),
  ('GLZS4BA6010AA', 'Goodman', 15, 194),
  ('DC6VSS2410', 'Daikin', 15, 74),
  ('DC6VSS3010', 'Daikin', 15, 76),
  ('DC6VSS3610', 'Daikin', 15, 83),
  ('DC6VSS4210', 'Daikin', 15, 100)
ON CONFLICT DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- catalog_lineset_configs (7 rows) — kept only for Weigh-In readings
-- recorded before W3 (weigh_in_data.factory_line_config).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO catalog_lineset_configs (config_key, reference_length_ft, adjust_rate_oz_per_ft, brand)
VALUES
  ('TRANE-PRE-2025', 10, 0.47, 'Trane'),
  ('TRANE-MID-2025', 25, 0.47, 'Trane'),
  ('TRANE-2026',     15, 0.47, 'Trane'),
  ('LENNOX-30',      30, 0.60, 'Lennox'),
  ('LENNOX-15',      15, 0.60, 'Lennox'),
  ('GOODMAN',        15, 0.60, 'Goodman'),
  ('DAIKIN',         15, 0.60, 'Daikin')
ON CONFLICT (config_key) DO NOTHING;
