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

// POST /api/visits/:id/start
visitsRouter.post('/:id/start', requireRole('technician'), async (req, res, next) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'SELECT status, technician_id FROM visits WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Visit not found' });
    const visit = result.rows[0];

    if (visit.technician_id !== req.technician.id) {
      return res.status(403).json({ error: 'This visit is not assigned to you' });
    }
    if (visit.status !== 'assigned') {
      return res.status(400).json({ error: `Visit cannot be started — current status: ${visit.status}` });
    }

    const now = new Date().toISOString();
    await pool.query(
      `UPDATE visits SET status = 'in_progress', updated_at = $1 WHERE id = $2`,
      [now, id]
    );

    res.json({ id, status: 'in_progress' });
  } catch (err) {
    next(err);
  }
});

// GET /api/visits/:id — declared after /mine to avoid param capture
visitsRouter.get('/:id', async (req, res, next) => {
  const { id } = req.params;
  try {
    const visitResult = await pool.query(
      `SELECT v.id, v.order_number, v.scheduled_time, v.status, v.technician_id,
              v.has_multiple_systems, v.is_deferred,
              a.street, a.city, a.state, a.zip, a.subdivision, a.builder
       FROM visits v
       JOIN addresses a ON a.id = v.address_id
       WHERE v.id = $1`,
      [id]
    );
    if (visitResult.rows.length === 0) return res.status(404).json({ error: 'Visit not found' });
    const v = visitResult.rows[0];

    if (req.technician.role === 'technician' && v.technician_id !== req.technician.id) {
      return res.status(403).json({ error: 'This visit is not assigned to you' });
    }

    const [systems, services, items, photos] = await Promise.all([
      pool.query(
        'SELECT system_number, indoor_model, outdoor_model, refrigerant FROM visit_systems WHERE visit_id = $1 ORDER BY system_number',
        [id]
      ),
      pool.query(
        'SELECT service_name, is_finish, is_temporarily, price FROM visit_services WHERE visit_id = $1',
        [id]
      ),
      pool.query(
        'SELECT category, item_name, quantity, price, tech_supplied FROM visit_items WHERE visit_id = $1',
        [id]
      ),
      pool.query(
        'SELECT id, tag, label, category, system_number, stored_at FROM visit_photos WHERE visit_id = $1',
        [id]
      ),
    ]);

    res.json({
      id: v.id,
      orderNumber: v.order_number,
      scheduledTime: v.scheduled_time,
      status: v.status,
      technicianId: v.technician_id,
      hasMultipleSystems: v.has_multiple_systems,
      isDeferred: v.is_deferred,
      address: { street: v.street, city: v.city, state: v.state, zip: v.zip, subdivision: v.subdivision, builder: v.builder },
      systems: systems.rows.map((s) => ({ systemNumber: s.system_number, indoorModel: s.indoor_model, outdoorModel: s.outdoor_model, refrigerant: s.refrigerant })),
      services: services.rows.map((s) => ({ serviceName: s.service_name, isFinish: s.is_finish, isTemporarily: s.is_temporarily, price: s.price })),
      items: items.rows.map((i) => ({ category: i.category, itemName: i.item_name, quantity: i.quantity, price: i.price, techSupplied: i.tech_supplied })),
      photos: photos.rows.map((p) => ({ id: p.id, tag: p.tag, label: p.label, category: p.category, systemNumber: p.system_number, storedAt: p.stored_at })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = { visitsRouter, dispatchVisitsRouter };
