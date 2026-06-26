const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/dispatch/history
router.get('/history', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { addressId, technicianId, dateFrom, dateTo, status } = req.query;
    const conditions = [];
    const params = [];

    if (addressId) {
      params.push(addressId);
      conditions.push(`v.address_id = $${params.length}`);
    }
    if (technicianId) {
      params.push(technicianId);
      conditions.push(`v.technician_id = $${params.length}`);
    }
    if (dateFrom) {
      params.push(dateFrom);
      conditions.push(`v.completed_at >= $${params.length}`);
    }
    if (dateTo) {
      params.push(dateTo);
      conditions.push(`v.completed_at <= $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`v.status = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT v.id, v.order_number, v.status, v.completed_at, v.total_price, v.technician_id,
              a.street, a.city, a.subdivision, a.builder
       FROM visits v
       JOIN addresses a ON a.id = v.address_id
       ${where}
       ORDER BY v.completed_at DESC`,
      params
    );

    res.json(result.rows.map((r) => ({
      id: r.id,
      orderNumber: r.order_number,
      status: r.status,
      completedAt: r.completed_at,
      totalPrice: r.total_price,
      technicianId: r.technician_id,
      address: { street: r.street, city: r.city, subdivision: r.subdivision, builder: r.builder },
    })));
  } catch (err) {
    next(err);
  }
});

// GET /api/dispatch/history/address/:addressId
router.get('/history/address/:addressId', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { addressId } = req.params;

    const result = await pool.query(
      `SELECT v.id, v.order_number, v.status, v.completed_at, v.total_price,
              v.technician_id, v.created_at,
              t.name AS technician_name
       FROM visits v
       LEFT JOIN technicians t ON t.id = v.technician_id
       WHERE v.address_id = $1
       ORDER BY v.created_at ASC`,
      [addressId]
    );

    res.json(result.rows.map((r) => ({
      id: r.id,
      orderNumber: r.order_number,
      status: r.status,
      completedAt: r.completed_at,
      totalPrice: r.total_price,
      technicianId: r.technician_id,
      technicianName: r.technician_name,
      createdAt: r.created_at,
    })));
  } catch (err) {
    next(err);
  }
});

// PATCH /api/dispatch/visits/:id
router.patch('/visits/:id', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const visitResult = await pool.query('SELECT id FROM visits WHERE id = $1', [id]);
    if (visitResult.rows.length === 0) return res.status(404).json({ error: 'Visit not found' });

    const EDITABLE = ['orderNumber', 'scheduledTime', 'notes', 'technicianId', 'status'];
    const DB_FIELD = {
      orderNumber: 'order_number',
      scheduledTime: 'scheduled_time',
      notes: 'notes',
      technicianId: 'technician_id',
      status: 'status',
    };

    const fieldsToUpdate = EDITABLE.filter((f) => req.body[f] !== undefined);
    if (fieldsToUpdate.length === 0) {
      const row = await pool.query(
        `SELECT v.id, v.order_number, v.status, v.technician_id, v.notes, v.scheduled_time,
                v.completed_at, v.total_price
         FROM visits v WHERE v.id = $1`,
        [id]
      );
      const v = row.rows[0];
      return res.json({
        id: v.id,
        orderNumber: v.order_number,
        status: v.status,
        technicianId: v.technician_id,
        notes: v.notes,
        scheduledTime: v.scheduled_time,
        completedAt: v.completed_at,
        totalPrice: v.total_price,
      });
    }

    if (req.body.technicianId !== undefined) {
      const techResult = await pool.query(
        'SELECT id FROM technicians WHERE id = $1 AND is_active = true',
        [req.body.technicianId]
      );
      if (techResult.rows.length === 0) {
        return res.status(400).json({ error: 'Technician not found or inactive' });
      }
    }

    const now = new Date().toISOString();
    const setClauses = fieldsToUpdate.map((f, i) => `${DB_FIELD[f]} = $${i + 1}`);
    setClauses.push(`updated_at = $${fieldsToUpdate.length + 1}`);
    const values = fieldsToUpdate.map((f) => req.body[f]);
    values.push(now);
    values.push(id);

    const updated = await pool.query(
      `UPDATE visits SET ${setClauses.join(', ')} WHERE id = $${values.length}
       RETURNING id, order_number, status, technician_id, notes, scheduled_time, completed_at, total_price`,
      values
    );

    const logId = crypto.randomUUID();
    const changedNames = fieldsToUpdate.join(', ');
    await pool.query(
      `INSERT INTO edit_log (id, visit_id, changed_at, summary, source)
       VALUES ($1, $2, $3, $4, 'dispatch_direct')`,
      [logId, id, now, `Dispatcher updated: ${changedNames}`]
    );

    const v = updated.rows[0];
    res.json({
      id: v.id,
      orderNumber: v.order_number,
      status: v.status,
      technicianId: v.technician_id,
      notes: v.notes,
      scheduledTime: v.scheduled_time,
      completedAt: v.completed_at,
      totalPrice: v.total_price,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/dispatch/visits/:id/edit-log
router.get('/visits/:id/edit-log', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT id, changed_at, summary, source
       FROM edit_log
       WHERE visit_id = $1
       ORDER BY changed_at ASC`,
      [id]
    );

    res.json(result.rows.map((r) => ({
      id: r.id,
      changedAt: r.changed_at,
      summary: r.summary,
      source: r.source,
    })));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
