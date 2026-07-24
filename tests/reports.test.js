const request = require('supertest');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');
const { seedDispatcherWithToken } = require('./helpers/seeds');

beforeEach(truncateTables);
afterAll(() => pool.end());

async function seedCompletedVisitWithItem(overrides = {}) {
  const now = new Date().toISOString();
  const completedAt = overrides.completedAt ?? '2026-07-15T10:00:00.000Z';

  const techRes = await pool.query(
    `INSERT INTO technicians (id, name, role, is_active, created_at)
     VALUES (gen_random_uuid()::text, $1, 'technician', true, $2) RETURNING id`,
    [overrides.techName ?? 'Report Tech', now]
  );
  const techId = techRes.rows[0].id;

  const addrRes = await pool.query(
    `INSERT INTO addresses (id, street, city, state, zip, subdivision, builder)
     VALUES (gen_random_uuid()::text, $1, 'Houston', 'TX', '77001', 'TEST', 'DR HORTON')
     RETURNING id`,
    [overrides.street ?? '100 REPORT RD']
  );
  const addressId = addrRes.rows[0].id;

  const visitRes = await pool.query(
    `INSERT INTO visits (id, address_id, technician_id, status, completed_at, created_at, updated_at, order_number)
     VALUES (gen_random_uuid()::text, $1, $2, 'completed', $3, $4, $4, 'RPT-001')
     RETURNING id`,
    [addressId, techId, completedAt, now]
  );
  const visitId = visitRes.rows[0].id;

  await pool.query(
    `INSERT INTO catalog_services (service_name, default_price, is_bundle, multiplies_by_system_count)
     VALUES ('AC', 150, false, false) ON CONFLICT (service_name) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO visit_services (id, visit_id, service_name, is_finish, is_temporarily, price)
     VALUES (gen_random_uuid()::text, $1, 'AC', false, false, 150)`,
    [visitId]
  );

  return { techId, addressId, visitId };
}

// ── GET /api/dispatch/reports/equipment ──────────────────────────────────────

describe('GET /api/dispatch/reports/equipment', () => {
  it('returns 400 when dateFrom or dateTo is missing', async () => {
    const { token } = await seedDispatcherWithToken();

    const res1 = await request(app)
      .get('/api/dispatch/reports/equipment?dateFrom=2026-07-01')
      .set('Authorization', `Bearer ${token}`);
    expect(res1.status).toBe(400);

    const res2 = await request(app)
      .get('/api/dispatch/reports/equipment?dateTo=2026-07-31')
      .set('Authorization', `Bearer ${token}`);
    expect(res2.status).toBe(400);
  });

  it('returns empty array when no completed visits in range', async () => {
    const { token } = await seedDispatcherWithToken();

    const res = await request(app)
      .get('/api/dispatch/reports/equipment?dateFrom=2020-01-01&dateTo=2020-01-31')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns aggregated items for completed visits in date range', async () => {
    const { token } = await seedDispatcherWithToken();
    const { visitId } = await seedCompletedVisitWithItem();

    await pool.query(
      `INSERT INTO catalog_items (item_name, category, default_price, tech_supplied)
       VALUES ('Test Filter', 'accessory', 25, false) ON CONFLICT (item_name) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, 'Test Filter', 'accessory', 2, 25, false)`,
      [visitId]
    );

    const res = await request(app)
      .get('/api/dispatch/reports/equipment?dateFrom=2026-07-01&dateTo=2026-07-31')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].itemName).toBe('Test Filter');
    expect(res.body[0].category).toBe('accessory');
    expect(res.body[0].totalQty).toBe(2);
    expect(res.body[0].byTechnician).toHaveLength(1);
    expect(res.body[0].byTechnician[0].qty).toBe(2);
    expect(res.body[0].byAddress).toHaveLength(1);
    expect(res.body[0].byAddress[0].address).toBe('100 REPORT RD');
  });

  it('excludes visits outside the date range', async () => {
    const { token } = await seedDispatcherWithToken();
    const { visitId } = await seedCompletedVisitWithItem({ completedAt: '2025-01-10T10:00:00.000Z' });

    await pool.query(
      `INSERT INTO catalog_items (item_name, category, default_price, tech_supplied)
       VALUES ('Old Filter', 'accessory', 25, false) ON CONFLICT (item_name) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, 'Old Filter', 'accessory', 1, 25, false)`,
      [visitId]
    );

    const res = await request(app)
      .get('/api/dispatch/reports/equipment?dateFrom=2026-07-01&dateTo=2026-07-31')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('filters by technicianId when provided', async () => {
    const { token } = await seedDispatcherWithToken();
    const { visitId, techId } = await seedCompletedVisitWithItem({ techName: 'Filtered Tech' });

    await pool.query(
      `INSERT INTO catalog_items (item_name, category, default_price, tech_supplied)
       VALUES ('Tech Item', 'fix', 50, false) ON CONFLICT (item_name) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, 'Tech Item', 'fix', 1, 50, false)`,
      [visitId]
    );

    // Query with the correct technicianId
    const res = await request(app)
      .get(`/api/dispatch/reports/equipment?dateFrom=2026-07-01&dateTo=2026-07-31&technicianId=${techId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);

    // Query with a different technicianId — should return nothing
    const res2 = await request(app)
      .get('/api/dispatch/reports/equipment?dateFrom=2026-07-01&dateTo=2026-07-31&technicianId=nonexistent')
      .set('Authorization', `Bearer ${token}`);
    expect(res2.status).toBe(200);
    expect(res2.body).toEqual([]);
  });

  it('returns 403 for technician role', async () => {
    const now = new Date().toISOString();
    const techRes = await pool.query(
      `INSERT INTO technicians (id, name, role, is_active, created_at)
       VALUES (gen_random_uuid()::text, 'Field Tech', 'technician', true, $1) RETURNING id`,
      [now]
    );
    const crypto = require('crypto');
    const rawToken = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO device_tokens (token, technician_id, created_at) VALUES ($1, $2, $3)`,
      [rawToken, techRes.rows[0].id, now]
    );

    const res = await request(app)
      .get('/api/dispatch/reports/equipment?dateFrom=2026-07-01&dateTo=2026-07-31')
      .set('Authorization', `Bearer ${rawToken}`);

    expect(res.status).toBe(403);
  });
});

