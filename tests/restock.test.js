const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');
const {
  seedDispatcherWithToken, seedTechnicianWithToken,
  seedCompletedVisit, seedCatalogItem,
} = require('./helpers/seeds');

beforeEach(truncateTables);
afterAll(() => pool.end());

async function seedCompletedVisitWithItem(technicianId, itemName, quantity, price) {
  const { visitId } = await seedCompletedVisit({ technicianId });
  await pool.query(
    `UPDATE visits SET completed_at = $1 WHERE id = $2`,
    [new Date().toISOString(), visitId]
  );
  await pool.query(
    `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
     VALUES (gen_random_uuid()::text, $1, $2, 'accessory', $3, $4, true)`,
    [visitId, itemName, quantity, price]
  );
  return visitId;
}

async function seedPayPeriod(weekStart, weekEnd) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO pay_periods (id, week_start, week_end, status)
     VALUES ($1, $2, $3, 'open')`,
    [id, weekStart, weekEnd]
  );
  return id;
}

// ── GET /api/dispatch/restock-report ─────────────────────────────────────────

describe('GET /api/dispatch/restock-report', () => {
  it('returns consumed totals grouped by item with technician breakdown', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const itemName = `ITEM-${crypto.randomBytes(4).toString('hex')}`;
    await seedCatalogItem(itemName);

    await seedCompletedVisitWithItem(tech.id, itemName, 4, 50);
    await seedCompletedVisitWithItem(tech.id, itemName, 2, 50);

    const res = await request(app)
      .get('/api/dispatch/restock-report')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toBeDefined();
    const entry = res.body.items.find((i) => i.itemName === itemName);
    expect(entry).toBeDefined();
    expect(entry.totalConsumed).toBe(6);
    expect(Array.isArray(entry.byTechnician)).toBe(true);
    const techEntry = entry.byTechnician.find((t) => t.technicianId === tech.id);
    expect(techEntry).toBeDefined();
    expect(techEntry.consumed).toBe(6);
    expect(techEntry.technicianName).toBe(tech.name);
  });

  it('respects dateFrom and dateTo filters', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const itemName = `ITEM-${crypto.randomBytes(4).toString('hex')}`;
    await seedCatalogItem(itemName);

    // Visit completed today — inside range
    await seedCompletedVisitWithItem(tech.id, itemName, 3, 50);

    const res = await request(app)
      .get('/api/dispatch/restock-report?dateFrom=2020-01-01&dateTo=2030-12-31')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const entry = res.body.items.find((i) => i.itemName === itemName);
    expect(entry.totalConsumed).toBe(3);
  });

  it('returns 403 for technician role', async () => {
    const { token } = await seedTechnicianWithToken();

    const res = await request(app)
      .get('/api/dispatch/restock-report')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});

// ── POST /api/dispatch/restock-report/mark-restocked ─────────────────────────

describe('POST /api/dispatch/restock-report/mark-restocked', () => {
  it('creates restock_records rows', async () => {
    const { token } = await seedDispatcherWithToken();
    const item1 = `ITEM-${crypto.randomBytes(4).toString('hex')}`;
    const item2 = `ITEM-${crypto.randomBytes(4).toString('hex')}`;
    await seedCatalogItem(item1);
    await seedCatalogItem(item2);

    const res = await request(app)
      .post('/api/dispatch/restock-report/mark-restocked')
      .set('Authorization', `Bearer ${token}`)
      .send({ periodStart: '2026-06-23', periodEnd: '2026-06-29', itemNames: [item1, item2] });

    expect(res.status).toBe(200);
    expect(res.body.restocked).toBe(2);
    expect(res.body.items).toEqual([item1, item2]);

    const rows = await pool.query(
      `SELECT * FROM restock_records WHERE item_name IN ($1, $2)`,
      [item1, item2]
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0].status).toBe('restocked');
    expect(rows.rows[0].restocked_at).toBeDefined();
  });

  it('upserts on repeat call — does not duplicate rows', async () => {
    const { token } = await seedDispatcherWithToken();
    const itemName = `ITEM-${crypto.randomBytes(4).toString('hex')}`;
    await seedCatalogItem(itemName);

    const body = { periodStart: '2026-06-23', periodEnd: '2026-06-29', itemNames: [itemName] };

    await request(app)
      .post('/api/dispatch/restock-report/mark-restocked')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

    const res = await request(app)
      .post('/api/dispatch/restock-report/mark-restocked')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

    expect(res.status).toBe(200);

    const rows = await pool.query(
      `SELECT * FROM restock_records WHERE item_name = $1 AND period_start = $2`,
      [itemName, '2026-06-23']
    );
    expect(rows.rows).toHaveLength(1);
  });

  it('returns 403 for technician role', async () => {
    const { token } = await seedTechnicianWithToken();

    const res = await request(app)
      .post('/api/dispatch/restock-report/mark-restocked')
      .set('Authorization', `Bearer ${token}`)
      .send({ periodStart: '2026-06-23', periodEnd: '2026-06-29', itemNames: [] });

    expect(res.status).toBe(403);
  });
});

// ── GET /api/dispatch/pay-periods/:id/anomalies ───────────────────────────────

describe('GET /api/dispatch/pay-periods/:id/anomalies', () => {
  it('returns items with prices outside catalog bounds', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const itemName = `ITEM-${crypto.randomBytes(4).toString('hex')}`;
    await seedCatalogItem(itemName, { techSupplied: true, expectedPriceMin: 40, expectedPriceMax: 60 });

    const periodId = await seedPayPeriod('2026-06-23', '2026-06-29');

    // Create completed visit within pay period
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    await pool.query(
      `UPDATE visits SET completed_at = '2026-06-25T10:00:00Z' WHERE id = $1`,
      [visitId]
    );
    // Price below min (40)
    await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, $2, 'accessory', 1, 20, true)`,
      [visitId, itemName]
    );

    const res = await request(app)
      .get(`/api/dispatch/pay-periods/${periodId}/anomalies`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const anomaly = res.body.find((a) => a.visitId === visitId && a.itemName === itemName);
    expect(anomaly).toBeDefined();
    expect(anomaly.price).toBe(20);
    expect(anomaly.expectedMin).toBe(40);
    expect(anomaly.expectedMax).toBe(60);
  });

  it('does not flag items within bounds', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const itemName = `ITEM-${crypto.randomBytes(4).toString('hex')}`;
    await seedCatalogItem(itemName, { techSupplied: true, expectedPriceMin: 40, expectedPriceMax: 60 });

    const periodId = await seedPayPeriod('2026-06-23', '2026-06-29');

    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    await pool.query(
      `UPDATE visits SET completed_at = '2026-06-25T10:00:00Z' WHERE id = $1`,
      [visitId]
    );
    // Price in-range (50)
    await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, $2, 'accessory', 1, 50, true)`,
      [visitId, itemName]
    );

    const res = await request(app)
      .get(`/api/dispatch/pay-periods/${periodId}/anomalies`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const anomaly = res.body.find((a) => a.visitId === visitId && a.itemName === itemName);
    expect(anomaly).toBeUndefined();
  });

  it('does not flag items with no catalog bounds', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const itemName = `ITEM-${crypto.randomBytes(4).toString('hex')}`;
    await seedCatalogItem(itemName, { techSupplied: true, expectedPriceMin: null, expectedPriceMax: null });

    const periodId = await seedPayPeriod('2026-06-23', '2026-06-29');

    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    await pool.query(
      `UPDATE visits SET completed_at = '2026-06-25T10:00:00Z' WHERE id = $1`,
      [visitId]
    );
    await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, $2, 'accessory', 1, 999, true)`,
      [visitId, itemName]
    );

    const res = await request(app)
      .get(`/api/dispatch/pay-periods/${periodId}/anomalies`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const anomaly = res.body.find((a) => a.visitId === visitId);
    expect(anomaly).toBeUndefined();
  });

  it('returns 404 for unknown pay period', async () => {
    const { token } = await seedDispatcherWithToken();

    const res = await request(app)
      .get('/api/dispatch/pay-periods/nonexistent-id/anomalies')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('returns 403 for technician role', async () => {
    const { token } = await seedTechnicianWithToken();

    const res = await request(app)
      .get('/api/dispatch/pay-periods/some-id/anomalies')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});
