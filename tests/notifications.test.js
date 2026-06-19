const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');
const { createNotification } = require('../src/helpers/notify');

beforeEach(truncateTables);
afterAll(() => pool.end());

describe('createNotification helper', () => {
  it('inserts a notification row and returns it', async () => {
    // seed a technician to act as recipient
    const tech = await pool.query(
      `INSERT INTO technicians (id, name, role, is_active, created_at)
       VALUES (gen_random_uuid()::text, 'Alice', 'technician', true, $1)
       RETURNING id`,
      [new Date().toISOString()]
    );
    const recipientId = tech.rows[0].id;

    const result = await createNotification(pool, {
      recipientId,
      type: 'test_type',
      message: 'Hello world',
      linkTo: '/visits/123',
      payload: { visitId: '123' },
    });

    expect(result.id).toBeDefined();
    expect(result.recipient_id).toBe(recipientId);
    expect(result.body).toBe('Hello world');
    expect(result.link_to).toBe('/visits/123');
    expect(result.read).toBe(false);
  });
});

async function seedTech({ role = 'technician', name = 'Alice' } = {}) {
  const r = await pool.query(
    `INSERT INTO technicians (id, name, role, is_active, created_at)
     VALUES (gen_random_uuid()::text, $1, $2, true, $3)
     RETURNING id`,
    [name, role, new Date().toISOString()]
  );
  return r.rows[0];
}

async function seedToken(technicianId) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    'INSERT INTO device_tokens (token, technician_id, created_at) VALUES ($1, $2, $3)',
    [token, technicianId, new Date().toISOString()]
  );
  return token;
}

describe('GET /api/notifications/mine', () => {
  it('returns empty array when no notifications exist', async () => {
    const tech = await seedTech();
    const token = await seedToken(tech.id);

    const res = await request(app)
      .get('/api/notifications/mine')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns only caller notifications, newest first', async () => {
    const tech = await seedTech();
    const token = await seedToken(tech.id);
    const other = await seedTech({ name: 'Bob' });

    await createNotification(pool, { recipientId: tech.id, type: 'a', message: 'First' });
    await createNotification(pool, { recipientId: tech.id, type: 'b', message: 'Second' });
    await createNotification(pool, { recipientId: other.id, type: 'c', message: 'Other' });

    const res = await request(app)
      .get('/api/notifications/mine')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].message).toBe('Second');
    expect(res.body[1].message).toBe('First');
  });

  it('filters by unreadOnly=true', async () => {
    const tech = await seedTech();
    const token = await seedToken(tech.id);

    const n = await createNotification(pool, { recipientId: tech.id, type: 'a', message: 'Unread' });
    await pool.query('INSERT INTO notifications (id, recipient_id, type, body, read, created_at) VALUES (gen_random_uuid()::text, $1, $2, $3, true, $4)', [tech.id, 'b', 'Read', new Date().toISOString()]);

    const res = await request(app)
      .get('/api/notifications/mine?unreadOnly=true')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].message).toBe('Unread');
  });
});

describe('PATCH /api/notifications/:id/mark-read', () => {
  it('marks notification as read', async () => {
    const tech = await seedTech();
    const token = await seedToken(tech.id);
    const n = await createNotification(pool, { recipientId: tech.id, type: 'a', message: 'M' });

    const res = await request(app)
      .patch(`/api/notifications/${n.id}/mark-read`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.read).toBe(true);
  });

  it('returns 403 for notification belonging to another user', async () => {
    const tech = await seedTech();
    const token = await seedToken(tech.id);
    const other = await seedTech({ name: 'Bob' });
    const n = await createNotification(pool, { recipientId: other.id, type: 'a', message: 'M' });

    const res = await request(app)
      .patch(`/api/notifications/${n.id}/mark-read`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});
