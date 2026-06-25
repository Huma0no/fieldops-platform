const request = require('supertest');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');
const {
  seedTechnicianWithToken,
  seedAssignedVisit,
} = require('./helpers/seeds');

beforeEach(truncateTables);
afterAll(() => pool.end());

// ── PATCH /api/visits/:id/services ───────────────────────────────────────────
describe('PATCH /api/visits/:id/services', () => {
  beforeEach(async () => {
    await pool.query(`
      INSERT INTO catalog_services (service_name, default_price, is_bundle, multiplies_by_system_count)
      VALUES
        ('AC',     150, false, false),
        ('Heat',   100, false, false),
        ('Cancel',   0, false, false)
      ON CONFLICT (service_name) DO NOTHING
    `);
  });

  it('sets service and returns totalPrice from catalog', async () => {
    const { visitId, token } = await seedAssignedVisit();
    const res = await request(app)
      .patch(`/api/visits/${visitId}/services`)
      .set('Authorization', `Bearer ${token}`)
      .send({ serviceName: 'AC' });
    expect(res.status).toBe(200);
    expect(res.body.serviceName).toBe('AC');
    expect(res.body.isFinish).toBe(false);
    expect(res.body.isTemporarily).toBe(false);
    expect(res.body.totalPrice).toBe(150);
  });

  it('overwrites existing service — only one row in visit_services after second call', async () => {
    const { visitId, token } = await seedAssignedVisit();
    await request(app)
      .patch(`/api/visits/${visitId}/services`)
      .set('Authorization', `Bearer ${token}`)
      .send({ serviceName: 'AC' });
    const res = await request(app)
      .patch(`/api/visits/${visitId}/services`)
      .set('Authorization', `Bearer ${token}`)
      .send({ serviceName: 'Heat' });
    expect(res.status).toBe(200);
    expect(res.body.serviceName).toBe('Heat');
    const rows = await pool.query('SELECT * FROM visit_services WHERE visit_id = $1', [visitId]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].service_name).toBe('Heat');
  });

  it('Cancel with items returns requiresConfirmation without modifying DB', async () => {
    const { visitId, token } = await seedAssignedVisit();
    await pool.query(`
      INSERT INTO catalog_items (item_name, category, default_price, tech_supplied)
      VALUES ('WS-ITEM-X', 'accessory', 10, false)
      ON CONFLICT (item_name) DO NOTHING
    `);
    await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, 'WS-ITEM-X', 'accessory', 1, 10, false)`,
      [visitId]
    );
    const res = await request(app)
      .patch(`/api/visits/${visitId}/services`)
      .set('Authorization', `Bearer ${token}`)
      .send({ serviceName: 'Cancel' });
    expect(res.status).toBe(200);
    expect(res.body.requiresConfirmation).toBe(true);
    expect(res.body.itemsToRemove).toHaveLength(1);
    expect(res.body.itemsToRemove[0].itemName).toBe('WS-ITEM-X');
    const items = await pool.query('SELECT * FROM visit_items WHERE visit_id = $1', [visitId]);
    expect(items.rows).toHaveLength(1); // unchanged
  });

  it('Cancel with confirmed:true deletes all items and sets totalPrice to 0', async () => {
    const { visitId, token } = await seedAssignedVisit();
    await pool.query(`
      INSERT INTO catalog_items (item_name, category, default_price, tech_supplied)
      VALUES ('WS-ITEM-X', 'accessory', 10, false)
      ON CONFLICT (item_name) DO NOTHING
    `);
    await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, 'WS-ITEM-X', 'accessory', 1, 10, false)`,
      [visitId]
    );
    const res = await request(app)
      .patch(`/api/visits/${visitId}/services`)
      .set('Authorization', `Bearer ${token}`)
      .send({ serviceName: 'Cancel', confirmed: true });
    expect(res.status).toBe(200);
    expect(res.body.totalPrice).toBe(0);
    const items = await pool.query('SELECT * FROM visit_items WHERE visit_id = $1', [visitId]);
    expect(items.rows).toHaveLength(0);
    const visit = await pool.query('SELECT total_price FROM visits WHERE id = $1', [visitId]);
    expect(visit.rows[0].total_price).toBe(0);
  });

  it('returns 400 for unrecognised serviceName', async () => {
    const { visitId, token } = await seedAssignedVisit();
    const res = await request(app)
      .patch(`/api/visits/${visitId}/services`)
      .set('Authorization', `Bearer ${token}`)
      .send({ serviceName: 'BOGUS' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid service name');
  });

  it('returns 403 when token belongs to a different technician', async () => {
    const { visitId } = await seedAssignedVisit();
    const { token: otherToken } = await seedTechnicianWithToken({ name: 'Other-Tech' });
    const res = await request(app)
      .patch(`/api/visits/${visitId}/services`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ serviceName: 'AC' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('This visit is not assigned to you');
  });
});
