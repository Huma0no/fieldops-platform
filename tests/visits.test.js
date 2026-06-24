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
