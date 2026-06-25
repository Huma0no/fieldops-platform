const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const { calculateVisitPrice } = require('../services/pricing');

const router = express.Router();

const VALID_SERVICES = ['AC', 'Heat', 'AC & Heat', 'Prestart System', 'Drive Run', 'Cancel'];

async function requireVisitOwnership(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT id, status, technician_id, address_id FROM visits WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Visit not found' });
    const visit = result.rows[0];
    if (visit.technician_id !== req.technician.id) {
      return res.status(403).json({ error: 'This visit is not assigned to you' });
    }
    if (!['assigned', 'in_progress'].includes(visit.status)) {
      return res.status(400).json({
        error: `Visit cannot be modified — current status: ${visit.status}`,
      });
    }
    req.visit = visit;
    next();
  } catch (err) {
    next(err);
  }
}

// PATCH /api/visits/:id/services
router.patch(
  '/:id/services',
  requireRole('technician'),
  requireVisitOwnership,
  async (req, res, next) => {
    const { id } = req.params;
    const { serviceName, isFinish = false, isTemporarily = false, confirmed = false } = req.body;
    try {
      if (!VALID_SERVICES.includes(serviceName)) {
        return res.status(400).json({ error: 'Invalid service name' });
      }

      if (serviceName === 'Cancel') {
        const items = await pool.query(
          `SELECT id, item_name FROM visit_items WHERE visit_id = $1`,
          [id]
        );
        if (items.rows.length > 0 && !confirmed) {
          return res.json({
            requiresConfirmation: true,
            itemsToRemove: items.rows.map(r => ({ id: r.id, itemName: r.item_name })),
          });
        }
        const now = new Date().toISOString();
        await pool.query(`DELETE FROM visit_items WHERE visit_id = $1`, [id]);
        await pool.query(`DELETE FROM visit_services WHERE visit_id = $1`, [id]);
        await pool.query(
          `UPDATE visits SET total_price = 0, updated_at = $1 WHERE id = $2`,
          [now, id]
        );
        return res.json({ id, serviceName: 'Cancel', isFinish: false, isTemporarily: false, totalPrice: 0 });
      }

      const catalogRes = await pool.query(
        `SELECT default_price FROM catalog_services WHERE service_name = $1`,
        [serviceName]
      );
      const catalogPrice = catalogRes.rows[0]?.default_price ?? 0;

      await pool.query(`DELETE FROM visit_services WHERE visit_id = $1`, [id]);
      await pool.query(
        `INSERT INTO visit_services (id, visit_id, service_name, is_finish, is_temporarily, price)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5)`,
        [id, serviceName, isFinish, isTemporarily, catalogPrice]
      );

      const totalPrice = await calculateVisitPrice(pool, id);
      const now = new Date().toISOString();
      await pool.query(
        `UPDATE visits SET total_price = $1, updated_at = $2 WHERE id = $3`,
        [totalPrice, now, id]
      );

      res.json({ id, serviceName, isFinish, isTemporarily, totalPrice });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
