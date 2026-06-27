const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const { createNotification } = require('../helpers/notify');

const router = express.Router();

function messagePreview(body) {
  return body.length > 60 ? body.slice(0, 60) + '...' : body;
}

// GET /api/chat/direct/:technicianId
router.get('/direct/:technicianId', async (req, res, next) => {
  try {
    const me = req.technician.id;
    const { technicianId } = req.params;

    const result = await pool.query(
      `SELECT id, sender_id, recipient_id, body, created_at
       FROM chat_messages
       WHERE type = 'direct'
         AND ((sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1))
       ORDER BY created_at ASC`,
      [me, technicianId]
    );

    res.json(result.rows.map((r) => ({
      id: r.id,
      senderId: r.sender_id,
      recipientId: r.recipient_id,
      body: r.body,
      createdAt: r.created_at,
    })));
  } catch (err) {
    next(err);
  }
});

// POST /api/chat/direct/:technicianId
router.post('/direct/:technicianId', async (req, res, next) => {
  try {
    const me = req.technician;
    const { technicianId } = req.params;
    const { body } = req.body;

    if (technicianId === me.id) {
      return res.status(400).json({ error: 'Cannot send a message to yourself' });
    }

    const recipResult = await pool.query(
      `SELECT id FROM technicians WHERE id = $1 AND is_active = true`,
      [technicianId]
    );
    if (recipResult.rows.length === 0) {
      return res.status(400).json({ error: 'Recipient not found or inactive' });
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await pool.query(
      `INSERT INTO chat_messages (id, sender_id, recipient_id, body, type, created_at)
       VALUES ($1, $2, $3, $4, 'direct', $5)`,
      [id, me.id, technicianId, body, createdAt]
    );

    await createNotification(pool, {
      recipientId: technicianId,
      type: 'message',
      message: `${me.name}: ${messagePreview(body)}`,
    });

    res.json({ id, senderId: me.id, recipientId: technicianId, body, createdAt });
  } catch (err) {
    next(err);
  }
});

// GET /api/chat/broadcast
router.get('/broadcast', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, sender_id, body, created_at
       FROM chat_messages
       WHERE type = 'broadcast'
       ORDER BY created_at ASC`
    );

    res.json(result.rows.map((r) => ({
      id: r.id,
      senderId: r.sender_id,
      body: r.body,
      createdAt: r.created_at,
    })));
  } catch (err) {
    next(err);
  }
});

// POST /api/chat/broadcast
router.post('/broadcast', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const me = req.technician;
    const { body } = req.body;

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await pool.query(
      `INSERT INTO chat_messages (id, sender_id, recipient_id, body, type, created_at)
       VALUES ($1, $2, null, $3, 'broadcast', $4)`,
      [id, me.id, body, createdAt]
    );

    const techResult = await pool.query(
      `SELECT id FROM technicians WHERE role = 'technician' AND is_active = true`
    );
    const preview = body.length > 60 ? body.slice(0, 60) : body;
    for (const row of techResult.rows) {
      await createNotification(pool, {
        recipientId: row.id,
        type: 'broadcast',
        message: `${me.name} (broadcast): ${preview}`,
      });
    }

    res.json({ id, senderId: me.id, body, createdAt });
  } catch (err) {
    next(err);
  }
});

// POST /api/chat/:messageId/mark-read
router.post('/:messageId/mark-read', async (req, res, next) => {
  try {
    const { messageId } = req.params;
    const techId = req.technician.id;

    const msgResult = await pool.query(
      `SELECT id, type, recipient_id FROM chat_messages WHERE id = $1`,
      [messageId]
    );
    if (msgResult.rows.length === 0) return res.status(404).json({ error: 'Message not found' });
    const msg = msgResult.rows[0];

    if (msg.type === 'direct' && msg.recipient_id !== techId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const readAt = new Date().toISOString();
    await pool.query(
      `INSERT INTO chat_reads (id, message_id, technician_id, read_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (message_id, technician_id) DO NOTHING`,
      [crypto.randomUUID(), messageId, techId, readAt]
    );

    res.json({ messageId, readAt });
  } catch (err) {
    next(err);
  }
});

// GET /api/chat/broadcast/:messageId/read-receipts
router.get('/broadcast/:messageId/read-receipts', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { messageId } = req.params;

    const msgResult = await pool.query(
      `SELECT id, type FROM chat_messages WHERE id = $1`,
      [messageId]
    );
    if (msgResult.rows.length === 0) return res.status(404).json({ error: 'Message not found' });
    if (msgResult.rows[0].type !== 'broadcast') {
      return res.status(400).json({ error: 'Message is not a broadcast' });
    }

    const result = await pool.query(
      `SELECT cr.technician_id, t.name AS technician_name, cr.read_at
       FROM chat_reads cr
       JOIN technicians t ON t.id = cr.technician_id
       WHERE cr.message_id = $1`,
      [messageId]
    );

    res.json(result.rows.map((r) => ({
      technicianId: r.technician_id,
      technicianName: r.technician_name,
      readAt: r.read_at,
    })));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
