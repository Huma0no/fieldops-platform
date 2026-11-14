const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const { createNotification } = require('../helpers/notify');
const { hashPassword, validPassword, normalizeUsername, publicRole } = require('./auth');

const router = express.Router();
const ROLE_MAP = { DISPATCH_OWNER: 'owner', DISPATCHER: 'dispatcher', TECHNICIAN: 'technician' };

// POST /api/dispatch/technicians
router.post('/', requireRole('owner'), async (req, res, next) => {
  try {
    const { name, role: requestedRole, username: rawUsername, temporaryPassword } = req.body;
    const role = ROLE_MAP[requestedRole];
    const username = normalizeUsername(rawUsername);
    if (typeof name !== 'string' || !name.trim() || name.length > 200) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!role) {
      return res.status(400).json({ error: `role must be one of: ${Object.keys(ROLE_MAP).join(', ')}` });
    }
    if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
      return res.status(400).json({ error: 'username must be 3-64 characters using letters, numbers, dots, underscores, or hyphens' });
    }
    if (!validPassword(temporaryPassword)) {
      return res.status(400).json({ error: 'temporaryPassword must be between 12 and 256 characters' });
    }
    const passwordHash = await hashPassword(temporaryPassword);

    const createdAt = new Date().toISOString();
    const result = await pool.query(
      `INSERT INTO technicians (id, name, role, is_active, created_at, username, password_hash, must_change_password)
       VALUES (gen_random_uuid()::text, $1, $2, true, $3, $4, $5, true)
       RETURNING id, name, role, commission_rate, is_active, created_at`,
      [name.trim(), role, createdAt, username, passwordHash]
    );
    const row = result.rows[0];

    res.status(201).json({
      id: row.id,
      name: row.name,
      role: publicRole(row.role),
      commissionRate: row.commission_rate,
      isActive: row.is_active,
      createdAt: row.created_at,
      username,
      mustChangePassword: true,
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'technicians_username_ci_idx') {
      return res.status(409).json({ error: 'Username is already in use' });
    }
    next(err);
  }
});

// GET /api/dispatch/technicians
router.get('/', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const query = includeInactive
      ? 'SELECT id, name, role, commission_rate, is_active, created_at, username, password_hash, must_change_password FROM technicians ORDER BY created_at'
      : "SELECT id, name, role, commission_rate, is_active, created_at, username, password_hash, must_change_password FROM technicians WHERE is_active = true AND role = 'technician' ORDER BY created_at";

    const result = await pool.query(query);
    res.json(
      result.rows.map((r) => ({
        id: r.id,
        name: r.name,
        role: publicRole(r.role),
        commissionRate: r.commission_rate,
        isActive: r.is_active,
        createdAt: r.created_at,
        username: r.username,
        hasAccount: Boolean(r.password_hash),
        mustChangePassword: r.must_change_password,
      }))
    );
  } catch (err) {
    next(err);
  }
});

router.post('/:id/provision-account', requireRole('owner'), async (req, res, next) => {
  try {
    const username = normalizeUsername(req.body?.username);
    const temporaryPassword = req.body?.temporaryPassword;
    if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
      return res.status(400).json({ error: 'username must be 3-64 characters using letters, numbers, dots, underscores, or hyphens' });
    }
    if (!validPassword(temporaryPassword)) {
      return res.status(400).json({ error: 'temporaryPassword must be between 12 and 256 characters' });
    }
    const passwordHash = await hashPassword(temporaryPassword);
    const client = await pool.connect();
    let started = false;
    try {
      await client.query('BEGIN');
      started = true;
      const account = await client.query(
        'SELECT id, name, role, username, password_hash, is_active FROM technicians WHERE id = $1 FOR UPDATE',
        [req.params.id]
      );
      if (!account.rowCount) {
        await client.query('ROLLBACK');
        started = false;
        return res.status(404).json({ error: 'Technician not found' });
      }
      if (!account.rows[0].is_active) {
        await client.query('ROLLBACK');
        started = false;
        return res.status(409).json({ error: 'Reactivate this technician before provisioning account access' });
      }
      if (account.rows[0].username || account.rows[0].password_hash) {
        await client.query('ROLLBACK');
        started = false;
        return res.status(409).json({ error: 'This technician already has account credentials' });
      }
      await client.query(
        'UPDATE technicians SET username = $1, password_hash = $2, must_change_password = true WHERE id = $3',
        [username, passwordHash, req.params.id]
      );
      await client.query('COMMIT');
      started = false;
      res.status(201).json({
        id: account.rows[0].id,
        name: account.rows[0].name,
        role: publicRole(account.rows[0].role),
        username,
        mustChangePassword: true,
      });
    } catch (err) {
      if (started) await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'technicians_username_ci_idx') {
      return res.status(409).json({ error: 'Username is already in use' });
    }
    next(err);
  }
});

