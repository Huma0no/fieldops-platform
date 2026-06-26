const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/dispatch/restock-report
router.get('/restock-report', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { dateFrom, dateTo } = req.query;
    const conditions = [`v.status IN ('completed', 'temporarily', 'cancelled')`, `vi.tech_supplied = true`];
    const params = [];

    if (dateFrom) {
      params.push(dateFrom);
      conditions.push(`v.completed_at >= $${params.length}`);
    }
    if (dateTo) {
      params.push(dateTo);
      conditions.push(`v.completed_at <= $${params.length}`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const result = await pool.query(
      `SELECT vi.item_name, SUM(vi.quantity)::integer AS total_consumed,
              v.technician_id, t.name AS technician_name,
              SUM(vi.quantity)::integer AS tech_consumed
       FROM visit_items vi
       JOIN visits v ON v.id = vi.visit_id
       JOIN technicians t ON t.id = v.technician_id
       ${where}
       GROUP BY vi.item_name, v.technician_id, t.name
       ORDER BY vi.item_name, v.technician_id`,
      params
    );

    // Aggregate by item_name
    const itemMap = new Map();
    for (const row of result.rows) {
      if (!itemMap.has(row.item_name)) {
        itemMap.set(row.item_name, { itemName: row.item_name, totalConsumed: 0, byTechnician: [] });
      }
      const item = itemMap.get(row.item_name);
      item.totalConsumed += row.tech_consumed;
      item.byTechnician.push({
        technicianId: row.technician_id,
        technicianName: row.technician_name,
        consumed: row.tech_consumed,
      });
    }

    res.json({ items: Array.from(itemMap.values()) });
  } catch (err) {
    next(err);
  }
});

// POST /api/dispatch/restock-report/mark-restocked
router.post('/restock-report/mark-restocked', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { periodStart, periodEnd, itemNames } = req.body;
    const now = new Date().toISOString();

    for (const itemName of itemNames) {
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO restock_records (id, period_start, period_end, item_name, total_consumed, status, restocked_at)
         VALUES ($1, $2, $3, $4, 0, 'restocked', $5)
         ON CONFLICT (item_name, period_start, period_end)
         DO UPDATE SET status = 'restocked', restocked_at = $5`,
        [id, periodStart, periodEnd, itemName, now]
      );
    }

    res.json({ restocked: itemNames.length, items: itemNames });
  } catch (err) {
    next(err);
  }
});

// GET /api/dispatch/pay-periods/:id/anomalies
router.get('/pay-periods/:id/anomalies', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const periodResult = await pool.query(
      'SELECT week_start, week_end FROM pay_periods WHERE id = $1',
      [id]
    );
    if (periodResult.rows.length === 0) return res.status(404).json({ error: 'Pay period not found' });
    const { week_start, week_end } = periodResult.rows[0];

    const result = await pool.query(
      `SELECT vi.visit_id, vi.item_name, vi.price,
              ci.expected_price_min, ci.expected_price_max
       FROM visit_items vi
       JOIN visits v ON v.id = vi.visit_id
       JOIN catalog_items ci ON ci.item_name = vi.item_name
       WHERE v.status IN ('completed', 'temporarily', 'cancelled')
         AND v.completed_at >= $1
         AND v.completed_at <= $2
         AND (ci.expected_price_min IS NOT NULL OR ci.expected_price_max IS NOT NULL)
         AND (
           (ci.expected_price_min IS NOT NULL AND vi.price < ci.expected_price_min)
           OR
           (ci.expected_price_max IS NOT NULL AND vi.price > ci.expected_price_max)
         )`,
      [week_start, week_end]
    );

    res.json(result.rows.map((r) => ({
      visitId: r.visit_id,
      itemName: r.item_name,
      price: r.price,
      expectedMin: r.expected_price_min,
      expectedMax: r.expected_price_max,
    })));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
