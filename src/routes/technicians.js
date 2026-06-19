const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const { createNotification } = require('../helpers/notify');

const router = express.Router();
const VALID_ROLES = ['owner', 'dispatcher', 'technician'];

// POST /api/dispatch/technicians
router.post('/', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { name, role } = req.body;
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
    }

    const createdAt = new Date().toISOString();
    const result = await pool.query(
      `INSERT INTO technicians (id, name, role, is_active, created_at)
       VALUES (gen_random_uuid()::text, $1, $2, true, $3)
       RETURNING id, name, role, is_active, created_at`,
      [name, role, createdAt]
    );
    const row = result.rows[0];

    res.status(201).json({
      id: row.id,
      name: row.name,
      role: row.role,
      isActive: row.is_active,
      createdAt: row.created_at,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/dispatch/technicians
router.get('/', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const query = includeInactive
      ? 'SELECT id, name, role, is_active, created_at FROM technicians ORDER BY created_at'
      : 'SELECT id, name, role, is_active, created_at FROM technicians WHERE is_active = true ORDER BY created_at';

    const result = await pool.query(query);
    res.json(
      result.rows.map((r) => ({
        id: r.id,
        name: r.name,
        role: r.role,
        isActive: r.is_active,
        createdAt: r.created_at,
      }))
    );
  } catch (err) {
    next(err);
  }
});

// PATCH /api/dispatch/technicians/:id/deactivate
router.patch('/:id/deactivate', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const techResult = await pool.query(
      'UPDATE technicians SET is_active = false WHERE id = $1 RETURNING name',
      [id]
    );
    if (techResult.rows.length === 0) {
      return res.status(404).json({ error: 'Technician not found' });
    }
    const { name } = techResult.rows[0];

    // Find visits now orphaned
    const visitResult = await pool.query(
      `SELECT id FROM visits WHERE technician_id = $1 AND status IN ('assigned', 'in_progress')`,
      [id]
    );
    const orphanedVisitIds = visitResult.rows.map((r) => r.id);

    if (orphanedVisitIds.length > 0) {
      // Notify all active dispatchers and owners
      const staffResult = await pool.query(
        `SELECT id FROM technicians WHERE role IN ('owner', 'dispatcher') AND is_active = true`
      );
      const message = `Technician ${name} was deactivated. ${orphanedVisitIds.length} visit(s) are now unassigned: ${orphanedVisitIds.join(', ')}`;
      for (const staff of staffResult.rows) {
        await createNotification(pool, {
          recipientId: staff.id,
          type: 'technician_deactivated',
          message,
        });
      }
    }

    res.json({ id, isActive: false, orphanedVisitIds });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/dispatch/technicians/:id/reactivate
router.patch('/:id/reactivate', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'UPDATE technicians SET is_active = true WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Technician not found' });
    }
    res.json({ id, isActive: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
