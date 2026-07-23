const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const { normalizeStreet } = require('../helpers/address');
const { createVisitWithSystems } = require('../helpers/visit');

const router = express.Router();

const VALID_ACTIONS = ['create_new', 'merge_keep_new', 'merge_keep_existing'];

// GET /api/addresses/search?q=
router.get('/search', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim().toUpperCase();
    if (q.length < 3) return res.json([]);
    const result = await pool.query(
      `SELECT id, street, city, subdivision, builder
       FROM addresses
       WHERE UPPER(street) LIKE $1
       ORDER BY street
       LIMIT 8`,
      [q + '%']
    );
    res.json(result.rows.map(r => ({
      id: r.id,
      street: r.street,
      city: r.city,
      subdivision: r.subdivision,
      builder: r.builder,
    })));
  } catch (err) {
    next(err);
  }
});

// POST /api/addresses/:id/resolve-comparison
router.post('/:id/resolve-comparison', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const existingId = req.params.id;
    const { action, incomingData, pendingVisitData } = req.body;

    if (!VALID_ACTIONS.includes(action)) {
      return res.status(400).json({ error: `action must be one of: ${VALID_ACTIONS.join(', ')}` });
    }

    if ((action === 'create_new' || action === 'merge_keep_new') &&
        (!incomingData || !incomingData.address)) {
      return res.status(400).json({ error: 'incomingData.address is required for this action' });
    }

    // Verify existing address exists
    const existingResult = await pool.query('SELECT * FROM addresses WHERE id = $1', [existingId]);
    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Address not found' });
    }

    let addressId;

    if (action === 'create_new') {
      const normalized = normalizeStreet(incomingData.address);
      const insertResult = await pool.query(
        `INSERT INTO addresses (id, street, city, state, zip, subdivision, builder)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [normalized, incomingData.city || null, incomingData.state || null,
         incomingData.zip || null, incomingData.subdivision || null, incomingData.builder || null]
      );
      addressId = insertResult.rows[0].id;

    } else if (action === 'merge_keep_new') {
      const normalized = normalizeStreet(incomingData.address);
      await pool.query(
        `UPDATE addresses
         SET street = $1, city = $2, state = $3, zip = $4, subdivision = $5, builder = $6
         WHERE id = $7`,
        [normalized, incomingData.city || null, incomingData.state || null,
         incomingData.zip || null, incomingData.subdivision || null,
         incomingData.builder || null, existingId]
      );
      addressId = existingId;

    } else {
      // merge_keep_existing: use existing address unchanged
      addressId = existingId;
    }

    const batchId = pendingVisitData.batchId || null;

    const thermostat = pendingVisitData.thermostat || pendingVisitData.preSpecifiedThermostat || null;
    const thermostatQty = parseInt(pendingVisitData.thermostatQty ?? pendingVisitData.preSpecifiedThermostatQty, 10) || 1;
    const accessoriesRaw = pendingVisitData.accessories ?? pendingVisitData.preIdentifiedAccessories;
    const accessories = Array.isArray(accessoriesRaw)
      ? accessoriesRaw
      : (typeof accessoriesRaw === 'string' ? accessoriesRaw.split(',').map(s => s.trim()).filter(Boolean) : []);

    const { visitId } = await createVisitWithSystems(pool, {
      addressId,
      batchId,
      orderNumber: pendingVisitData.orderNumber || null,
      scheduledTime: pendingVisitData.scheduledTime || null,
      workType: pendingVisitData.workType || null,
      systemCount: pendingVisitData.systemCount || 1,
      notes: pendingVisitData.notes || null,
      systems: pendingVisitData.systems || null,
      isPriority: pendingVisitData.isPriority || false,
      thermostat,
      thermostatQty,
      accessories,
    });

    if (batchId) {
      await pool.query('UPDATE pdf_batches SET total_calls = total_calls + 1 WHERE id = $1', [batchId]);
    }

    res.json({ visitId, addressId, batchId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