// PATCH /api/dispatch/technicians/:id/deactivate
router.patch('/:id/deactivate', requireRole('owner'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const client = await pool.connect();
    let transactionStarted = false;
    let name;
    try {
      await client.query('BEGIN');
      transactionStarted = true;

      const techResult = await client.query(
        'UPDATE technicians SET is_active = false WHERE id = $1 RETURNING name',
        [id]
      );
      if (techResult.rows.length === 0) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return res.status(404).json({ error: 'Technician not found' });
      }
      ({ name } = techResult.rows[0]);

      // Keep the shared lock order: technician, invitations, then device tokens.
      await client.query('DELETE FROM invite_codes WHERE technician_id = $1', [id]);
      await client.query('DELETE FROM device_tokens WHERE technician_id = $1', [id]);
      await client.query(
        'UPDATE auth_sessions SET revoked_at = $1 WHERE technician_id = $2 AND revoked_at IS NULL',
        [new Date().toISOString(), id]
      );
      await client.query('COMMIT');
      transactionStarted = false;
    } catch (err) {
      if (transactionStarted) {
        await client.query('ROLLBACK').catch(() => {});
      }
      throw err;
    } finally {
      client.release();
    }

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

// PATCH /api/dispatch/technicians/:id/commission-rate
router.patch('/:id/commission-rate', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { commissionRate } = req.body;

    if (typeof commissionRate !== 'number' || !Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 100) {
      return res.status(400).json({ error: 'commissionRate must be a number between 0 and 100' });
    }

    const techResult = await pool.query('SELECT role FROM technicians WHERE id = $1', [id]);
    if (techResult.rows.length === 0) {
      return res.status(404).json({ error: 'Technician not found' });
    }
    if (techResult.rows[0].role === 'owner') {
      return res.status(400).json({ error: 'commissionRate is not applicable to the owner role' });
    }

    await pool.query('UPDATE technicians SET commission_rate = $1 WHERE id = $2', [commissionRate, id]);
    res.json({ id, commissionRate });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/dispatch/technicians/:id/reactivate
router.patch('/:id/reactivate', requireRole('owner'), async (req, res, next) => {
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

router.patch('/:id/password', requireRole('owner'), async (req, res, next) => {
  try {
    const { temporaryPassword } = req.body ?? {};
    if (!validPassword(temporaryPassword)) {
      return res.status(400).json({ error: 'temporaryPassword must be between 12 and 256 characters' });
    }
    const passwordHash = await hashPassword(temporaryPassword);
    const client = await pool.connect();
    let started = false;
    try {
      await client.query('BEGIN');
      started = true;
      const account = await client.query('SELECT id, username FROM technicians WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!account.rowCount) {
        await client.query('ROLLBACK');
        started = false;
        return res.status(404).json({ error: 'Technician not found' });
      }
      if (!account.rows[0].username) {
        await client.query('ROLLBACK');
        started = false;
        return res.status(409).json({ error: 'Provision account credentials before resetting the password' });
      }
      await client.query(
        'UPDATE technicians SET password_hash = $1, must_change_password = true WHERE id = $2',
        [passwordHash, req.params.id]
      );
      await client.query(
        'UPDATE auth_sessions SET revoked_at = $1 WHERE technician_id = $2 AND revoked_at IS NULL',
        [new Date().toISOString(), req.params.id]
      );
      await client.query('COMMIT');
      started = false;
      res.json({ id: req.params.id, passwordReset: true, mustChangePassword: true });
    } catch (err) {
      if (started) await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

router.post('/:id/revoke-sessions', requireRole('owner'), async (req, res, next) => {
  let client;
  let started = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    started = true;
    const technician = await client.query('SELECT id FROM technicians WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!technician.rowCount) {
      await client.query('ROLLBACK');
      started = false;
      return res.status(404).json({ error: 'Technician not found' });
    }
    const result = await client.query(
      'UPDATE auth_sessions SET revoked_at = $1 WHERE technician_id = $2 AND revoked_at IS NULL',
      [new Date().toISOString(), req.params.id]
    );
    await client.query('COMMIT');
    started = false;
    res.json({ id: req.params.id, revokedSessions: result.rowCount });
  } catch (err) {
    if (started) await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client?.release();
  }
});

module.exports = router;
