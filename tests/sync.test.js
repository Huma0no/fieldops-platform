const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');

beforeEach(truncateTables);
afterAll(() => pool.end());

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
    'INSERT INTO auth_sessions (token_hash, technician_id, created_at, expires_at) VALUES ($1, $2, $3, \'9999-12-31T00:00:00.000Z\')',
    [crypto.createHash('sha256').update(token).digest('hex'), technicianId, new Date().toISOString()]
  );
  return token;
}

describe('GET /api/sync/changes', () => {
  it('caps sign-in attempts per IP but never authenticated requests (CC-18)', async () => {
    const tech = await seedTech({ role: 'dispatcher' });
    const token = await seedToken(tech.id);
    // Lobby polls every 10 s: 120 requests is more than 15 minutes of it.
    for (let i = 0; i < 120; i++) {
      const res = await request(app).get('/api/dispatch/lobby').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    }

    const attempts = [];
    for (let i = 0; i < 11; i++) {
      attempts.push((await request(app).post('/api/auth/login').send({ username: 'nobody', password: 'wrong-password' })).status);
    }
    expect(attempts.slice(0, 10).every(status => status !== 429)).toBe(true);
    expect(attempts[10]).toBe(429);
  });

  it('returns 400 when since is missing', async () => {
    const tech = await seedTech();
    const token = await seedToken(tech.id);

    const res = await request(app)
      .get('/api/sync/changes')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing required query param: since');
  });

  it('returns 400 for invalid since value', async () => {
    const tech = await seedTech();
    const token = await seedToken(tech.id);

    const res = await request(app)
      .get('/api/sync/changes?since=not-a-date')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('since must be a valid ISO 8601 timestamp');
  });

  it('returns empty arrays and serverTime for fresh DB', async () => {
    const tech = await seedTech();
    const token = await seedToken(tech.id);

    const res = await request(app)
      .get('/api/sync/changes?since=2026-01-01T00:00:00Z')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.visits).toEqual([]);
    expect(res.body.notifications).toEqual([]);
    expect(res.body.chatMessages).toEqual([]);
    expect(res.body.corrections).toEqual([]);
    expect(res.body.serverTime).toBeDefined();
  });

  it('returns notifications created after since', async () => {
    const tech = await seedTech();
    const token = await seedToken(tech.id);
    const { createNotification } = require('../src/helpers/notify');

    const since = new Date(Date.now() - 5000).toISOString();
    await createNotification(pool, { recipientId: tech.id, type: 'test', message: 'New notif' });

    const res = await request(app)
      .get(`/api/sync/changes?since=${encodeURIComponent(since)}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.notifications).toHaveLength(1);
    expect(res.body.notifications[0].body).toBe('New notif');
  });
});
