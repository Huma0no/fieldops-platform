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

// ── PATCH /api/visits/:id/systems/:systemNumber ───────────────────────────────
describe('PATCH /api/visits/:id/systems/:systemNumber', () => {
  it('updates indoorModel and returns merged system state', async () => {
    const { visitId, token } = await seedAssignedVisit();
    const res = await request(app)
      .patch(`/api/visits/${visitId}/systems/1`)
      .set('Authorization', `Bearer ${token}`)
      .send({ indoorModel: 'AH1234' });
    expect(res.status).toBe(200);
    expect(res.body.systemNumber).toBe(1);
    expect(res.body.indoorModel).toBe('AH1234');
    const row = await pool.query(
      `SELECT indoor_model FROM visit_systems WHERE visit_id = $1 AND system_number = 1`,
      [visitId]
    );
    expect(row.rows[0].indoor_model).toBe('AH1234');
  });

  it('pulls refrigerant from catalog_equipment when outdoorModel is provided', async () => {
    const { visitId, token } = await seedAssignedVisit();
    await pool.query(`
      INSERT INTO catalog_equipment (model, unit_type, brand, refrigerant)
      VALUES ('TEST-CONDENSER', 'outdoor', 'TEST', 'R-410A')
      ON CONFLICT (model) DO NOTHING
    `);
    const res = await request(app)
      .patch(`/api/visits/${visitId}/systems/1`)
      .set('Authorization', `Bearer ${token}`)
      .send({ outdoorModel: 'TEST-CONDENSER' });
    expect(res.status).toBe(200);
    expect(res.body.outdoorModel).toBe('TEST-CONDENSER');
    expect(res.body.refrigerant).toBe('R-410A');
  });

  it('returns 404 for systemNumber that does not exist on this visit', async () => {
    const { visitId, token } = await seedAssignedVisit();
    const res = await request(app)
      .patch(`/api/visits/${visitId}/systems/99`)
      .set('Authorization', `Bearer ${token}`)
      .send({ indoorModel: 'X' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('System not found');
  });
});

// ── PATCH /api/visits/:id/notes ───────────────────────────────────────────────
describe('PATCH /api/visits/:id/notes', () => {
  it('updates notes and returns id + notes', async () => {
    const { visitId, token } = await seedAssignedVisit();
    const res = await request(app)
      .patch(`/api/visits/${visitId}/notes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'Check both systems carefully.' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(visitId);
    expect(res.body.notes).toBe('Check both systems carefully.');
    const row = await pool.query(`SELECT notes FROM visits WHERE id = $1`, [visitId]);
    expect(row.rows[0].notes).toBe('Check both systems carefully.');
  });

  it('returns 403 when token belongs to a different technician', async () => {
    const { visitId } = await seedAssignedVisit();
    const { token: otherToken } = await seedTechnicianWithToken({ name: 'Other-Tech' });
    const res = await request(app)
      .patch(`/api/visits/${visitId}/notes`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ notes: 'Unauthorized' });
    expect(res.status).toBe(403);
  });
});

// ── PUT /api/visits/:id/weigh-in/:systemNumber ────────────────────────────────
describe('PUT /api/visits/:id/weigh-in/:systemNumber', () => {
  beforeEach(async () => {
    await pool.query(`
      INSERT INTO catalog_lineset_configs (config_key, reference_length_ft, adjust_rate_oz_per_ft)
      VALUES ('STANDARD-25', 25, 0.5)
      ON CONFLICT (config_key) DO NOTHING
    `);
    await pool.query(`
      INSERT INTO catalog_equipment (model, unit_type, brand, factory_charge_oz, revised_charge_oz)
      VALUES ('TEST-COND-WI', 'outdoor', 'TEST', 80, 70)
      ON CONFLICT (model) DO NOTHING
    `);
  });

  const body = {
    linesetLength: 35,
    factoryLineConfig: 'STANDARD-25',
    factoryChargeUsed: 'factory',
    adjustedOz: 82,
    fanSpeedCfm: 1200,
    liquidLineTemp: 90,
    suctionLineTemp: 55,
    condenserSatTemp: 105,
    subcoolingValue: 18,
  };

  it('stores weigh-in against address_id and returns all calculated fields', async () => {
    const { visitId, addressId, token } = await seedAssignedVisit();
    await pool.query(
      `UPDATE visit_systems SET outdoor_model = 'TEST-COND-WI' WHERE visit_id = $1 AND system_number = 1`,
      [visitId]
    );
    const res = await request(app)
      .put(`/api/visits/${visitId}/weigh-in/1`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.addressId).toBe(addressId);
    expect(res.body.systemNumber).toBe(1);
    // approxAdjustOz = (35 - 25) * 0.5 = 5.0
    expect(res.body.approxAdjustOz).toBeCloseTo(5.0);
    // oemSubcoolingGoal hardcoded to 10
    expect(res.body.oemSubcoolingGoal).toBe(10);
    // subcoolingDeviation = 18 - 10 = 8
    expect(res.body.subcoolingDeviation).toBeCloseTo(8);
    expect(res.body.factoryChargeOz).toBe(80); // factory, not revised
    const row = await pool.query(
      `SELECT * FROM weigh_in_data WHERE address_id = $1 AND system_number = 1`,
      [addressId]
    );
    expect(row.rows).toHaveLength(1);
  });

  it('upserts on second call — only one row per (address_id, system_number)', async () => {
    const { visitId, addressId, token } = await seedAssignedVisit();
    await pool.query(
      `UPDATE visit_systems SET outdoor_model = 'TEST-COND-WI' WHERE visit_id = $1 AND system_number = 1`,
      [visitId]
    );
    await request(app)
      .put(`/api/visits/${visitId}/weigh-in/1`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    const secondBody = { ...body, subcoolingValue: 12 };
    const res = await request(app)
      .put(`/api/visits/${visitId}/weigh-in/1`)
      .set('Authorization', `Bearer ${token}`)
      .send(secondBody);
    expect(res.status).toBe(200);
    expect(res.body.subcoolingDeviation).toBeCloseTo(2); // 12 - 10
    const rows = await pool.query(
      `SELECT * FROM weigh_in_data WHERE address_id = $1 AND system_number = 1`,
      [addressId]
    );
    expect(rows.rows).toHaveLength(1);
  });

  it('uses revised_charge_oz when factoryChargeUsed is "revised"', async () => {
    const { visitId, token } = await seedAssignedVisit();
    await pool.query(
      `UPDATE visit_systems SET outdoor_model = 'TEST-COND-WI' WHERE visit_id = $1 AND system_number = 1`,
      [visitId]
    );
    const revisedBody = { ...body, factoryChargeUsed: 'revised' };
    const res = await request(app)
      .put(`/api/visits/${visitId}/weigh-in/1`)
      .set('Authorization', `Bearer ${token}`)
      .send(revisedBody);
    expect(res.status).toBe(200);
    expect(res.body.factoryChargeOz).toBe(70); // revised_charge_oz
  });

  it('returns 400 for unknown linesetConfig', async () => {
    const { visitId, token } = await seedAssignedVisit();
    const res = await request(app)
      .put(`/api/visits/${visitId}/weigh-in/1`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ...body, factoryLineConfig: 'NO-SUCH-CONFIG' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Lineset config not found');
  });
});
