const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  const bytes = crypto.randomBytes(6);
  for (const b of bytes) {
    code += chars[b % chars.length];
  }
  return code;
}

// POST /api/auth/generate-invite
router.post(
  '/generate-invite',
  authenticate,
  requireRole('owner', 'dispatcher'),
  async (req, res, next) => {
    try {
      const { technicianId } = req.body;

      const techResult = await pool.query(
        'SELECT id, is_active FROM technicians WHERE id = $1',
        [technicianId]
      );
      if (techResult.rows.length === 0) {
        return res.status(404).json({ error: 'Technician not found' });
      }
      if (!techResult.rows[0].is_active) {
        return res.status(400).json({
          error: 'Technician is inactive. Reactivate before generating an invite.',
        });
      }

      // Delete any existing unused invite for this technician
      await pool.query('DELETE FROM invite_codes WHERE technician_id = $1', [technicianId]);

      const code = generateCode();
      const expiresAt = new Date(Date.now() + 86400000).toISOString(); // 24h

      await pool.query(
        'INSERT INTO invite_codes (code, technician_id, expires_at) VALUES ($1, $2, $3)',
        [code, technicianId, expiresAt]
      );

      res.json({ inviteCode: code, expiresAt });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/auth/redeem-invite  (no auth)
router.post('/redeem-invite', async (req, res, next) => {
  try {
    const { inviteCode } = req.body;

    const inviteResult = await pool.query(
      'SELECT * FROM invite_codes WHERE code = $1',
      [inviteCode]
    );
    if (inviteResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid invite code' });
    }

    const invite = inviteResult.rows[0];
    if (new Date(invite.expires_at) < new Date()) {
      return res.status(401).json({ error: 'Invite code has expired' });
    }

    const deviceToken = crypto.randomBytes(32).toString('hex');
    const createdAt = new Date().toISOString();

    await pool.query(
      'INSERT INTO device_tokens (token, technician_id, created_at) VALUES ($1, $2, $3)',
      [deviceToken, invite.technician_id, createdAt]
    );

    await pool.query('DELETE FROM invite_codes WHERE code = $1', [inviteCode]);

    const techResult = await pool.query(
      'SELECT id, name, role FROM technicians WHERE id = $1',
      [invite.technician_id]
    );
    const technician = techResult.rows[0];

    res.json({ deviceToken, technician });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/revoke
router.post(
  '/revoke',
  authenticate,
  requireRole('owner', 'dispatcher'),
  async (req, res, next) => {
    try {
      const { technicianId } = req.body;
      await pool.query('DELETE FROM device_tokens WHERE technician_id = $1', [technicianId]);
      res.json({ revoked: true });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
