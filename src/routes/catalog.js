const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// ── GET — any authenticated user (global authenticate covers this) ─────────────

// Content hash of the catalog data the PWA caches offline. The PWA refetches
// its copy whenever this changes, so catalog edits reach technicians.
router.get('/version', async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT md5(concat_ws('|',
        (SELECT string_agg(row_to_json(c)::text, ',' ORDER BY row_to_json(c)::text) FROM catalog_items c),
        (SELECT string_agg(row_to_json(c)::text, ',' ORDER BY row_to_json(c)::text) FROM catalog_equipment c),
        (SELECT string_agg(row_to_json(c)::text, ',' ORDER BY row_to_json(c)::text) FROM catalog_equipment_charges c),
        (SELECT string_agg(row_to_json(c)::text, ',' ORDER BY row_to_json(c)::text) FROM catalog_manufacturers c),
        (SELECT string_agg(row_to_json(c)::text, ',' ORDER BY row_to_json(c)::text) FROM catalog_item_relations c),
        (SELECT string_agg(row_to_json(c)::text, ',' ORDER BY row_to_json(c)::text) FROM catalog_services c)
      )) AS version`);
    res.json({ version: result.rows[0].version });
  } catch (err) { next(err) }
});

// Each model carries its factory charges per manufacturer + length (W3).
router.get('/equipment', async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT e.*, COALESCE((
        SELECT json_agg(json_build_object('manufacturer', c.manufacturer, 'length_ft', c.length_ft, 'charge_oz', c.charge_oz)
                        ORDER BY c.manufacturer, c.length_ft)
        FROM catalog_equipment_charges c WHERE c.model = e.model
      ), '[]'::json) AS charges
      FROM catalog_equipment e ORDER BY e.brand, e.model`);
    res.json(result.rows);
  } catch (err) { next(err) }
});

router.get('/manufacturers', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM catalog_manufacturers ORDER BY name');
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
          pesp, oem_subcooling_goal, charges = [] } = req.body ?? {};

  if (!model?.trim())     return res.status(400).json({ error: 'model is required' });
  if (!unit_type?.trim()) return res.status(400).json({ error: 'unit_type is required' });
  if (!brand?.trim())     return res.status(400).json({ error: 'brand is required' });
  const chargeError = validateCharges(charges);
  if (chargeError) return res.status(400).json({ error: chargeError });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO catalog_equipment
         (model, unit_type, brand, series, refrigerant, is_a2l, btu, pesp, oem_subcooling_goal)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (model) DO NOTHING
       RETURNING *`,
      [
        model.trim(), unit_type.trim(), brand.trim(),
        series?.trim() || null, refrigerant?.trim() || null,
        is_a2l ?? null, btu ?? null,
        pesp ?? null, oem_subcooling_goal ?? null,
      ]
    );
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Equipment model '${model.trim()}' already exists` });
    }
    const saved = await replaceCharges(client, result.rows[0].model, charges);
    await client.query('COMMIT');
    res.status(201).json({ ...result.rows[0], charges: saved });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23503') return res.status(400).json({ error: 'Unknown manufacturer in charges' });
    next(err);
  } finally {
    client.release();
  }
});

// ── Factory charges per manufacturer + length (W3) ─────────────────────────────

function validateCharges(charges) {
  if (!Array.isArray(charges)) return 'charges must be an array';
  const seen = new Set();
  for (const row of charges) {
    if (!row?.manufacturer?.trim?.()) return 'Each charge needs a manufacturer';
    const length = Number(row.length_ft);
    const charge = Number(row.charge_oz);
    if (row.length_ft == null || row.length_ft === '' || !Number.isFinite(length) || length <= 0) return 'Each charge needs a length in ft above 0';
    if (row.charge_oz == null || row.charge_oz === '' || !Number.isFinite(charge) || charge < 0) return 'Each charge needs a charge in oz';
    const key = `${row.manufacturer.trim()}|${length}`;
    if (seen.has(key)) return `Duplicate charge for ${row.manufacturer.trim()} ${length} ft`;
    seen.add(key);
  }
  return null;
}

async function replaceCharges(client, model, charges) {
  await client.query('DELETE FROM catalog_equipment_charges WHERE model = $1', [model]);
  for (const row of charges) {
    await client.query(
      'INSERT INTO catalog_equipment_charges (model, manufacturer, length_ft, charge_oz) VALUES ($1, $2, $3, $4)',
      [model, row.manufacturer.trim(), Number(row.length_ft), Number(row.charge_oz)]
    );
  }
  const result = await client.query(
    'SELECT manufacturer, length_ft, charge_oz FROM catalog_equipment_charges WHERE model = $1 ORDER BY manufacturer, length_ft',
    [model]
  );
  return result.rows;
}

// PUT replaces a model's whole charge list (the Equipment form's length rows).
router.put('/catalog/equipment/:model/charges', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  const charges = req.body?.charges;
  const chargeError = validateCharges(charges);
  if (chargeError) return res.status(400).json({ error: chargeError });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const exists = await client.query('SELECT 1 FROM catalog_equipment WHERE model = $1', [req.params.model]);
    if (!exists.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Equipment model not found' });
    }
    const saved = await replaceCharges(client, req.params.model, charges);
    await client.query('COMMIT');
    res.json({ model: req.params.model, charges: saved });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23503') return res.status(400).json({ error: 'Unknown manufacturer in charges' });
    next(err);
  } finally {
    client.release();
  }
});

// ── POST /catalog/manufacturers — dispatcher only ──────────────────────────────

router.post('/catalog/manufacturers', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  const { name, oz_per_ft, default_length_ft } = req.body ?? {};
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  if (!(Number(oz_per_ft) > 0)) return res.status(400).json({ error: 'oz_per_ft must be above 0' });
  if (!(Number(default_length_ft) > 0)) return res.status(400).json({ error: 'default_length_ft must be above 0' });
  try {
    const result = await pool.query(
      `INSERT INTO catalog_manufacturers (name, oz_per_ft, default_length_ft) VALUES ($1, $2, $3)
       ON CONFLICT (name) DO NOTHING RETURNING *`,
      [name.trim(), Number(oz_per_ft), Number(default_length_ft)]
    );
    if (result.rowCount === 0) return res.status(409).json({ error: `Manufacturer '${name.trim()}' already exists` });
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
      'pesp', 'oem_subcooling_goal',
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
  catalog_manufacturers: {
    pk: 'name',
    editable: new Set(['name', 'oz_per_ft', 'default_length_ft']),
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
    // Unique violation (e.g., renaming a manufacturer to an existing name)
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A row with that name already exists' });
    }
    // NOT NULL violation (e.g., required field set to null)
    if (err.code === '23502') {
      return res.status(400).json({ error: `Field '${err.column}' cannot be null` });
    }
    next(err);
  }
});

module.exports = router;
