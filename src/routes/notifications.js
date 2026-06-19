const express = require('express');
const { pool } = require('../db/pool');

const router = express.Router();

// GET /api/notifications/mine
router.get('/mine', async (req, res, next) => {
  try {
    const { id } = req.technician;
    const unreadOnly = req.query.unreadOnly === 'true';

    const query = unreadOnly
      ? `SELECT id, type, body, link_to, payload, read, created_at
         FROM notifications
         WHERE recipient_id = $1 AND read = false
         ORDER BY created_at DESC`
      : `SELECT id, type, body, link_to, payload, read, created_at
         FROM notifications
         WHERE recipient_id = $1
         ORDER BY created_at DESC`;

    const result = await pool.query(query, [id]);

    res.json(
      result.rows.map((r) => ({
        id: r.id,
        type: r.type,
        message: r.body,
        linkTo: r.link_to,
        payload: r.payload ? JSON.parse(r.payload) : null,
        read: r.read,
        createdAt: r.created_at,
      }))
    );
  } catch (err) {
    next(err);
  }
});

// PATCH /api/notifications/:id/mark-read
router.patch('/:id/mark-read', async (req, res, next) => {
  try {
    const notifId = req.params.id;
    const { id: callerId } = req.technician;

    const check = await pool.query(
      'SELECT recipient_id FROM notifications WHERE id = $1',
      [notifId]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    if (check.rows[0].recipient_id !== callerId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await pool.query('UPDATE notifications SET read = true WHERE id = $1', [notifId]);
    res.json({ id: notifId, read: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
