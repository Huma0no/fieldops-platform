-- EEV Wire (Kristo, 2026-11-25): the UT3000 companion "Ecoil Wire" (label
-- "EEV Wire") is renamed "EEV Wire" everywhere; its report text is unchanged.
-- A standalone "EEV Wire" row added by hand through the Catalog editor (pilot,
-- FT-07) is a duplicate: it is removed first, and only when nothing uses it.
-- No-op on a database without "Ecoil Wire" (e.g. one built from the seed).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM catalog_items WHERE item_name = 'Ecoil Wire') THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM catalog_items WHERE item_name = 'EEV Wire') THEN
    IF EXISTS (SELECT 1 FROM visit_items WHERE item_name = 'EEV Wire')
       OR EXISTS (SELECT 1 FROM catalog_item_relations WHERE 'EEV Wire' IN (item_name, related_item_name))
       OR EXISTS (SELECT 1 FROM inventory_assignments WHERE item_name = 'EEV Wire')
       OR EXISTS (SELECT 1 FROM restock_records WHERE item_name = 'EEV Wire')
       OR EXISTS (SELECT 1 FROM technician_price_overrides WHERE item_name = 'EEV Wire') THEN
      RAISE EXCEPTION 'A separate "EEV Wire" catalog item is in use; merge it by hand before renaming "Ecoil Wire"';
    END IF;
    DELETE FROM catalog_items WHERE item_name = 'EEV Wire';
  END IF;

  INSERT INTO catalog_items
    (item_name, category, default_price, tech_supplied, multiplies_by_system_count, custom_price,
     expected_price_min, expected_price_max, finish_addon_price, label, group_label, option_label,
     template_rank, tile_wide, selectable)
  SELECT 'EEV Wire', category, default_price, tech_supplied, multiplies_by_system_count, custom_price,
         expected_price_min, expected_price_max, finish_addon_price, NULL, group_label, option_label,
         template_rank, tile_wide, selectable
  FROM catalog_items WHERE item_name = 'Ecoil Wire';

  UPDATE visit_items                SET item_name = 'EEV Wire'         WHERE item_name = 'Ecoil Wire';
  UPDATE catalog_item_relations     SET item_name = 'EEV Wire'         WHERE item_name = 'Ecoil Wire';
  UPDATE catalog_item_relations     SET related_item_name = 'EEV Wire' WHERE related_item_name = 'Ecoil Wire';
  UPDATE inventory_assignments      SET item_name = 'EEV Wire'         WHERE item_name = 'Ecoil Wire';
  UPDATE restock_records            SET item_name = 'EEV Wire'         WHERE item_name = 'Ecoil Wire';
  UPDATE technician_price_overrides SET item_name = 'EEV Wire'         WHERE item_name = 'Ecoil Wire';
  -- Pinned Acc/Fix templates keep tile keys (item names) in a JSON array.
  UPDATE technician_item_templates
     SET tile_keys = (SELECT jsonb_agg(CASE WHEN key = 'Ecoil Wire' THEN 'EEV Wire' ELSE key END ORDER BY ord)
                      FROM jsonb_array_elements_text(tile_keys) WITH ORDINALITY AS t(key, ord))
   WHERE tile_keys ? 'Ecoil Wire';

  DELETE FROM catalog_items WHERE item_name = 'Ecoil Wire';
END $$;
