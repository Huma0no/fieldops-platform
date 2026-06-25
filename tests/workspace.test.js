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

// ── POST /api/visits/:id/items ────────────────────────────────────────────────
describe('POST /api/visits/:id/items', () => {
  beforeEach(async () => {
    // Clean test catalog_item_relations to avoid accumulation across runs
    await pool.query(`
      DELETE FROM catalog_item_relations
      WHERE item_name LIKE 'TEST-%' OR related_item_name LIKE 'TEST-%'
    `);
    await pool.query(`
      INSERT INTO catalog_items
        (item_name, category, default_price, tech_supplied, multiplies_by_system_count, custom_price)
      VALUES
        ('TEST-PARENT',    'accessory', 50, false, false, false),
        ('TEST-COMPANION', 'accessory', 20, false, false, false),
        ('TEST-EXCL-A',    'accessory', 30, false, false, false),
        ('TEST-EXCL-B',    'accessory', 30, false, false, false),
        ('TEST-EXCL-COMP', 'accessory', 10, false, false, false),
        ('TEST-CUSTOM',    'fix',        0, false, false, true)
      ON CONFLICT (item_name) DO NOTHING
    `);
    await pool.query(`
      INSERT INTO catalog_item_relations (id, item_name, relation_type, related_item_name, exclusion_group_id)
      VALUES
        (gen_random_uuid()::text, 'TEST-PARENT', 'companion',       'TEST-COMPANION', null),
        (gen_random_uuid()::text, 'TEST-EXCL-A', 'exclusion_group', 'TEST-EXCL-B',    'TEST-EXG'),
        (gen_random_uuid()::text, 'TEST-EXCL-B', 'exclusion_group', 'TEST-EXCL-A',    'TEST-EXG'),
        (gen_random_uuid()::text, 'TEST-EXCL-B', 'companion',       'TEST-EXCL-COMP', null)
    `);
    await pool.query(`
      INSERT INTO catalog_services (service_name, default_price, is_bundle, multiplies_by_system_count)
      VALUES ('AC', 150, false, false)
      ON CONFLICT (service_name) DO NOTHING
    `);
  });

  it('inserts item and auto-adds companion', async () => {
    const { visitId, token } = await seedAssignedVisit();
    const res = await request(app)
      .post(`/api/visits/${visitId}/items`)
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'accessory', itemName: 'TEST-PARENT' });
    expect(res.status).toBe(200);
    expect(res.body.addedItems).toContain('TEST-PARENT');
    expect(res.body.addedItems).toContain('TEST-COMPANION');
    expect(res.body.removedItems).toHaveLength(0);
    const rows = await pool.query(
      `SELECT item_name FROM visit_items WHERE visit_id = $1 ORDER BY item_name`,
      [visitId]
    );
    expect(rows.rows.map(r => r.item_name)).toEqual(['TEST-COMPANION', 'TEST-PARENT']);
  });

  it('removes conflicting exclusion-group item (and its companion) when adding', async () => {
    const { visitId, token } = await seedAssignedVisit();
    // Pre-seed TEST-EXCL-A in the visit (simulate it was previously added)
    await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, 'TEST-EXCL-A', 'accessory', 1, 30, false)`,
      [visitId]
    );
    const res = await request(app)
      .post(`/api/visits/${visitId}/items`)
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'accessory', itemName: 'TEST-EXCL-B' });
    expect(res.status).toBe(200);
    expect(res.body.addedItems).toContain('TEST-EXCL-B');
    expect(res.body.addedItems).toContain('TEST-EXCL-COMP');
    expect(res.body.removedItems).toContain('TEST-EXCL-A');
    const rows = await pool.query(
      `SELECT item_name FROM visit_items WHERE visit_id = $1 ORDER BY item_name`,
      [visitId]
    );
    const names = rows.rows.map(r => r.item_name);
    expect(names).toContain('TEST-EXCL-B');
    expect(names).toContain('TEST-EXCL-COMP');
    expect(names).not.toContain('TEST-EXCL-A');
  });

  it('returns 400 for item not in catalog', async () => {
    const { visitId, token } = await seedAssignedVisit();
    const res = await request(app)
      .post(`/api/visits/${visitId}/items`)
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'accessory', itemName: 'NO-SUCH-ITEM' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Item not found in catalog');
  });

  it('returns 400 when custom_price item sent without price', async () => {
    const { visitId, token } = await seedAssignedVisit();
    const res = await request(app)
      .post(`/api/visits/${visitId}/items`)
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'fix', itemName: 'TEST-CUSTOM' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('price is required for this item');
  });

  it('returns 403 when token belongs to a different technician', async () => {
    const { visitId } = await seedAssignedVisit();
    const { token: otherToken } = await seedTechnicianWithToken({ name: 'Other-Tech' });
    const res = await request(app)
      .post(`/api/visits/${visitId}/items`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ category: 'accessory', itemName: 'TEST-PARENT' });
    expect(res.status).toBe(403);
  });
});

// ── DELETE /api/visits/:id/items/:itemId ──────────────────────────────────────
describe('DELETE /api/visits/:id/items/:itemId', () => {
  beforeEach(async () => {
    await pool.query(`
      DELETE FROM catalog_item_relations
      WHERE item_name LIKE 'TEST-%' OR related_item_name LIKE 'TEST-%'
    `);
    await pool.query(`
      INSERT INTO catalog_items
        (item_name, category, default_price, tech_supplied, multiplies_by_system_count, custom_price)
      VALUES
        ('TEST-PARENT',    'accessory', 50, false, false, false),
        ('TEST-COMPANION', 'accessory', 20, false, false, false)
      ON CONFLICT (item_name) DO NOTHING
    `);
    await pool.query(`
      INSERT INTO catalog_item_relations (id, item_name, relation_type, related_item_name, exclusion_group_id)
      VALUES (gen_random_uuid()::text, 'TEST-PARENT', 'companion', 'TEST-COMPANION', null)
    `);
    await pool.query(`
      INSERT INTO catalog_services (service_name, default_price, is_bundle, multiplies_by_system_count)
      VALUES ('AC', 150, false, false)
      ON CONFLICT (service_name) DO NOTHING
    `);
  });

  it('deletes item and cascades removal of its companions', async () => {
    const { visitId, token } = await seedAssignedVisit();
    // Seed parent + companion directly in visit_items
    const parentRes = await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, 'TEST-PARENT', 'accessory', 1, 50, false) RETURNING id`,
      [visitId]
    );
    const parentId = parentRes.rows[0].id;
    await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, 'TEST-COMPANION', 'accessory', 1, 20, false)`,
      [visitId]
    );
    const res = await request(app)
      .delete(`/api/visits/${visitId}/items/${parentId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.removedItems).toContain('TEST-PARENT');
    expect(res.body.removedItems).toContain('TEST-COMPANION');
    const rows = await pool.query(`SELECT * FROM visit_items WHERE visit_id = $1`, [visitId]);
    expect(rows.rows).toHaveLength(0);
  });

  it('returns 404 for unknown itemId', async () => {
    const { visitId, token } = await seedAssignedVisit();
    const res = await request(app)
      .delete(`/api/visits/${visitId}/items/no-such-id`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Item not found');
  });

  it('recalculates totalPrice after deletion', async () => {
    const { visitId, token } = await seedAssignedVisit();
    await pool.query(
      `INSERT INTO visit_services (id, visit_id, service_name, is_finish, is_temporarily, price)
       VALUES (gen_random_uuid()::text, $1, 'AC', false, false, 150)`,
      [visitId]
    );
    const itemRes = await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, 'TEST-PARENT', 'accessory', 1, 50, false) RETURNING id`,
      [visitId]
    );
    const itemId = itemRes.rows[0].id;
    const res = await request(app)
      .delete(`/api/visits/${visitId}/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.totalPrice).toBe(150); // AC service remains
  });
});
