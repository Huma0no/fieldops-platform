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

// ── PATCH /catalog/:table/:id — dispatcher only ────────────────────────────────

const CATALOG_CONFIG = {
  catalog_equipment: {
    pk: 'model',
    editable: new Set(['pesp', 'factory_charge_oz', 'revised_charge_oz', 'oem_subcooling_goal', 'is_a2l']),
  },
  catalog_items: {
    pk: 'item_name',
    editable: new Set(['default_price', 'expected_price_min', 'expected_price_max', 'finish_addon_price', 'multiplies_by_system_count', 'custom_price']),
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
  } catch (err) { next(err) }
});

module.exports = router;
