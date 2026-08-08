const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const { createNotification } = require('../helpers/notify');

const router = express.Router();

async function notifyDispatchers(db, type, message) {
  const result = await db.query(
    `SELECT id FROM technicians WHERE role IN ('dispatcher', 'owner') AND is_active = true`
  );
  for (const row of result.rows) {
    await createNotification(db, { recipientId: row.id, type, message });
  }
}

function correctionShape(r) {
  return {
    id: r.id,
    visitId: r.visit_id,
    address: { street: r.street },
    requestedBy: { id: r.tech_id, name: r.tech_name },
    message: r.message,
    status: r.status,
    requestedAt: r.requested_at,
    appliedAt: r.applied_at,
  };
}

// POST /api/visits/:id/request-correction  (mount at /api)
router.post('/visits/:id/request-correction', requireRole('technician'), async (req, res, next) => {
  try {
    const { id: visitId } = req.params;
    const { message } = req.body;
    const techId = req.technician.id;

    const vResult = await pool.query(
      `SELECT v.id, v.technician_id, v.status, v.completed_at, a.street
       FROM visits v JOIN addresses a ON a.id = v.address_id
       WHERE v.id = $1`,
      [visitId]
    );
    if (vResult.rows.length === 0) return res.status(404).json({ error: 'Visit not found' });
    const visit = vResult.rows[0];

    if (visit.technician_id !== techId) {
      return res.status(403).json({ error: 'This visit is not assigned to you' });
    }

    if (!['completed', 'temporarily', 'cancelled'].includes(visit.status)) {
      return res.status(400).json({ error: 'Corrections can only be requested for submitted visits' });
    }

    const existing = await pool.query(
      `SELECT id FROM corrections WHERE visit_id = $1 AND status = 'open'`,
      [visitId]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'An open correction request already exists for this visit' });
    }

    if (visit.completed_at) {
      const ppResult = await pool.query(
        `SELECT status FROM pay_periods WHERE week_start <= $1 AND week_end >= $1`,
        [visit.completed_at]
      );
      if (ppResult.rows.length > 0 && ppResult.rows[0].status !== 'open') {
        return res.status(409).json({ error: "This visit's Ledger week has already closed" });
      }
    }

    const corrId = crypto.randomUUID();
    const now = new Date().toISOString();
    await pool.query(
      `INSERT INTO corrections (id, visit_id, requested_by, message, status, requested_at)
       VALUES ($1, $2, $3, $4, 'open', $5)`,
      [corrId, visitId, techId, message, now]
    );

    const notifyMsg = `${req.technician.name} requested a correction for ${visit.street}`;
    await notifyDispatchers(pool, 'correction_requested', notifyMsg);

    res.json({ correctionId: corrId, status: 'open' });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/dispatch/corrections/:id/apply  (mount at /api)
router.patch('/dispatch/corrections/:id/apply', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { id: corrId } = req.params;

    const cResult = await pool.query(
      `SELECT c.*, a.street
       FROM corrections c
       JOIN visits v ON v.id = c.visit_id
       JOIN addresses a ON a.id = v.address_id
       WHERE c.id = $1`,
      [corrId]
    );
    if (cResult.rows.length === 0) return res.status(404).json({ error: 'Correction not found' });
    const corr = cResult.rows[0];

    if (corr.status !== 'open') {
      return res.status(400).json({ error: 'Correction is not open' });
    }

    const now = new Date().toISOString();
    await pool.query(
      `UPDATE corrections SET status = 'applied', applied_at = $1 WHERE id = $2`,
      [now, corrId]
    );

    await createNotification(pool, {
      recipientId: corr.requested_by,
      type: 'correction_applied',
      message: `Your correction request for ${corr.street} was applied`,
    });

    res.json({
      id: corr.id,
      visitId: corr.visit_id,
      status: 'applied',
      appliedAt: now,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/dispatch/corrections/:id  (mount at /api)
router.get('/dispatch/corrections/:id', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT c.id, c.visit_id, c.message, c.status, c.requested_at, c.applied_at,
              a.street,
              t.id AS tech_id, t.name AS tech_name
       FROM corrections c
       JOIN visits v ON v.id = c.visit_id
       JOIN addresses a ON a.id = v.address_id
       JOIN technicians t ON t.id = c.requested_by
       WHERE c.id = $1`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Correction not found' });
    const r = result.rows[0];

    const visitResult = await pool.query(
      `SELECT order_number, notes, total_price, status, scheduled_time FROM visits WHERE id = $1`,
      [r.visit_id]
    );
    const v = visitResult.rows[0];

    res.json({
      ...correctionShape(r),
      visitSnapshot: v ? {
        orderNumber: v.order_number,
        notes: v.notes,
        totalPrice: v.total_price,
        status: v.status,
        scheduledTime: v.scheduled_time,
      } : null,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/dispatch/corrections  (mount at /api)
router.get('/dispatch/corrections', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { status } = req.query;

    const params = [];
    let where = '';
    if (status) {
      params.push(status);
      where = `WHERE c.status = $1`;
    }

    const result = await pool.query(
      `SELECT c.id, c.visit_id, c.message, c.status, c.requested_at, c.applied_at,
              a.street,
              t.id AS tech_id, t.name AS tech_name
       FROM corrections c
       JOIN visits v ON v.id = c.visit_id
       JOIN addresses a ON a.id = v.address_id
       JOIN technicians t ON t.id = c.requested_by
       ${where}
       ORDER BY
         CASE WHEN c.status = 'open' THEN 0 ELSE 1 END,
         c.requested_at DESC`,
      params
    );

    res.json(result.rows.map(correctionShape));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
