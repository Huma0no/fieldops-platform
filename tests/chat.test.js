const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');
const { seedDispatcherWithToken, seedTechnicianWithToken, seedTech, seedToken } = require('./helpers/seeds');

beforeEach(truncateTables);
afterAll(() => pool.end());

// ── GET /api/chat/direct/:technicianId ───────────────────────────────────────

describe('GET /api/chat/direct/:technicianId', () => {
  it('returns conversation between two users in chronological order', async () => {
    const { tech: alice, token: aliceToken } = await seedTechnicianWithToken({ name: 'Alice' });
    const { tech: bob, token: bobToken } = await seedTechnicianWithToken({ name: 'Bob' });

    const t1 = new Date(Date.now() - 2000).toISOString();
    const t2 = new Date(Date.now() - 1000).toISOString();
    const t3 = new Date().toISOString();

    await pool.query(
      `INSERT INTO chat_messages (id, sender_id, recipient_id, body, type, created_at)
       VALUES ($1, $2, $3, 'Hello Bob', 'direct', $4)`,
      [crypto.randomUUID(), alice.id, bob.id, t1]
    );
    await pool.query(
      `INSERT INTO chat_messages (id, sender_id, recipient_id, body, type, created_at)
       VALUES ($1, $2, $3, 'Hey Alice', 'direct', $4)`,
      [crypto.randomUUID(), bob.id, alice.id, t2]
    );
    await pool.query(
      `INSERT INTO chat_messages (id, sender_id, recipient_id, body, type, created_at)
       VALUES ($1, $2, $3, 'How are you?', 'direct', $4)`,
      [crypto.randomUUID(), alice.id, bob.id, t3]
    );

    const res = await request(app)
      .get(`/api/chat/direct/${bob.id}`)
      .set('Authorization', `Bearer ${aliceToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body[0].body).toBe('Hello Bob');
    expect(res.body[1].body).toBe('Hey Alice');
    expect(res.body[2].body).toBe('How are you?');
    expect(res.body[0]).toMatchObject({ senderId: alice.id, recipientId: bob.id });
  });

  it('returns empty array when no messages exist', async () => {
    const { tech: alice, token } = await seedTechnicianWithToken({ name: 'Alice' });
    const { tech: bob } = await seedTechnicianWithToken({ name: 'Bob' });

    const res = await request(app)
      .get(`/api/chat/direct/${bob.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('does not include messages from unrelated conversations', async () => {
    const { tech: alice, token } = await seedTechnicianWithToken({ name: 'Alice' });
    const { tech: bob } = await seedTechnicianWithToken({ name: 'Bob' });
    const { tech: carol } = await seedTechnicianWithToken({ name: 'Carol' });

    await pool.query(
      `INSERT INTO chat_messages (id, sender_id, recipient_id, body, type, created_at)
       VALUES ($1, $2, $3, 'Carol to Bob', 'direct', $4)`,
      [crypto.randomUUID(), carol.id, bob.id, new Date().toISOString()]
    );

    const res = await request(app)
      .get(`/api/chat/direct/${bob.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

// ── POST /api/chat/direct/:technicianId ──────────────────────────────────────

describe('POST /api/chat/direct/:technicianId', () => {
  it('creates a message and returns it', async () => {
    const { tech: alice, token } = await seedTechnicianWithToken({ name: 'Alice' });
    const { tech: bob } = await seedTechnicianWithToken({ name: 'Bob' });

    const res = await request(app)
      .post(`/api/chat/direct/${bob.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Hello Bob' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(res.body.senderId).toBe(alice.id);
    expect(res.body.recipientId).toBe(bob.id);
    expect(res.body.body).toBe('Hello Bob');
    expect(res.body.createdAt).toBeDefined();

    const row = await pool.query('SELECT * FROM chat_messages WHERE id = $1', [res.body.id]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].type).toBe('direct');
  });

  it('creates a notification for the recipient', async () => {
    const { tech: alice, token } = await seedTechnicianWithToken({ name: 'Alice' });
    const { tech: bob } = await seedTechnicianWithToken({ name: 'Bob' });

    await request(app)
      .post(`/api/chat/direct/${bob.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Hello Bob' });

    const notif = await pool.query(
      `SELECT * FROM notifications WHERE recipient_id = $1 AND type = 'message'`,
      [bob.id]
    );
    expect(notif.rows).toHaveLength(1);
    expect(notif.rows[0].body).toContain('Alice');
    expect(notif.rows[0].body).toContain('Hello Bob');
  });

  it('truncates notification body preview to 60 chars with ellipsis', async () => {
    const { tech: alice, token } = await seedTechnicianWithToken({ name: 'Alice' });
    const { tech: bob } = await seedTechnicianWithToken({ name: 'Bob' });
    const longBody = 'A'.repeat(80);

    await request(app)
      .post(`/api/chat/direct/${bob.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: longBody });

    const notif = await pool.query(
      `SELECT body FROM notifications WHERE recipient_id = $1 AND type = 'message'`,
      [bob.id]
    );
    expect(notif.rows[0].body).toContain('...');
    expect(notif.rows[0].body).not.toContain('A'.repeat(61));
  });

  it('does not append ellipsis when body is 60 chars or fewer', async () => {
    const { tech: alice, token } = await seedTechnicianWithToken({ name: 'Alice' });
    const { tech: bob } = await seedTechnicianWithToken({ name: 'Bob' });
    const shortBody = 'A'.repeat(60);

    await request(app)
      .post(`/api/chat/direct/${bob.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: shortBody });

    const notif = await pool.query(
      `SELECT body FROM notifications WHERE recipient_id = $1 AND type = 'message'`,
      [bob.id]
    );
    expect(notif.rows[0].body).not.toContain('...');
  });

  it('returns 400 when sending to yourself', async () => {
    const { tech, token } = await seedTechnicianWithToken();

    const res = await request(app)
      .post(`/api/chat/direct/${tech.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Hello me' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when recipient does not exist or is inactive', async () => {
    const { token } = await seedTechnicianWithToken();

    const res = await request(app)
      .post('/api/chat/direct/nonexistent-id')
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Hello?' });

    expect(res.status).toBe(400);
  });
});

// ── GET /api/chat/broadcast ───────────────────────────────────────────────────

describe('GET /api/chat/broadcast', () => {
  it('returns all broadcasts in chronological order', async () => {
    const { dispatcher, token } = await seedDispatcherWithToken();

    const t1 = new Date(Date.now() - 1000).toISOString();
    const t2 = new Date().toISOString();

    await pool.query(
      `INSERT INTO chat_messages (id, sender_id, recipient_id, body, type, created_at)
       VALUES ($1, $2, null, 'First broadcast', 'broadcast', $3)`,
      [crypto.randomUUID(), dispatcher.id, t1]
    );
    await pool.query(
      `INSERT INTO chat_messages (id, sender_id, recipient_id, body, type, created_at)
       VALUES ($1, $2, null, 'Second broadcast', 'broadcast', $3)`,
      [crypto.randomUUID(), dispatcher.id, t2]
    );

    const res = await request(app)
      .get('/api/chat/broadcast')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    expect(res.body[0].body).toBe('First broadcast');
    expect(res.body[1].body).toBe('Second broadcast');
    expect(res.body[0]).toHaveProperty('senderId');
    expect(res.body[0]).toHaveProperty('createdAt');
    expect(res.body[0]).not.toHaveProperty('recipientId');
  });

  it('is accessible to technician role', async () => {
    const { token } = await seedTechnicianWithToken();
    const res = await request(app)
      .get('/api/chat/broadcast')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

// ── POST /api/chat/broadcast ──────────────────────────────────────────────────

describe('POST /api/chat/broadcast', () => {
  it('creates a broadcast message and notifies active technicians', async () => {
    const { dispatcher, token } = await seedDispatcherWithToken();
    const { tech: tech1 } = await seedTechnicianWithToken({ name: 'Tech-A' });
    const { tech: tech2 } = await seedTechnicianWithToken({ name: 'Tech-B' });

    const res = await request(app)
      .post('/api/chat/broadcast')
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Team meeting at 3pm' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(res.body.senderId).toBe(dispatcher.id);
    expect(res.body.body).toBe('Team meeting at 3pm');
    expect(res.body.createdAt).toBeDefined();
    expect(res.body).not.toHaveProperty('recipientId');

    const notifs = await pool.query(
      `SELECT * FROM notifications WHERE type = 'broadcast'`
    );
    const recipientIds = notifs.rows.map((r) => r.recipient_id);
    expect(recipientIds).toContain(tech1.id);
    expect(recipientIds).toContain(tech2.id);
    expect(recipientIds).not.toContain(dispatcher.id);
  });

  it('truncates notification preview to 60 chars', async () => {
    const { token } = await seedDispatcherWithToken();
    await seedTechnicianWithToken({ name: 'Tech-C' });
    const longBody = 'B'.repeat(80);

    await request(app)
      .post('/api/chat/broadcast')
      .set('Authorization', `Bearer ${token}`)
      .send({ body: longBody });

    const notif = await pool.query(
      `SELECT body FROM notifications WHERE type = 'broadcast' LIMIT 1`
    );
    const preview = notif.rows[0].body;
    expect(preview).not.toContain('B'.repeat(61));
  });

  it('returns 403 for technician role', async () => {
    const { token } = await seedTechnicianWithToken();
    const res = await request(app)
      .post('/api/chat/broadcast')
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Hello' });
    expect(res.status).toBe(403);
  });
});

// ── POST /api/chat/:messageId/mark-read ──────────────────────────────────────

describe('POST /api/chat/:messageId/mark-read', () => {
  it('marks a direct message read and returns messageId + readAt', async () => {
    const { tech: alice } = await seedTechnicianWithToken({ name: 'Alice' });
    const { tech: bob, token: bobToken } = await seedTechnicianWithToken({ name: 'Bob' });

    const msgId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO chat_messages (id, sender_id, recipient_id, body, type, created_at)
       VALUES ($1, $2, $3, 'Hello Bob', 'direct', $4)`,
      [msgId, alice.id, bob.id, new Date().toISOString()]
    );

    const res = await request(app)
      .post(`/api/chat/${msgId}/mark-read`)
      .set('Authorization', `Bearer ${bobToken}`);

    expect(res.status).toBe(200);
    expect(res.body.messageId).toBe(msgId);
    expect(res.body.readAt).toBeDefined();

    const row = await pool.query('SELECT * FROM chat_reads WHERE message_id = $1', [msgId]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].technician_id).toBe(bob.id);
  });

  it('is idempotent — calling twice does not error', async () => {
    const { tech: alice } = await seedTechnicianWithToken({ name: 'Alice' });
    const { tech: bob, token: bobToken } = await seedTechnicianWithToken({ name: 'Bob' });

    const msgId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO chat_messages (id, sender_id, recipient_id, body, type, created_at)
       VALUES ($1, $2, $3, 'Hey', 'direct', $4)`,
      [msgId, alice.id, bob.id, new Date().toISOString()]
    );

    await request(app)
      .post(`/api/chat/${msgId}/mark-read`)
      .set('Authorization', `Bearer ${bobToken}`);

    const res = await request(app)
      .post(`/api/chat/${msgId}/mark-read`)
      .set('Authorization', `Bearer ${bobToken}`);

    expect(res.status).toBe(200);
  });

  it('any technician can mark a broadcast read', async () => {
    const { dispatcher } = await seedDispatcherWithToken();
    const { tech, token } = await seedTechnicianWithToken();

    const msgId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO chat_messages (id, sender_id, recipient_id, body, type, created_at)
       VALUES ($1, $2, null, 'Broadcast msg', 'broadcast', $3)`,
      [msgId, dispatcher.id, new Date().toISOString()]
    );

    const res = await request(app)
      .post(`/api/chat/${msgId}/mark-read`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('returns 403 when non-recipient tries to mark a direct message read', async () => {
    const { tech: alice } = await seedTechnicianWithToken({ name: 'Alice' });
    const { tech: bob } = await seedTechnicianWithToken({ name: 'Bob' });
    const { tech: carol, token: carolToken } = await seedTechnicianWithToken({ name: 'Carol' });

    const msgId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO chat_messages (id, sender_id, recipient_id, body, type, created_at)
       VALUES ($1, $2, $3, 'Private', 'direct', $4)`,
      [msgId, alice.id, bob.id, new Date().toISOString()]
    );

    const res = await request(app)
      .post(`/api/chat/${msgId}/mark-read`)
      .set('Authorization', `Bearer ${carolToken}`);

    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown message', async () => {
    const { token } = await seedTechnicianWithToken();
    const res = await request(app)
      .post('/api/chat/nonexistent-id/mark-read')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

// ── GET /api/chat/broadcast/:messageId/read-receipts ─────────────────────────

describe('GET /api/chat/broadcast/:messageId/read-receipts', () => {
  it('returns who has read the broadcast', async () => {
    const { dispatcher, token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();

    const msgId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO chat_messages (id, sender_id, recipient_id, body, type, created_at)
       VALUES ($1, $2, null, 'All hands', 'broadcast', $3)`,
      [msgId, dispatcher.id, new Date().toISOString()]
    );

    const readAt = new Date().toISOString();
    await pool.query(
      `INSERT INTO chat_reads (id, message_id, technician_id, read_at)
       VALUES (gen_random_uuid()::text, $1, $2, $3)`,
      [msgId, tech.id, readAt]
    );

    const res = await request(app)
      .get(`/api/chat/broadcast/${msgId}/read-receipts`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].technicianId).toBe(tech.id);
    expect(res.body[0].technicianName).toBe(tech.name);
    expect(res.body[0].readAt).toBe(readAt);
  });

  it('returns 400 if message is not a broadcast', async () => {
    const { tech: alice } = await seedTechnicianWithToken({ name: 'Alice' });
    const { tech: bob } = await seedTechnicianWithToken({ name: 'Bob' });
    const { token } = await seedDispatcherWithToken();

    const msgId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO chat_messages (id, sender_id, recipient_id, body, type, created_at)
       VALUES ($1, $2, $3, 'Private', 'direct', $4)`,
      [msgId, alice.id, bob.id, new Date().toISOString()]
    );

    const res = await request(app)
      .get(`/api/chat/broadcast/${msgId}/read-receipts`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown message', async () => {
    const { token } = await seedDispatcherWithToken();
    const res = await request(app)
      .get('/api/chat/broadcast/nonexistent-id/read-receipts')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('returns 403 for technician role', async () => {
    const { token } = await seedTechnicianWithToken();
    const res = await request(app)
      .get('/api/chat/broadcast/some-id/read-receipts')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
