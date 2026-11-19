-- W2 (Acc + Fix): display labels, sub-option groups, default template rank,
-- wide tiles and items retired from selection. Item keys (item_name) and
-- report history are unchanged; labels are what the Workspace shows.
ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS label text,
  ADD COLUMN IF NOT EXISTS group_label text,
  ADD COLUMN IF NOT EXISTS option_label text,
  ADD COLUMN IF NOT EXISTS template_rank integer,
  ADD COLUMN IF NOT EXISTS tile_wide boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS selectable boolean NOT NULL DEFAULT true;

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
