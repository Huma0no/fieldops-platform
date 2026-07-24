const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/dispatch/reports/equipment
router.get('/reports/equipment', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  const { dateFrom, dateTo, technicianId } = req.query;
  if (!dateFrom || !dateTo) {
    return res.status(400).json({ error: 'dateFrom and dateTo are required' });
  }
  try {
    const params = [dateFrom, dateTo];
    const techClause = technicianId ? `AND v.technician_id = $${params.push(technicianId)}` : '';
    const { rows } = await pool.query(`
      SELECT
        vi.item_name,
        vi.category,
        vi.quantity,
        a.id     AS address_id,
        a.street AS address,
        v.technician_id,
        t.name   AS technician_name
      FROM visit_items  vi
      JOIN visits       v  ON v.id  = vi.visit_id
      JOIN addresses    a  ON a.id  = v.address_id
      JOIN technicians  t  ON t.id  = v.technician_id
      WHERE v.status IN ('completed', 'temporarily')
        AND v.completed_at::date >= $1::date
        AND v.completed_at::date <= $2::date
        ${techClause}
      ORDER BY vi.item_name, a.street
    `, params);

    const itemMap = {};
    for (const r of rows) {
      const key = `${r.item_name}::${r.category}`;
      if (!itemMap[key]) {
        itemMap[key] = { itemName: r.item_name, category: r.category, totalQty: 0, byTechnician: {}, byAddress: {} };
      }
      const item = itemMap[key];
      item.totalQty += r.quantity;
      if (!item.byTechnician[r.technician_id]) {
        item.byTechnician[r.technician_id] = { technicianId: r.technician_id, technicianName: r.technician_name, qty: 0 };
      }
      item.byTechnician[r.technician_id].qty += r.quantity;
      if (!item.byAddress[r.address_id]) {
        item.byAddress[r.address_id] = { addressId: r.address_id, address: r.address, qty: 0 };
      }
      item.byAddress[r.address_id].qty += r.quantity;
    }

    res.json(Object.values(itemMap).map(item => ({
      itemName:     item.itemName,
      category:     item.category,
      totalQty:     item.totalQty,
      byTechnician: Object.values(item.byTechnician),
      byAddress:    Object.values(item.byAddress),
    })));
  } catch (err) {
    next(err);
  }
});

// GET /api/dispatch/reports/refrigerant
router.get('/reports/refrigerant', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  const { dateFrom, dateTo, technicianId } = req.query;
  if (!dateFrom || !dateTo) {
    return res.status(400).json({ error: 'dateFrom and dateTo are required' });
  }
  try {
    const params = [dateFrom, dateTo];
    const techClause = technicianId ? `AND v.technician_id = $${params.push(technicianId)}` : '';
    const { rows } = await pool.query(`
      SELECT DISTINCT ON (w.address_id, w.system_number)
        a.id     AS address_id,
        a.street AS address,
        w.system_number,
        w.adjusted_oz,
        w.factory_charge_oz   AS factory_charge_used,
        w.factory_line_config,
        v.completed_at,
        v.technician_id,
        (SELECT service_name FROM visit_services WHERE visit_id = v.id LIMIT 1) AS service_name
      FROM weigh_in_data w
      JOIN addresses a ON a.id = w.address_id
      JOIN visits    v ON v.address_id = a.id
      WHERE v.status IN ('completed', 'temporarily')
        AND v.completed_at::date >= $1::date
        AND v.completed_at::date <= $2::date
        ${techClause}
      ORDER BY w.address_id, w.system_number, v.completed_at DESC
    `, params);

    res.json(rows.map(r => ({
      addressId:         r.address_id,
      address:           r.address,
      systemNumber:      r.system_number,
      serviceName:       r.service_name,
      adjustedOz:        r.adjusted_oz,
      factoryChargeUsed: r.factory_charge_used,
      factoryLineConfig: r.factory_line_config,
      completedAt:       r.completed_at,
      technicianId:      r.technician_id,
    })));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
