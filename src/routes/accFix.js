// W2 Acc + Fix templates: the technician's item usage from their last 30
// completed Reports, and the template they pinned per category (★).
// The Workspace caches both for offline use and builds the template itself.
const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
const CATEGORIES = new Set(['accessory', 'fix']);
const HISTORY_SIZE = 30;

// GET /api/workspace/acc-fix
// → { usage: { [item_name]: reports using it }, templates: { accessory, fix } }
router.get('/acc-fix', requireRole('technician'), async (req, res, next) => {
  try {
    const [usage, templates] = await Promise.all([
      pool.query(
        `WITH recent AS (
           SELECT id FROM visits
           WHERE technician_id = $1 AND status IN ('completed', 'temporarily') AND completed_at IS NOT NULL
           ORDER BY completed_at DESC LIMIT $2
         )
         SELECT vi.item_name, count(DISTINCT vi.visit_id)::int AS reports
         FROM visit_items vi JOIN recent r ON r.id = vi.visit_id
         WHERE vi.category IN ('accessory', 'fix')
         GROUP BY vi.item_name`,
        [req.technician.id, HISTORY_SIZE]
      ),
      pool.query('SELECT category, tile_keys FROM technician_item_templates WHERE technician_id = $1', [req.technician.id]),
    ]);
    res.json({
      usage: Object.fromEntries(usage.rows.map(row => [row.item_name, row.reports])),
      templates: {
        accessory: templates.rows.find(row => row.category === 'accessory')?.tile_keys ?? null,
        fix: templates.rows.find(row => row.category === 'fix')?.tile_keys ?? null,
      },
    });
  } catch (err) { next(err); }
});

// PUT /api/workspace/acc-fix/templates/:category  { keys: string[] | null }
// null resets to the suggested template.
router.put('/acc-fix/templates/:category', requireRole('technician'), async (req, res, next) => {
  const { category } = req.params;
  const keys = req.body?.keys;
  if (!CATEGORIES.has(category)) return res.status(400).json({ error: 'category must be accessory or fix' });
  if (keys !== null && (!Array.isArray(keys) || keys.length > 50
      || keys.some(key => typeof key !== 'string' || !key.trim() || key.length > 100))) {
    return res.status(400).json({ error: 'keys must be a list of tile names, or null' });
  }
  try {
    if (keys === null) {
      await pool.query('DELETE FROM technician_item_templates WHERE technician_id = $1 AND category = $2', [req.technician.id, category]);
    } else {
      await pool.query(
        `INSERT INTO technician_item_templates (technician_id, category, tile_keys, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (technician_id, category) DO UPDATE SET tile_keys = EXCLUDED.tile_keys, updated_at = EXCLUDED.updated_at`,
        [req.technician.id, category, JSON.stringify([...new Set(keys)]), new Date().toISOString()]
      );
    }
    res.json({ category, keys: keys === null ? null : [...new Set(keys)] });
  } catch (err) { next(err); }
});

module.exports = router;
