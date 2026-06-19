const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');

beforeEach(truncateTables);
afterAll(() => pool.end());

async function seedTech({ role = 'technician', isActive = true, name = 'Alice' } = {}) {
  const r = await pool.query(
    `INSERT INTO technicians (id, name, role, is_active, created_at)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4)
     RETURNING id, name, role, is_active, created_at`,
    [name, role, isActive, new Date().toISOString()]
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

async function dispatcherToken() {
  const d = await seedTech({ role: 'dispatcher', name: 'Dispatcher' });
  return { dispatcher: d, token: await seedToken(d.id) };
}

describe('POST /api/dispatch/technicians', () => {
  it('creates technician and returns it', async () => {
    const { token } = await dispatcherToken();
    const res = await request(app)
      .post('/api/dispatch/technicians')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bob', role: 'technician' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('Bob');
    expect(res.body.role).toBe('technician');
    expect(res.body.isActive).toBe(true);
    expect(res.body.createdAt).toBeDefined();
  });

  it('returns 400 for invalid role', async () => {
    const { token } = await dispatcherToken();
    const res = await request(app)
      .post('/api/dispatch/technicians')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bob', role: 'superadmin' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/dispatch/technicians', () => {
  it('returns only active technicians by default', async () => {
    const { token } = await dispatcherToken();
    await seedTech({ name: 'Active1' });
    await seedTech({ name: 'Inactive1', isActive: false });

    const res = await request(app)
      .get('/api/dispatch/technicians')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const names = res.body.map((t) => t.name);
    expect(names).toContain('Active1');
    expect(names).toContain('Dispatcher');
    expect(names).not.toContain('Inactive1');
  });

  it('returns all technicians when includeInactive=true', async () => {
    const { token } = await dispatcherToken();
    await seedTech({ name: 'Active1' });
    await seedTech({ name: 'Inactive1', isActive: false });

    const res = await request(app)
      .get('/api/dispatch/technicians?includeInactive=true')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const names = res.body.map((t) => t.name);
    expect(names).toContain('Inactive1');
  });
});

describe('PATCH /api/dispatch/technicians/:id/deactivate', () => {
  it('sets is_active to false and returns orphanedVisitIds', async () => {
    const { token } = await dispatcherToken();
    const tech = await seedTech({ name: 'TechToDeactivate' });

    const res = await request(app)
      .patch(`/api/dispatch/technicians/${tech.id}/deactivate`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
    expect(res.body.orphanedVisitIds).toEqual([]);

    const row = await pool.query('SELECT is_active FROM technicians WHERE id = $1', [tech.id]);
    expect(row.rows[0].is_active).toBe(false);
  });
});

describe('PATCH /api/dispatch/technicians/:id/reactivate', () => {
  it('sets is_active to true', async () => {
    const { token } = await dispatcherToken();
    const tech = await seedTech({ name: 'InactiveTech', isActive: false });

    const res = await request(app)
      .patch(`/api/dispatch/technicians/${tech.id}/reactivate`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(true);

    const row = await pool.query('SELECT is_active FROM technicians WHERE id = $1', [tech.id]);
    expect(row.rows[0].is_active).toBe(true);
  });
});
