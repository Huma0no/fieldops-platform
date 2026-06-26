const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const { createNotification } = require('../helpers/notify');
const { generateReportText, generateReportJSON } = require('../services/report');

const router = express.Router();

const TERMINAL_STATUSES = ['completed', 'temporarily', 'cancelled'];

// POST /api/visits/:id/complete
router.post('/:id/complete', requireRole('technician'), async (req, res, next) => {
  const { id } = req.params;
  try {
    const visitResult = await pool.query(
      `SELECT v.id, v.status, v.technician_id, a.street
       FROM visits v
       JOIN addresses a ON a.id = v.address_id
       WHERE v.id = $1`,
      [id]
    );
    if (visitResult.rows.length === 0) return res.status(404).json({ error: 'Visit not found' });
    const visit = visitResult.rows[0];

    if (TERMINAL_STATUSES.includes(visit.status)) {
      return res.json(await generateReportJSON(pool, id));
    }

    if (visit.technician_id !== req.technician.id) {
      return res.status(403).json({ error: 'This visit is not assigned to you' });
    }

    if (!['assigned', 'in_progress'].includes(visit.status)) {
      return res.status(400).json({ error: `Visit cannot be completed — current status: ${visit.status}` });
    }

    const serviceResult = await pool.query(
      'SELECT service_name, is_temporarily FROM visit_services WHERE visit_id = $1',
      [id]
    );
    if (serviceResult.rows.length === 0) {
      return res.status(400).json({ error: 'No service selected' });
    }
    const svc = serviceResult.rows[0];

    let finalStatus;
    if (svc.service_name === 'Cancel') {
      finalStatus = 'cancelled';
    } else if (svc.is_temporarily) {
      finalStatus = 'temporarily';
    } else {
      finalStatus = 'completed';
    }

    const now = new Date().toISOString();
    const client = await pool.connect();
    let expiredRows = [];
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE visits SET status = $1, completed_at = $2, updated_at = $2 WHERE id = $3`,
        [finalStatus, now, id]
      );
      const expiredResult = await client.query(
        `UPDATE transfers SET status = 'expired', resolved_at = $1
         WHERE visit_id = $2 AND status = 'pending'
         RETURNING to_tech_id`,
        [now, id]
      );
      expiredRows = expiredResult.rows;
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    // Notifications remain outside transaction (soft failures OK)
    for (const row of expiredRows) {
      await createNotification(pool, {
        recipientId: row.to_tech_id,
        type: 'transfer_expired',
        message: `A transfer request for ${visit.street} has expired — the visit was completed by the original technician`,
      });
    }

    const dispatchersResult = await pool.query(
      `SELECT id FROM technicians WHERE role IN ('dispatcher', 'owner') AND is_active = true`
    );
    for (const d of dispatchersResult.rows) {
      await createNotification(pool, {
        recipientId: d.id,
        type: 'completion_received',
        message: `${req.technician.name} completed ${visit.street}`,
      });
    }

    console.log('Drive upload pending for visit', id);

    res.json(await generateReportJSON(pool, id));
  } catch (err) {
    next(err);
  }
});

// GET /api/visits/:id/report-preview
router.get('/:id/report-preview', async (req, res, next) => {
  const { id } = req.params;
  try {
    const visitResult = await pool.query(
      'SELECT id, technician_id FROM visits WHERE id = $1',
      [id]
    );
    if (visitResult.rows.length === 0) return res.status(404).json({ error: 'Visit not found' });
    const visit = visitResult.rows[0];

    if (req.technician.role === 'technician' && visit.technician_id !== req.technician.id) {
      return res.status(403).json({ error: 'This visit is not assigned to you' });
    }

    const reportText = await generateReportText(pool, id);
    res.json({ reportText });
  } catch (err) {
    next(err);
  }
});

// GET /api/visits/:id/download
router.get('/:id/download', async (req, res, next) => {
  const { id } = req.params;
  try {
    const visitResult = await pool.query(
      'SELECT id, technician_id FROM visits WHERE id = $1',
      [id]
    );
    if (visitResult.rows.length === 0) return res.status(404).json({ error: 'Visit not found' });
    const visit = visitResult.rows[0];

    if (req.technician.role === 'technician' && visit.technician_id !== req.technician.id) {
      return res.status(403).json({ error: 'This visit is not assigned to you' });
    }

    res.json(await generateReportJSON(pool, id));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
