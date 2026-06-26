const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const { createNotification } = require('../helpers/notify');

const router = express.Router();

// Maps accepted camelCase or snake_case keys → DB column name
const SAFE_FIELD_MAP = {
  notes: 'notes',
  order_number: 'order_number',
  orderNumber: 'order_number',
  scheduled_time: 'scheduled_time',
  scheduledTime: 'scheduled_time',
  total_price: 'total_price',
  totalPrice: 'total_price',
};

async function notifyDispatchers(db, type, message) {
  const result = await db.query(
    `SELECT id FROM technicians WHERE role IN ('dispatcher', 'owner') AND is_active = true`
  );
  for (const row of result.rows) {
    await createNotification(db, { recipientId: row.id, type, message });
  }
}

// POST /api/visits/:id/request-correction  (mount at /api)
router.post('/visits/:id/request-correction', requireRole('technician'), async (req, res, next) => {
  try {
    const { id: visitId } = req.params;
    const { correctedFields, reason } = req.body;
    const techId = req.technician.id;

    const vResult = await pool.query(
      `SELECT v.id, v.technician_id, v.status, a.street
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
      `SELECT id FROM corrections WHERE visit_id = $1 AND status = 'pending'`,
      [visitId]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'A correction request is already pending for this visit' });
    }

    const corrId = crypto.randomUUID();
    const now = new Date().toISOString();
    await pool.query(
      `INSERT INTO corrections
         (id, visit_id, requested_by, corrected_fields, reason, status, requested_at, resolved_at, dispatcher_note)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, null, null)`,
      [corrId, visitId, techId, JSON.stringify(correctedFields), reason ?? null, now]
    );

    const message = `${req.technician.name} requested a correction for ${visit.street}`;
    await notifyDispatchers(pool, 'correction_requested', message);

    res.json({ correctionId: corrId, status: 'pending' });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/dispatch/corrections/:id/approve  (mount at /api)
router.patch('/dispatch/corrections/:id/approve', requireRole('owner', 'dispatcher'), async (req, res, next) => {
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

    if (corr.status !== 'pending') {
      return res.status(400).json({ error: 'Correction is not pending' });
    }

    const correctedFields = JSON.parse(corr.corrected_fields);
    const safeEntries = Object.entries(correctedFields)
      .filter(([k]) => SAFE_FIELD_MAP[k] !== undefined)
      .map(([k, v]) => [SAFE_FIELD_MAP[k], v]);

    const now = new Date().toISOString();

    if (safeEntries.length > 0) {
      const setClauses = safeEntries.map(([col], i) => `${col} = $${i + 2}`);
      setClauses.push(`updated_at = $${safeEntries.length + 2}`);
      const values = [corr.visit_id, ...safeEntries.map(([, v]) => v), now];
      await pool.query(
        `UPDATE visits SET ${setClauses.join(', ')} WHERE id = $1`,
        values
      );
    } else {
      await pool.query(`UPDATE visits SET updated_at = $1 WHERE id = $2`, [now, corr.visit_id]);
    }

    await pool.query(
      `INSERT INTO edit_log (id, visit_id, changed_at, summary, source)
       VALUES ($1, $2, $3, $4, 'correction_approved')`,
      [crypto.randomUUID(), corr.visit_id, now, corr.reason ?? 'Correction approved']
    );

    await pool.query(
      `UPDATE corrections SET status = 'approved', resolved_at = $1 WHERE id = $2`,
      [now, corrId]
    );

    // Pay period cutoff check
    const visitResult = await pool.query(
      'SELECT completed_at FROM visits WHERE id = $1',
      [corr.visit_id]
    );
    const completedAt = visitResult.rows[0]?.completed_at;
    let affectsClosedPeriod = false;

    if (completedAt) {
      const ppResult = await pool.query(
        `SELECT status FROM pay_periods
         WHERE week_start <= $1 AND week_end >= $1`,
        [completedAt]
      );
      if (ppResult.rows.length > 0 && ['closed', 'paid'].includes(ppResult.rows[0].status)) {
        affectsClosedPeriod = true;
        const adjMsg = `Correction for ${corr.street} affects a closed pay period — manual adjustment may be needed`;
        await notifyDispatchers(pool, 'correction_needs_period_adjustment', adjMsg);
      }
    }

    await createNotification(pool, {
      recipientId: corr.requested_by,
      type: 'correction_approved',
      message: `Your correction request for ${corr.street} was approved`,
    });

    const updatedVisit = await pool.query('SELECT * FROM visits WHERE id = $1', [corr.visit_id]);
    res.json({ ...updatedVisit.rows[0], affectsClosedPeriod });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/dispatch/corrections/:id/reject  (mount at /api)
router.patch('/dispatch/corrections/:id/reject', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { id: corrId } = req.params;
    const { dispatcherNote } = req.body ?? {};

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

    if (corr.status !== 'pending') {
      return res.status(400).json({ error: 'Correction is not pending' });
    }

    const now = new Date().toISOString();
    await pool.query(
      `UPDATE corrections SET status = 'rejected', resolved_at = $1, dispatcher_note = $2 WHERE id = $3`,
      [now, dispatcherNote ?? null, corrId]
    );

    const message = `Your correction request for ${corr.street} was rejected${dispatcherNote ? ': ' + dispatcherNote : ''}`;
    await createNotification(pool, {
      recipientId: corr.requested_by,
      type: 'correction_rejected',
      message,
    });

    res.json({ correctionId: corrId, status: 'rejected', dispatcherNote: dispatcherNote ?? null });
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
      `SELECT c.id, c.visit_id, c.corrected_fields, c.reason, c.status,
              c.requested_at, c.resolved_at, c.dispatcher_note,
              a.street,
              t.id AS tech_id, t.name AS tech_name
       FROM corrections c
       JOIN visits v ON v.id = c.visit_id
       JOIN addresses a ON a.id = v.address_id
       JOIN technicians t ON t.id = c.requested_by
       ${where}
       ORDER BY CASE WHEN c.status = 'pending' THEN 0 ELSE 1 END, c.requested_at DESC`,
      params
    );

    res.json(result.rows.map((r) => ({
      id: r.id,
      visitId: r.visit_id,
      address: { street: r.street },
      requestedBy: { id: r.tech_id, name: r.tech_name },
      correctedFields: JSON.parse(r.corrected_fields),
      reason: r.reason,
      status: r.status,
      requestedAt: r.requested_at,
      resolvedAt: r.resolved_at,
      dispatcherNote: r.dispatcher_note,
    })));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
