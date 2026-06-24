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

module.exports = { visitsRouter, dispatchVisitsRouter };
