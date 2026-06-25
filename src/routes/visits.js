const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const { createNotification } = require('../helpers/notify');

const visitsRouter = express.Router();
const dispatchVisitsRouter = express.Router();

function buildTags(hasMultipleSystems, hasA2l) {
  const tags = ['builder'];
  if (hasMultipleSystems) tags.push('multiSystem');
  if (hasA2l) tags.push('a2l');
  return tags;
}

// GET /api/visits/lobby
visitsRouter.get('/lobby', async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT
        v.id,
        v.order_number,
        v.scheduled_time,
        v.has_multiple_systems,
        v.is_deferred,
        a.street,
        a.city,
        a.subdivision,
        a.builder,
        BOOL_OR(ce.is_a2l) AS has_a2l
      FROM visits v
      JOIN addresses a ON a.id = v.address_id
      LEFT JOIN visit_systems vs ON vs.visit_id = v.id
      LEFT JOIN catalog_equipment ce ON ce.model IN (vs.indoor_model, vs.outdoor_model)
      WHERE v.status = 'in_lobby'
      GROUP BY v.id, v.order_number, v.scheduled_time, v.has_multiple_systems, v.is_deferred,
               a.street, a.city, a.subdivision, a.builder
      ORDER BY v.scheduled_time ASC NULLS LAST
    `);

    res.json(result.rows.map((r) => ({
      id: r.id,
      orderNumber: r.order_number,
      scheduledTime: r.scheduled_time,
      address: { street: r.street, city: r.city, subdivision: r.subdivision, builder: r.builder },
      hasMultipleSystems: r.has_multiple_systems,
      isDeferred: r.is_deferred,
      tags: buildTags(r.has_multiple_systems, r.has_a2l === true),
    })));
  } catch (err) {
    next(err);
  }
});

// POST /api/visits/:id/claim
visitsRouter.post('/:id/claim', requireRole('technician'), async (req, res, next) => {
  const { id } = req.params;
  try {
    const preCheck = await pool.query(
      'SELECT status, address_id, has_multiple_systems, is_deferred FROM visits WHERE id = $1',
      [id]
    );
    if (preCheck.rows.length === 0) return res.status(404).json({ error: 'Visit not found' });
    if (preCheck.rows[0].status !== 'in_lobby') {
      return res.status(409).json({ error: 'This visit was just claimed by another technician' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lockResult = await client.query(
        'SELECT status FROM visits WHERE id = $1 FOR UPDATE',
        [id]
      );
      if (lockResult.rows[0].status !== 'in_lobby') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This visit was just claimed by another technician' });
      }

      const now = new Date().toISOString();
      const updateResult = await client.query(
        `UPDATE visits SET status = 'assigned', technician_id = $1, updated_at = $2
         WHERE id = $3 AND status = 'in_lobby'
         RETURNING id, order_number, scheduled_time, has_multiple_systems, is_deferred, technician_id, address_id`,
        [req.technician.id, now, id]
      );
      if (updateResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This visit was just claimed by another technician' });
      }
      await client.query('COMMIT');

      const v = updateResult.rows[0];
      const addrResult = await pool.query(
        'SELECT street, city, subdivision, builder FROM addresses WHERE id = $1',
        [v.address_id]
      );
      const a = addrResult.rows[0];

      res.json({
        id: v.id,
        orderNumber: v.order_number,
        scheduledTime: v.scheduled_time,
        technicianId: v.technician_id,
        status: 'assigned',
        address: { street: a.street, city: a.city, subdivision: a.subdivision, builder: a.builder },
        hasMultipleSystems: v.has_multiple_systems,
        isDeferred: v.is_deferred,
        tags: buildTags(v.has_multiple_systems, false),
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

// GET /api/visits/mine — declared before /:id to prevent param capture
visitsRouter.get('/mine', requireRole('technician'), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT v.id, v.order_number, v.scheduled_time, v.has_multiple_systems,
              v.is_deferred, v.status, v.technician_id,
              a.street, a.city, a.subdivision, a.builder
       FROM visits v
       JOIN addresses a ON a.id = v.address_id
       WHERE v.technician_id = $1
         AND v.status IN ('assigned', 'in_progress', 'temporarily')
       ORDER BY v.is_deferred DESC, v.scheduled_time ASC NULLS LAST`,
      [req.technician.id]
    );

    res.json(result.rows.map((r) => ({
      id: r.id,
      orderNumber: r.order_number,
      scheduledTime: r.scheduled_time,
      technicianId: r.technician_id,
      status: r.status,
      address: { street: r.street, city: r.city, subdivision: r.subdivision, builder: r.builder },
      hasMultipleSystems: r.has_multiple_systems,
      isDeferred: r.is_deferred,
      tags: buildTags(r.has_multiple_systems, false),
    })));
  } catch (err) {
    next(err);
  }
});

module.exports = { visitsRouter, dispatchVisitsRouter };
