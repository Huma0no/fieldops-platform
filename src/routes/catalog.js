const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// ── GET — any authenticated user (global authenticate covers this) ─────────────

router.get('/equipment', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM catalog_equipment ORDER BY brand, model');
    res.json(result.rows);
  } catch (err) { next(err) }
});

router.get('/lineset-configs', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM catalog_lineset_configs ORDER BY config_key');
    res.json(result.rows);
  } catch (err) { next(err) }
});

router.get('/items', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM catalog_items ORDER BY category, item_name');
    res.json(result.rows);
  } catch (err) { next(err) }
});

router.get('/item-relations', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM catalog_item_relations');
    res.json(result.rows);
  } catch (err) { next(err) }
});

router.get('/services', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM catalog_services ORDER BY service_name');
    res.json(result.rows);
  } catch (err) { next(err) }
});

// ── POST /catalog/equipment — dispatcher only ──────────────────────────────────

router.post('/catalog/equipment', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  const { model, unit_type, brand, series, refrigerant, is_a2l, btu,
          factory_charge_oz, revised_charge_oz, pesp, oem_subcooling_goal } = req.body ?? {};

  if (!model?.trim())     return res.status(400).json({ error: 'model is required' });
  if (!unit_type?.trim()) return res.status(400).json({ error: 'unit_type is required' });
  if (!brand?.trim())     return res.status(400).json({ error: 'brand is required' });

  try {
    const result = await pool.query(
      `INSERT INTO catalog_equipment
         (model, unit_type, brand, series, refrigerant, is_a2l, btu,
          factory_charge_oz, revised_charge_oz, pesp, oem_subcooling_goal)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (model) DO NOTHING
       RETURNING *`,
      [
        model.trim(), unit_type.trim(), brand.trim(),
        series?.trim() || null, refrigerant?.trim() || null,
        is_a2l ?? null, btu ?? null,
        factory_charge_oz ?? null, revised_charge_oz ?? null,
        pesp ?? null, oem_subcooling_goal ?? null,
      ]
    );
    if (result.rowCount === 0) {
      return res.status(409).json({ error: `Equipment model '${model.trim()}' already exists` });
    }
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err) }
});

// ── POST /catalog/items — dispatcher only ─────────────────────────────────────

const VALID_CATEGORIES = new Set(['accessory', 'fix', 'thermostat']);

router.post('/catalog/items', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  const { item_name, category, tech_supplied, default_price, multiplies_by_system_count,
          custom_price, expected_price_min, expected_price_max, finish_addon_price } = req.body ?? {};

  if (!item_name?.trim()) return res.status(400).json({ error: 'item_name is required' });
  if (!category)          return res.status(400).json({ error: 'category is required' });
  if (!VALID_CATEGORIES.has(category)) {
    return res.status(400).json({ error: `category must be one of: ${[...VALID_CATEGORIES].join(', ')}` });
  }
  if (tech_supplied === undefined || tech_supplied === null) {
    return res.status(400).json({ error: 'tech_supplied is required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO catalog_items
         (item_name, category, tech_supplied, default_price,
          multiplies_by_system_count, custom_price,
          expected_price_min, expected_price_max, finish_addon_price)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (item_name) DO NOTHING
       RETURNING *`,
      [
        item_name.trim(), category, Boolean(tech_supplied),
        default_price ?? null,
        Boolean(multiplies_by_system_count ?? false),
        Boolean(custom_price ?? false),
        expected_price_min ?? null, expected_price_max ?? null, finish_addon_price ?? null,
      ]
    );
    if (result.rowCount === 0) {
      return res.status(409).json({ error: `Item '${item_name.trim()}' already exists` });
    }
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err) }
});

// ── PATCH /catalog/:table/:id — dispatcher only ────────────────────────────────

const CATALOG_CONFIG = {
  catalog_equipment: {
    pk: 'model',
    editable: new Set([
      'unit_type', 'brand', 'series', 'refrigerant', 'is_a2l', 'btu',
      'factory_charge_oz', 'revised_charge_oz', 'pesp', 'oem_subcooling_goal',
    ]),
  },
  catalog_items: {
    pk: 'item_name',
    editable: new Set([
      'category', 'default_price', 'tech_supplied',
      'multiplies_by_system_count', 'custom_price',
      'expected_price_min', 'expected_price_max', 'finish_addon_price',
    ]),
  },
  catalog_services: {
    pk: 'service_name',
    editable: new Set(['default_price', 'multiplies_by_system_count']),
  },
  catalog_lineset_configs: {
    pk: 'config_key',
    editable: new Set(['reference_length_ft', 'adjust_rate_oz_per_ft']),
  },
};

router.patch('/catalog/:table/:id', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  const { table, id } = req.params;
  const config = CATALOG_CONFIG[table];
  if (!config) {
    return res.status(400).json({ error: `Unknown catalog table: ${table}` });
  }

  const updates = req.body ?? {};
  const columns = Object.keys(updates);
  if (columns.length === 0) {
    return res.status(400).json({ error: 'Body must contain at least one field to update' });
  }

  const invalid = columns.filter(c => !config.editable.has(c));
  if (invalid.length > 0) {
    return res.status(400).json({ error: `Unknown or non-editable column(s): ${invalid.join(', ')}` });
  }

  // Validate catalog_items category value before hitting the DB CHECK constraint
  if (table === 'catalog_items' && 'category' in updates) {
    if (!VALID_CATEGORIES.has(updates.category)) {
      return res.status(400).json({ error: `category must be one of: ${[...VALID_CATEGORIES].join(', ')}` });
    }
  }

  try {
    const setClauses = columns.map((col, i) => `${col} = $${i + 1}`).join(', ');
    const values = [...columns.map(c => updates[c]), id];

    const result = await pool.query(
      `UPDATE ${table} SET ${setClauses} WHERE ${config.pk} = $${values.length} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Row not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    // CHECK constraint violation (e.g., category/tech_supplied cross-constraint)
    if (err.code === '23514') {
      return res.status(400).json({ error: `Update violates a catalog constraint: ${err.constraint}` });
    }
    // NOT NULL violation (e.g., required field set to null)
    if (err.code === '23502') {
      return res.status(400).json({ error: `Field '${err.column}' cannot be null` });
    }
    next(err);
  }
});

module.exports = router;
