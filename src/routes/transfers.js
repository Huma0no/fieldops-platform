const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const { createNotification } = require('../helpers/notify');

const router = express.Router();

// GET /api/transfers/pending/mine — declared before /:id routes to prevent param capture
router.get('/transfers/pending/mine', requireRole('technician'), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT t.id, t.visit_id, t.from_tech_id, t.reason, t.created_at,
              ft.name AS from_tech_name,
              a.street
       FROM transfers t
       JOIN visits v ON v.id = t.visit_id
       JOIN addresses a ON a.id = v.address_id
       JOIN technicians ft ON ft.id = t.from_tech_id
       WHERE t.to_tech_id = $1 AND t.status = 'pending'
       ORDER BY t.created_at DESC`,
      [req.technician.id]
    );

    res.json(result.rows.map((r) => ({
      transferId: r.id,
      visitId: r.visit_id,
      fromTechnicianId: r.from_tech_id,
      fromTechnicianName: r.from_tech_name,
      address: { street: r.street },
      reason: r.reason,
      createdAt: r.created_at,
    })));
  } catch (err) {
    next(err);
  }
});

// POST /api/visits/:id/transfer/initiate
router.post('/visits/:id/transfer/initiate', requireRole('technician'), async (req, res, next) => {
  const { id } = req.params;
  const { toTechnicianId, reason } = req.body;
  try {
    const visitResult = await pool.query(
      `SELECT v.id, v.technician_id, a.street
       FROM visits v
       JOIN addresses a ON a.id = v.address_id
       WHERE v.id = $1`,
      [id]
    );
    if (visitResult.rows.length === 0) return res.status(404).json({ error: 'Visit not found' });
    const visit = visitResult.rows[0];

    if (visit.technician_id !== req.technician.id) {
      return res.status(403).json({ error: 'This visit is not assigned to you' });
    }

    const toTechResult = await pool.query(
      'SELECT id, name FROM technicians WHERE id = $1 AND is_active = true',
      [toTechnicianId]
    );
    if (toTechResult.rows.length === 0) {
      return res.status(400).json({ error: 'Technician not found or inactive' });
    }

    if (toTechnicianId === req.technician.id) {
      return res.status(400).json({ error: 'Cannot transfer to yourself' });
    }

    const pendingResult = await pool.query(
      `SELECT id FROM transfers WHERE visit_id = $1 AND status = 'pending'`,
      [id]
    );
    if (pendingResult.rows.length > 0) {
      return res.status(400).json({ error: 'A transfer request is already pending for this visit' });
    }

    const transferId = crypto.randomUUID();
    const now = new Date().toISOString();
    await pool.query(
      `INSERT INTO transfers (id, visit_id, from_tech_id, to_tech_id, reason, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
      [transferId, id, req.technician.id, toTechnicianId, reason ?? null, now]
    );

    await createNotification(pool, {
      recipientId: toTechnicianId,
      type: 'transfer_request',
      message: `${req.technician.name} wants to transfer ${visit.street} to you`,
    });

    res.json({ transferId, status: 'pending' });
  } catch (err) {
    next(err);
  }
});

// POST /api/transfers/:id/accept
router.post('/transfers/:id/accept', requireRole('technician'), async (req, res, next) => {
  const { id } = req.params;
  try {
    const transferResult = await pool.query(
      `SELECT t.id, t.visit_id, t.to_tech_id, t.from_tech_id, t.status,
              ft.name AS from_tech_name, tt.name AS to_tech_name,
              a.street
       FROM transfers t
       JOIN visits v ON v.id = t.visit_id
       JOIN addresses a ON a.id = v.address_id
       JOIN technicians ft ON ft.id = t.from_tech_id
       JOIN technicians tt ON tt.id = t.to_tech_id
       WHERE t.id = $1`,
      [id]
    );
    if (transferResult.rows.length === 0) return res.status(404).json({ error: 'Transfer not found' });
    const transfer = transferResult.rows[0];

    if (transfer.to_tech_id !== req.technician.id) {
      return res.status(403).json({ error: 'This transfer is not addressed to you' });
    }

    if (transfer.status !== 'pending') {
      return res.status(400).json({ error: 'Transfer is not pending' });
    }

    const now = new Date().toISOString();
    await pool.query(
      `UPDATE transfers SET status = 'accepted', resolved_at = $1 WHERE id = $2`,
      [now, id]
    );
    await pool.query(
      `UPDATE visits SET technician_id = $1, updated_at = $2 WHERE id = $3`,
      [req.technician.id, now, transfer.visit_id]
    );

    const dispatchersResult = await pool.query(
      `SELECT id FROM technicians WHERE role IN ('dispatcher', 'owner') AND is_active = true`
    );
    for (const d of dispatchersResult.rows) {
      await createNotification(pool, {
        recipientId: d.id,
        type: 'transfer_accepted',
        message: `${transfer.to_tech_name} accepted transfer of ${transfer.street} from ${transfer.from_tech_name}`,
      });
    }

    const [visitRow, systems, services, items, photos] = await Promise.all([
      pool.query(
        `SELECT v.id, v.order_number, v.scheduled_time, v.status, v.technician_id,
                v.has_multiple_systems, v.is_deferred,
                a.street, a.city, a.state, a.zip, a.subdivision, a.builder
         FROM visits v
         JOIN addresses a ON a.id = v.address_id
         WHERE v.id = $1`,
        [transfer.visit_id]
      ),
      pool.query(
        'SELECT system_number, indoor_model, outdoor_model, refrigerant FROM visit_systems WHERE visit_id = $1 ORDER BY system_number',
        [transfer.visit_id]
      ),
      pool.query(
        'SELECT service_name, is_finish, is_temporarily, price FROM visit_services WHERE visit_id = $1',
        [transfer.visit_id]
      ),
      pool.query(
        'SELECT category, item_name, quantity, price, tech_supplied FROM visit_items WHERE visit_id = $1',
        [transfer.visit_id]
      ),
      pool.query(
        'SELECT id, tag, label, category, system_number, stored_at FROM visit_photos WHERE visit_id = $1',
        [transfer.visit_id]
      ),
    ]);

    const v = visitRow.rows[0];
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

// POST /api/transfers/:id/reject
router.post('/transfers/:id/reject', requireRole('technician'), async (req, res, next) => {
  const { id } = req.params;
  try {
    const transferResult = await pool.query(
      `SELECT t.id, t.to_tech_id, t.from_tech_id, t.status, a.street,
              tt.name AS to_tech_name
       FROM transfers t
       JOIN visits v ON v.id = t.visit_id
       JOIN addresses a ON a.id = v.address_id
       JOIN technicians tt ON tt.id = t.to_tech_id
       WHERE t.id = $1`,
      [id]
    );
    if (transferResult.rows.length === 0) return res.status(404).json({ error: 'Transfer not found' });
    const transfer = transferResult.rows[0];

    if (transfer.to_tech_id !== req.technician.id) {
      return res.status(403).json({ error: 'This transfer is not addressed to you' });
    }

    if (transfer.status !== 'pending') {
      return res.status(400).json({ error: 'Transfer is not pending' });
    }

    const now = new Date().toISOString();
    await pool.query(
      `UPDATE transfers SET status = 'rejected', resolved_at = $1 WHERE id = $2`,
      [now, id]
    );

    await createNotification(pool, {
      recipientId: transfer.from_tech_id,
      type: 'transfer_rejected',
      message: `${transfer.to_tech_name} declined the transfer of ${transfer.street}`,
    });

    res.json({ transferId: id, status: 'rejected' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
