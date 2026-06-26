const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

function getCurrentPeriodStart() {
  const today = new Date();
  const day = today.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diff);
  return monday.toISOString().slice(0, 10);
}

async function getInventoryForTechnician(technicianId, periodStart) {
  const assignments = await pool.query(
    `SELECT item_name, quantity_assigned FROM inventory_assignments
     WHERE technician_id = $1 AND period_start = $2`,
    [technicianId, periodStart]
  );

  if (assignments.rows.length === 0) return [];

  const consumedResult = await pool.query(
    `SELECT vi.item_name, SUM(vi.quantity)::integer AS consumed
     FROM visit_items vi
     JOIN visits v ON v.id = vi.visit_id
     WHERE vi.tech_supplied = true
       AND v.technician_id = $1
       AND v.completed_at >= $2
       AND v.status IN ('completed', 'temporarily', 'cancelled')
     GROUP BY vi.item_name`,
    [technicianId, periodStart]
  );

  const consumedMap = {};
  for (const row of consumedResult.rows) {
    consumedMap[row.item_name] = row.consumed;
  }

  return assignments.rows.map((a) => {
    const consumed = consumedMap[a.item_name] || 0;
    return {
      itemName: a.item_name,
      quantityAssigned: a.quantity_assigned,
      quantityConsumed: consumed,
      balance: a.quantity_assigned - consumed,
    };
  });
}

// GET /api/inventory/mine
router.get('/inventory/mine', requireRole('technician'), async (req, res, next) => {
  try {
    const periodStart = getCurrentPeriodStart();
    const items = await getInventoryForTechnician(req.technician.id, periodStart);
    res.json(items);
  } catch (err) {
    next(err);
  }
});

// GET /api/dispatch/inventory
router.get('/dispatch/inventory', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const periodStart = getCurrentPeriodStart();

    const techResult = await pool.query(
      `SELECT DISTINCT ia.technician_id, t.name
       FROM inventory_assignments ia
       JOIN technicians t ON t.id = ia.technician_id
       WHERE ia.period_start = $1`,
      [periodStart]
    );

    const result = [];
    for (const tech of techResult.rows) {
      const items = await getInventoryForTechnician(tech.technician_id, periodStart);
      result.push({
        technicianId: tech.technician_id,
        technicianName: tech.name,
        items,
      });
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/dispatch/inventory/assign
router.post('/dispatch/inventory/assign', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { technicianId, itemName, quantityAssigned, periodStart } = req.body;

    const techResult = await pool.query(
      'SELECT id FROM technicians WHERE id = $1',
      [technicianId]
    );
    if (techResult.rows.length === 0) {
      return res.status(400).json({ error: 'Technician not found' });
    }

    const itemResult = await pool.query(
      'SELECT item_name FROM catalog_items WHERE item_name = $1',
      [itemName]
    );
    if (itemResult.rows.length === 0) {
      return res.status(400).json({ error: 'Catalog item not found' });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await pool.query(
      `INSERT INTO inventory_assignments (id, technician_id, item_name, quantity_assigned, period_start, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, technicianId, itemName, quantityAssigned, periodStart, now]
    );

    res.json({ id, technicianId, itemName, quantityAssigned, periodStart });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