// ── GET /api/dispatch/reports/refrigerant ────────────────────────────────────

describe('GET /api/dispatch/reports/refrigerant', () => {
  it('returns 400 when dateFrom or dateTo is missing', async () => {
    const { token } = await seedDispatcherWithToken();

    const res = await request(app)
      .get('/api/dispatch/reports/refrigerant?dateFrom=2026-07-01')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('returns empty array when no weigh_in_data for completed visits in range', async () => {
    const { token } = await seedDispatcherWithToken();

    const res = await request(app)
      .get('/api/dispatch/reports/refrigerant?dateFrom=2020-01-01&dateTo=2020-01-31')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns refrigerant rows for completed visits with weigh_in_data', async () => {
    const { token } = await seedDispatcherWithToken();
    const { addressId } = await seedCompletedVisitWithItem();

    await pool.query(
      `INSERT INTO catalog_lineset_configs (config_key, reference_length_ft, adjust_rate_oz_per_ft)
       VALUES ('STD-15', 15, 0.6) ON CONFLICT (config_key) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO weigh_in_data
         (id, address_id, system_number, lineset_length, adjusted_oz, factory_charge_oz, factory_line_config)
       VALUES (gen_random_uuid()::text, $1, 1, 25, 6.0, 40.0, 'STD-15')`,
      [addressId]
    );

    const res = await request(app)
      .get('/api/dispatch/reports/refrigerant?dateFrom=2026-07-01&dateTo=2026-07-31')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].address).toBe('100 REPORT RD');
    expect(res.body[0].systemNumber).toBe(1);
    expect(Number(res.body[0].adjustedOz)).toBe(6);
    expect(Number(res.body[0].factoryChargeUsed)).toBe(40);
    expect(res.body[0].factoryLineConfig).toBe('STD-15');
    expect(res.body[0].serviceName).toBe('AC');
  });

  it('returns 403 for technician role', async () => {
    const now = new Date().toISOString();
    const techRes = await pool.query(
      `INSERT INTO technicians (id, name, role, is_active, created_at)
       VALUES (gen_random_uuid()::text, 'Field Tech 2', 'technician', true, $1) RETURNING id`,
      [now]
    );
    const crypto = require('crypto');
    const rawToken = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO device_tokens (token, technician_id, created_at) VALUES ($1, $2, $3)`,
      [rawToken, techRes.rows[0].id, now]
    );

    const res = await request(app)
      .get('/api/dispatch/reports/refrigerant?dateFrom=2026-07-01&dateTo=2026-07-31')
      .set('Authorization', `Bearer ${rawToken}`);

    expect(res.status).toBe(403);
  });
});
