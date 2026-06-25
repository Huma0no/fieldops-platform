const request = require('supertest');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');
const { seedTechnicianWithToken, seedDispatcherWithToken, seedInLobbyVisit, seedTech, seedToken } = require('./helpers/seeds');

beforeEach(truncateTables);
afterAll(() => pool.end());

// ── GET /api/visits/lobby ────────────────────────────────────────────────────
describe('GET /api/visits/lobby', () => {
  it('returns [] when no in_lobby visits', async () => {
    const { token } = await seedTechnicianWithToken();
    const res = await request(app).get('/api/visits/lobby').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns visit with builder tag always present', async () => {
    const { token } = await seedTechnicianWithToken();
    await seedInLobbyVisit();
    const res = await request(app).get('/api/visits/lobby').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const v = res.body[0];
    expect(v.id).toBeDefined();
    expect(v.address.street).toBeDefined();
    expect(v.hasMultipleSystems).toBe(false);
    expect(v.isDeferred).toBe(false);
    expect(v.tags).toContain('builder');
    expect(v.tags).not.toContain('multiSystem');
    expect(v.tags).not.toContain('a2l');
  });

  it('includes multiSystem tag when has_multiple_systems is true', async () => {
    const { token } = await seedTechnicianWithToken();
    await seedInLobbyVisit({ systemCount: 2 });
    const res = await request(app).get('/api/visits/lobby').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body[0].hasMultipleSystems).toBe(true);
    expect(res.body[0].tags).toContain('multiSystem');
  });

  it('includes a2l tag when visit has a2l equipment', async () => {
    const { token } = await seedTechnicianWithToken();
    await seedInLobbyVisit({ withA2l: true });
    const res = await request(app).get('/api/visits/lobby').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body[0].tags).toContain('a2l');
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/visits/lobby');
    expect(res.status).toBe(401);
  });
});

// ── POST /api/visits/:id/claim ───────────────────────────────────────────────
describe('POST /api/visits/:id/claim', () => {
  it('assigns visit to technician and returns it', async () => {
    const { tech, token } = await seedTechnicianWithToken();
    const { visitId } = await seedInLobbyVisit();

    const res = await request(app)
      .post(`/api/visits/${visitId}/claim`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(visitId);
    expect(res.body.technicianId).toBe(tech.id);
    expect(res.body.status).toBe('assigned');
    expect(res.body.address.street).toBeDefined();
    expect(res.body.tags).toContain('builder');

    const row = await pool.query('SELECT status, technician_id FROM visits WHERE id = $1', [visitId]);
    expect(row.rows[0].status).toBe('assigned');
    expect(row.rows[0].technician_id).toBe(tech.id);
  });

  it('returns 404 for unknown visit id', async () => {
    const { token } = await seedTechnicianWithToken();
    const res = await request(app)
      .post('/api/visits/nonexistent-id/claim')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Visit not found');
  });

  it('returns 409 when visit already claimed', async () => {
    const { token: tokenA } = await seedTechnicianWithToken({ name: 'Tech-A' });
    const { token: tokenB } = await seedTechnicianWithToken({ name: 'Tech-B' });
    const { visitId } = await seedInLobbyVisit();

    await request(app).post(`/api/visits/${visitId}/claim`).set('Authorization', `Bearer ${tokenA}`);

    const res = await request(app)
      .post(`/api/visits/${visitId}/claim`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('This visit was just claimed by another technician');
  });

  it('returns 403 for dispatcher role', async () => {
    const { token } = await seedDispatcherWithToken();
    const { visitId } = await seedInLobbyVisit();
    const res = await request(app)
      .post(`/api/visits/${visitId}/claim`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

// ── GET /api/visits/mine ─────────────────────────────────────────────────────
describe('GET /api/visits/mine', () => {
  it('returns assigned visits for the authenticated technician', async () => {
    const { tech, token } = await seedTechnicianWithToken();
    const { visitId } = await seedInLobbyVisit();
    await request(app).post(`/api/visits/${visitId}/claim`).set('Authorization', `Bearer ${token}`);

    const res = await request(app).get('/api/visits/mine').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const v = res.body[0];
    expect(v.id).toBe(visitId);
    expect(v.technicianId).toBe(tech.id);
    expect(v.status).toBe('assigned');
    expect(v.address.street).toBeDefined();
    expect(v.tags).toContain('builder');
  });

  it('excludes visits assigned to other technicians', async () => {
    const { token: tokenA } = await seedTechnicianWithToken({ name: 'Tech-A' });
    const { token: tokenB } = await seedTechnicianWithToken({ name: 'Tech-B' });
    const { visitId } = await seedInLobbyVisit();
    await request(app).post(`/api/visits/${visitId}/claim`).set('Authorization', `Bearer ${tokenA}`);

    const res = await request(app).get('/api/visits/mine').set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('returns deferred visits before non-deferred visits', async () => {
    const { token } = await seedTechnicianWithToken();
    const { visitId: idA } = await seedInLobbyVisit();
    const { visitId: idB } = await seedInLobbyVisit();
    await request(app).post(`/api/visits/${idA}/claim`).set('Authorization', `Bearer ${token}`);
    await request(app).post(`/api/visits/${idB}/claim`).set('Authorization', `Bearer ${token}`);
    await pool.query('UPDATE visits SET is_deferred = true WHERE id = $1', [idB]);

    const res = await request(app).get('/api/visits/mine').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body[0].id).toBe(idB);
    expect(res.body[0].isDeferred).toBe(true);
    expect(res.body[1].id).toBe(idA);
  });

  it('returns 403 for dispatcher role', async () => {
    const { token } = await seedDispatcherWithToken();
    const res = await request(app).get('/api/visits/mine').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
