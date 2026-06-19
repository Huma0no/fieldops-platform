const express = require('express');
const { pool } = require('../db/pool');

const router = express.Router();

// GET /api/sync/changes?since=<ISO8601>
router.get('/changes', async (req, res, next) => {
  try {
    const { since } = req.query;
    if (!since) {
      return res.status(400).json({ error: 'Missing required query param: since' });
    }

    const { id: callerId, role } = req.technician;
    const isTech = role === 'technician';

    // Visits — technicians only see their own; owner/dispatcher see all
    const visitResult = await pool.query(
      isTech
        ? `SELECT * FROM visits WHERE technician_id = $1 AND COALESCE(updated_at, created_at) > $2`
        : `SELECT * FROM visits WHERE COALESCE(updated_at, created_at) > $1`,
      isTech ? [callerId, since] : [since]
    );

    // Notifications for caller
    const notifResult = await pool.query(
      `SELECT * FROM notifications WHERE recipient_id = $1 AND created_at > $2`,
      [callerId, since]
    );

    // Chat messages: direct messages involving caller OR broadcast messages
    const chatResult = await pool.query(
      `SELECT * FROM chat_messages
       WHERE created_at > $1
         AND (
           sender_id = $2
           OR recipient_id = $2
           OR type = 'broadcast'
         )`,
      [since, callerId]
    );

    // Corrections — technicians see their own requests; owner/dispatcher see pending
    const corrResult = isTech
      ? await pool.query(
          `SELECT * FROM corrections WHERE requested_by = $1 AND requested_at > $2`,
          [callerId, since]
        )
      : await pool.query(
          `SELECT * FROM corrections WHERE status = 'pending' AND requested_at > $1`,
          [since]
        );

    res.json({
      visits: visitResult.rows,
      notifications: notifResult.rows,
      chatMessages: chatResult.rows,
      corrections: corrResult.rows,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
