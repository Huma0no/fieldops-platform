const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');
const { seedDispatcherWithToken, seedCompletedVisit, seedTechnicianWithToken } = require('./helpers/seeds');

beforeEach(truncateTables);
afterAll(() => pool.end());

// ── GET /api/dispatch/history ─────────────────────────────────────────────────

describe('GET /api/dispatch/history', () => {
  it('returns completed visits ordered by completedAt DESC', async () => {
    const { dispatcher, token } = await seedDispatcherWithToken();
    const { visitId, technicianId } = await seedCompletedVisit();

    const res = await request(app)
      .get('/api/dispatch/history')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const item = res.body.find((v) => v.id === visitId);
    expect(item).toBeDefined();
    expect(item.status).toBe('completed');
    expect(item.address).toBeDefined();
    expect(item.address.street).toBeDefined();
    expect(item.technicianId).toBe(technicianId);
    expect(item.completedAt).toBeDefined();
  });

  it('filters by technicianId', async () => {
    const { token } = await seedDispatcherWithToken();
    const { visitId: v1, technicianId: t1 } = await seedCompletedVisit();
    const { visitId: v2, technicianId: t2 } = await seedCompletedVisit();

    const res = await request(app)
      .get(`/api/dispatch/history?technicianId=${t1}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const ids = res.body.map((v) => v.id);
    expect(ids).toContain(v1);
    expect(ids).not.toContain(v2);
  });

  it('filters by addressId', async () => {
    const { token } = await seedDispatcherWithToken();
    const { visitId: v1, addressId } = await seedCompletedVisit();
    const { visitId: v2 } = await seedCompletedVisit();

    const res = await request(app)
      .get(`/api/dispatch/history?addressId=${addressId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const ids = res.body.map((v) => v.id);
    expect(ids).toContain(v1);
    expect(ids).not.toContain(v2);
  });

  it('returns 403 for technician role', async () => {
    const { tech, token } = await seedTechnicianWithToken();

    const res = await request(app)
      .get('/api/dispatch/history')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});

// ── GET /api/dispatch/history/address/:addressId ──────────────────────────────

describe('GET /api/dispatch/history/address/:addressId', () => {
  it('returns all visits for the address in chronological order', async () => {
    const { token } = await seedDispatcherWithToken();
    const { visitId, addressId } = await seedCompletedVisit();

    const res = await request(app)
      .get(`/api/dispatch/history/address/${addressId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const item = res.body.find((v) => v.id === visitId);
    expect(item).toBeDefined();
    expect(item.technicianName).toBeDefined();
    expect(item.createdAt).toBeDefined();
  });

  it('returns empty array for address with no visits', async () => {
    const { token } = await seedDispatcherWithToken();
    const addrRes = await pool.query(
      `INSERT INTO addresses (id, street, city) VALUES (gen_random_uuid()::text, '999 EMPTY ST', 'Houston') RETURNING id`
    );
    const addressId = addrRes.rows[0].id;

    const res = await request(app)
      .get(`/api/dispatch/history/address/${addressId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ── PATCH /api/dispatch/visits/:id ───────────────────────────────────────────

describe('PATCH /api/dispatch/visits/:id', () => {
  it('updates notes and creates an edit_log row', async () => {
    const { token } = await seedDispatcherWithToken();
    const { visitId } = await seedCompletedVisit();

    const res = await request(app)
      .patch(`/api/dispatch/visits/${visitId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'updated notes' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(visitId);

    const log = await pool.query(
      `SELECT * FROM edit_log WHERE visit_id = $1`,
      [visitId]
    );
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0].summary).toContain('notes');
    expect(log.rows[0].source).toBe('dispatch_direct');
  });

  it('only updates provided fields — other fields unchanged', async () => {
    const { token } = await seedDispatcherWithToken();
    const { visitId } = await seedCompletedVisit();

    await pool.query(`UPDATE visits SET order_number = 'ORD-123' WHERE id = $1`, [visitId]);

    await request(app)
      .patch(`/api/dispatch/visits/${visitId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'only notes' });

    const row = await pool.query(`SELECT order_number, notes FROM visits WHERE id = $1`, [visitId]);
    expect(row.rows[0].order_number).toBe('ORD-123');
    expect(row.rows[0].notes).toBe('only notes');
  });

  it('returns 400 if technicianId is invalid', async () => {
    const { token } = await seedDispatcherWithToken();
    const { visitId } = await seedCompletedVisit();

    const res = await request(app)
      .patch(`/api/dispatch/visits/${visitId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ technicianId: 'nonexistent-id' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Technician');
  });

  it('returns 404 for unknown visit', async () => {
    const { token } = await seedDispatcherWithToken();

    const res = await request(app)
      .patch(`/api/dispatch/visits/bad-id`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'test' });

    expect(res.status).toBe(404);
  });

  it('returns 403 for technician role', async () => {
    const { tech, token } = await seedTechnicianWithToken();
    const { visitId } = await seedCompletedVisit();

    const res = await request(app)
      .patch(`/api/dispatch/visits/${visitId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'test' });

    expect(res.status).toBe(403);
  });
});

// ── GET /api/dispatch/visits/:id/edit-log ─────────────────────────────────────

describe('GET /api/dispatch/visits/:id/edit-log', () => {
  it('returns edit_log entries ordered by changedAt ASC', async () => {
    const { token } = await seedDispatcherWithToken();
    const { visitId } = await seedCompletedVisit();

    // Create two log entries
    await request(app)
      .patch(`/api/dispatch/visits/${visitId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'first edit' });

    await request(app)
      .patch(`/api/dispatch/visits/${visitId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ orderNumber: 'ORD-999' });

    const res = await request(app)
      .get(`/api/dispatch/visits/${visitId}/edit-log`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    const entry = res.body[0];
    expect(entry.id).toBeDefined();
    expect(entry.changedAt).toBeDefined();
    expect(entry.summary).toBeDefined();
    expect(entry.source).toBe('dispatch_direct');
  });

  it('returns empty array for visit with no edits', async () => {
    const { token } = await seedDispatcherWithToken();
    const { visitId } = await seedCompletedVisit();

    const res = await request(app)
      .get(`/api/dispatch/visits/${visitId}/edit-log`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
