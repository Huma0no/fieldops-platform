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
-- 1. catalog_services (6 rows)
--    "Finish" is a visit modifier (visit_services.is_finish), not a catalog
--    service — excluded intentionally.
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
  ('Other',               'accessory',  null, false, false, true,   null)
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
-- 2c. catalog_items — thermostats (7 rows)
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
  ('TH2110',     'thermostat', 0, true, false, false)
ON CONFLICT (item_name) DO NOTHING;


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
--    revised_charge_oz: post-May-2025 field-adjusted value for R-454B units;
--                       NULL = not yet field-verified
--    R-410A series included as legacy active per CATALOG_REVIEW.md.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO catalog_equipment
  (model, unit_type, brand, series, refrigerant, is_a2l, btu, factory_charge_oz, revised_charge_oz)
VALUES

  -- Lennox ML17XC1 — R-410A condenser (legacy)
  ('ML17XC1-018', 'condenser', 'Lennox', 'ML17XC1', 'R-410A', false, 18000,  72, null),
  ('ML17XC1-024', 'condenser', 'Lennox', 'ML17XC1', 'R-410A', false, 24000,  82, null),
  ('ML17XC1-030', 'condenser', 'Lennox', 'ML17XC1', 'R-410A', false, 30000, 104, null),
  ('ML17XC1-036', 'condenser', 'Lennox', 'ML17XC1', 'R-410A', false, 36000, 136, null),
  ('ML17XC1-042', 'condenser', 'Lennox', 'ML17XC1', 'R-410A', false, 42000, 146, null),
  ('ML17XC1-047', 'condenser', 'Lennox', 'ML17XC1', 'R-410A', false, 47000, 157, null),
  ('ML17XC1-059', 'condenser', 'Lennox', 'ML17XC1', 'R-410A', false, 59000, 190, null),

  -- Lennox ML18XC2 — R-410A condenser (legacy)
  ('ML18XC2-036', 'condenser', 'Lennox', 'ML18XC2', 'R-410A', false, 36000, 128, null),
  ('ML18XC2-048', 'condenser', 'Lennox', 'ML18XC2', 'R-410A', false, 48000, 177, null),

  -- Lennox EL17XP1 — R-410A heat pump (legacy)
  ('EL17XP1-18',  'heat_pump', 'Lennox', 'EL17XP1', 'R-410A', false, 18000,  92, null),
  ('EL17XP1-24',  'heat_pump', 'Lennox', 'EL17XP1', 'R-410A', false, 24000,  90, null),
  ('EL17XP1-30',  'heat_pump', 'Lennox', 'EL17XP1', 'R-410A', false, 30000, 111, null),
  ('EL17XP1-36',  'heat_pump', 'Lennox', 'EL17XP1', 'R-410A', false, 36000, 131, null),
  ('EL17XP1-42',  'heat_pump', 'Lennox', 'EL17XP1', 'R-410A', false, 42000, 156, null),
  ('EL17XP1-48',  'heat_pump', 'Lennox', 'EL17XP1', 'R-410A', false, 48000, 140, null),
  ('EL17XP1-60',  'heat_pump', 'Lennox', 'EL17XP1', 'R-410A', false, 60000, 158, null),

  -- Lennox ML14KC1 — R-454B condenser (all revised charges field-verified)
  ('ML14KC1-018', 'condenser', 'Lennox', 'ML14KC1', 'R-454B', true, 18000,  78,  92),
  ('ML14KC1-024', 'condenser', 'Lennox', 'ML14KC1', 'R-454B', true, 24000,  78,  87),
  ('ML14KC1-030', 'condenser', 'Lennox', 'ML14KC1', 'R-454B', true, 30000,  90,  99),
  ('ML14KC1-036', 'condenser', 'Lennox', 'ML14KC1', 'R-454B', true, 36000, 109, 118),
  ('ML14KC1-041', 'condenser', 'Lennox', 'ML14KC1', 'R-454B', true, 41000, 119, 128),
  ('ML14KC1-042', 'condenser', 'Lennox', 'ML14KC1', 'R-454B', true, 42000, 114, 123),
  ('ML14KC1-047', 'condenser', 'Lennox', 'ML14KC1', 'R-454B', true, 47000, 125, 134),
  ('ML14KC1-048', 'condenser', 'Lennox', 'ML14KC1', 'R-454B', true, 48000, 142, 151),
  ('ML14KC1-059', 'condenser', 'Lennox', 'ML14KC1', 'R-454B', true, 59000, 152, 161),
  ('ML14KC1-060', 'condenser', 'Lennox', 'ML14KC1', 'R-454B', true, 60000, 142, 151),

  -- Lennox ML17KC2 — R-454B condenser (revised charges not yet field-verified)
  ('ML17KC2-024', 'condenser', 'Lennox', 'ML17KC2', 'R-454B', true, 24000, 100, null),
  ('ML17KC2-036', 'condenser', 'Lennox', 'ML17KC2', 'R-454B', true, 36000, 104, null),
  ('ML17KC2-048', 'condenser', 'Lennox', 'ML17KC2', 'R-454B', true, 48000, 126, null),
  ('ML17KC2-060', 'condenser', 'Lennox', 'ML17KC2', 'R-454B', true, 60000, 149, null),

  -- Trane 4TTR — R-410A condenser (legacy)
  ('4TTR6024N1000AA', 'condenser', 'Trane', '4TTR', 'R-410A', false, 24000, 148, null),
  ('4TTR5042A1000AA', 'condenser', 'Trane', '4TTR', 'R-410A', false, 42000, 130, null),
  ('4TTR5048A1000AA', 'condenser', 'Trane', '4TTR', 'R-410A', false, 48000, 114, null),
  ('4TTR5060A1000AA', 'condenser', 'Trane', '4TTR', 'R-410A', false, 60000, 152, null),

  -- Trane 5TTR — R-454B condenser (partial revised charges)
  ('5TTR5018', 'condenser', 'Trane', '5TTR', 'R-454B', true, 18000,  60, null),
  ('5TTR5024', 'condenser', 'Trane', '5TTR', 'R-454B', true, 24000,  58,   83),
  ('5TTR5030', 'condenser', 'Trane', '5TTR', 'R-454B', true, 30000,  56, null),
  ('5TTR5036', 'condenser', 'Trane', '5TTR', 'R-454B', true, 36000,  56,   80),
  ('5TTR5042', 'condenser', 'Trane', '5TTR', 'R-454B', true, 42000,  81, null),
  ('5TTR5048', 'condenser', 'Trane', '5TTR', 'R-454B', true, 48000, 106,  130),
  ('5TTR5060', 'condenser', 'Trane', '5TTR', 'R-454B', true, 60000,  95,  119),

  -- Goodman GLXS4BA — R-32 condenser
  ('GLXS4BA1810AA', 'condenser', 'Goodman', 'GLXS4BA', 'R-32', true, 18000,  53, null),
  ('GLXS4BA2410AA', 'condenser', 'Goodman', 'GLXS4BA', 'R-32', true, 24000,  53, null),
  ('GLXS4BA3010AA', 'condenser', 'Goodman', 'GLXS4BA', 'R-32', true, 30000,  63, null),
  ('GLXS4BA3610AA', 'condenser', 'Goodman', 'GLXS4BA', 'R-32', true, 36000,  69, null),
  ('GLXS4BA4210AA', 'condenser', 'Goodman', 'GLXS4BA', 'R-32', true, 42000,  83, null),
  ('GLXS4BA4810AA', 'condenser', 'Goodman', 'GLXS4BA', 'R-32', true, 48000,  91, null),
  ('GLXS4BA6010AA', 'condenser', 'Goodman', 'GLXS4BA', 'R-32', true, 60000,  94, null),

  -- Goodman GLXS5BA — R-32 condenser
  ('GLXS5BA1810AA', 'condenser', 'Goodman', 'GLXS5BA', 'R-32', true, 18000,  54, null),
  ('GLXS5BA2410AA', 'condenser', 'Goodman', 'GLXS5BA', 'R-32', true, 24000,  65, null),
  ('GLXS5BA3010AA', 'condenser', 'Goodman', 'GLXS5BA', 'R-32', true, 30000,  87, null),
  ('GLXS5BA3610AA', 'condenser', 'Goodman', 'GLXS5BA', 'R-32', true, 36000,  88, null),
  ('GLXS5BA4210AA', 'condenser', 'Goodman', 'GLXS5BA', 'R-32', true, 42000, 141, null),
  ('GLXS5BA4810AA', 'condenser', 'Goodman', 'GLXS5BA', 'R-32', true, 48000, 138, null),
  ('GLXS5BA6010AA', 'condenser', 'Goodman', 'GLXS5BA', 'R-32', true, 60000, 167, null),

  -- Goodman GLZS4BA — R-32 heat pump
  ('GLZS4BA1810AA', 'heat_pump', 'Goodman', 'GLZS4BA', 'R-32', true, 18000,  70, null),
  ('GLZS4BA2410AA', 'heat_pump', 'Goodman', 'GLZS4BA', 'R-32', true, 24000,  70, null),
  ('GLZS4BA3010AA', 'heat_pump', 'Goodman', 'GLZS4BA', 'R-32', true, 30000,  81, null),
  ('GLZS4BA3610AA', 'heat_pump', 'Goodman', 'GLZS4BA', 'R-32', true, 36000,  83, null),
  ('GLZS4BA4210AA', 'heat_pump', 'Goodman', 'GLZS4BA', 'R-32', true, 42000, 139, null),
  ('GLZS4BA4810AA', 'heat_pump', 'Goodman', 'GLZS4BA', 'R-32', true, 48000, 174, null),
  ('GLZS4BA6010AA', 'heat_pump', 'Goodman', 'GLZS4BA', 'R-32', true, 60000, 194, null),

  -- Daikin DC6VSS — R-32 condenser (factory_charge_oz NULL for 4810 and 6010)
  ('DC6VSS2410', 'condenser', 'Daikin', 'DC6VSS', 'R-32', true, 24000,  74, null),
  ('DC6VSS3010', 'condenser', 'Daikin', 'DC6VSS', 'R-32', true, 30000,  76, null),
  ('DC6VSS3610', 'condenser', 'Daikin', 'DC6VSS', 'R-32', true, 36000,  83, null),
  ('DC6VSS4210', 'condenser', 'Daikin', 'DC6VSS', 'R-32', true, 42000, 100, null),
  ('DC6VSS4810', 'condenser', 'Daikin', 'DC6VSS', 'R-32', true, 48000, null, null),
  ('DC6VSS6010', 'condenser', 'Daikin', 'DC6VSS', 'R-32', true, 60000, null, null)

ON CONFLICT (model) DO NOTHING;
