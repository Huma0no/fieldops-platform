const crypto = require('crypto');

async function createNotification(db, { recipientId, type, message, linkTo = null, payload = null }) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const payloadStr = payload !== null ? JSON.stringify(payload) : null;

  const result = await db.query(
    `INSERT INTO notifications (id, recipient_id, type, body, link_to, payload, read, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, false, $7)
     RETURNING *`,
    [id, recipientId, type, message, linkTo, payloadStr, createdAt]
  );

  return result.rows[0];
}

module.exports = { createNotification };
