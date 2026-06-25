const { pool, truncateTables } = require('./helpers/db');
const { extractCallsFromPDF } = require('../src/services/ai');
const { normalizeStreet, findNearMatch, findOrCreateAddress } = require('../src/helpers/address');
const { createVisitWithSystems } = require('../src/helpers/visit');

beforeEach(truncateTables);
afterAll(() => pool.end());

// ── ai.js ────────────────────────────────────────────────────────────────────
describe('extractCallsFromPDF', () => {
  it('returns 2 calls regardless of buffer content', async () => {
    const calls = await extractCallsFromPDF(Buffer.from('anything'));
    expect(calls).toHaveLength(2);
    expect(calls[0].orderNumber).toBe('ORD-001');
    expect(calls[1].orderNumber).toBe('ORD-002');
  });

  it('each call has all required fields', async () => {
    const calls = await extractCallsFromPDF(Buffer.from(''));
    for (const call of calls) {
      expect(call).toHaveProperty('orderNumber');
      expect(call).toHaveProperty('address');
      expect(call).toHaveProperty('city');
      expect(call).toHaveProperty('state');
      expect(call).toHaveProperty('zip');
      expect(call).toHaveProperty('subdivision');
      expect(call).toHaveProperty('builder');
      expect(call).toHaveProperty('scheduledTime');
      expect(call).toHaveProperty('workType');
      expect(call).toHaveProperty('systemCount');
      expect(call).toHaveProperty('notes');
    }
  });
});

// ── address.js ───────────────────────────────────────────────────────────────
describe('normalizeStreet', () => {
  it('uppercases and trims', () => {
    expect(normalizeStreet('  123 maple st  ')).toBe('123 MAPLE ST');
  });

  it('is idempotent on already-normalized input', () => {
    expect(normalizeStreet('456 OAK AVE')).toBe('456 OAK AVE');
  });
});

describe('findNearMatch', () => {
  it('returns null when no addresses exist', async () => {
    const match = await findNearMatch(pool, '123 MAPLE ST', '77001');
    expect(match).toBeNull();
  });

  it('returns existing row when first 6 chars and zip match but street differs', async () => {
    await pool.query(
      `INSERT INTO addresses (id, street, zip) VALUES (gen_random_uuid()::text, '123 MAPLE STREET', '77001')`
    );
    const match = await findNearMatch(pool, '123 MAPLE ST', '77001');
    expect(match).not.toBeNull();
    expect(match.street).toBe('123 MAPLE STREET');
  });

  it('returns null when zip differs even with matching prefix', async () => {
    await pool.query(
      `INSERT INTO addresses (id, street, zip) VALUES (gen_random_uuid()::text, '123 MAPLE STREET', '77002')`
    );
    const match = await findNearMatch(pool, '123 MAPLE ST', '77001');
    expect(match).toBeNull();
  });

  it('returns null for an exact street match (same street is not a near-match)', async () => {
    await pool.query(
      `INSERT INTO addresses (id, street, zip) VALUES (gen_random_uuid()::text, '123 MAPLE ST', '77001')`
    );
    const match = await findNearMatch(pool, '123 MAPLE ST', '77001');
    expect(match).toBeNull();
  });
});

describe('findOrCreateAddress', () => {
  it('creates a new address and returns it', async () => {
    const result = await findOrCreateAddress(pool, {
      street: '  100 pine ln  ',
      city: 'Houston',
      state: 'TX',
      zip: '77010',
      subdivision: 'Pine Park',
      builder: 'DR HORTON',
    });
    expect(result.nearMatch).toBeNull();
    expect(result.address).not.toBeNull();
    expect(result.address.street).toBe('100 PINE LN');
    expect(result.address.city).toBe('Houston');
  });

  it('returns existing address on exact match without inserting', async () => {
    await findOrCreateAddress(pool, { street: '200 ELM ST', zip: '77011' });
    const result = await findOrCreateAddress(pool, { street: '  200 elm st  ', zip: '77011' });
    expect(result.address.street).toBe('200 ELM ST');
    const count = await pool.query("SELECT COUNT(*) FROM addresses WHERE street = '200 ELM ST'");
    expect(parseInt(count.rows[0].count)).toBe(1);
  });

  it('returns nearMatch instead of address when near-match exists', async () => {
    await pool.query(
      `INSERT INTO addresses (id, street, zip) VALUES (gen_random_uuid()::text, '300 OAK AVENUE', '77012')`
    );
    const result = await findOrCreateAddress(pool, { street: '300 OAK AVE', zip: '77012' });
    expect(result.address).toBeNull();
    expect(result.nearMatch).not.toBeNull();
    expect(result.nearMatch.street).toBe('300 OAK AVENUE');
  });
});

// ── visit.js ─────────────────────────────────────────────────────────────────
describe('createVisitWithSystems', () => {
  it('creates a visit with status pending_review and one system row', async () => {
    const addrResult = await pool.query(
      `INSERT INTO addresses (id, street) VALUES (gen_random_uuid()::text, '999 TEST ST') RETURNING id`
    );
    const addressId = addrResult.rows[0].id;

    const { visitId } = await createVisitWithSystems(pool, {
      addressId,
      batchId: null,
      orderNumber: 'ORD-X',
      scheduledTime: '2026-06-21T09:00:00Z',
      workType: 'AC',
      systemCount: 1,
      notes: null,
    });

    const visit = await pool.query('SELECT * FROM visits WHERE id = $1', [visitId]);
    expect(visit.rows[0].status).toBe('pending_review');
    expect(visit.rows[0].has_multiple_systems).toBe(false);
    expect(visit.rows[0].is_deferred).toBe(false);
    expect(visit.rows[0].date).toBe('2026-06-21');

    const systems = await pool.query('SELECT * FROM visit_systems WHERE visit_id = $1 ORDER BY system_number', [visitId]);
    expect(systems.rows).toHaveLength(1);
    expect(systems.rows[0].system_number).toBe(1);
    expect(systems.rows[0].indoor_model).toBeNull();
  });

  it('creates two system rows when systemCount is 2', async () => {
    const addrResult = await pool.query(
      `INSERT INTO addresses (id, street) VALUES (gen_random_uuid()::text, '888 MULTI ST') RETURNING id`
    );
    const addressId = addrResult.rows[0].id;

    const { visitId } = await createVisitWithSystems(pool, {
      addressId,
      batchId: null,
      orderNumber: 'ORD-Y',
      scheduledTime: '2026-06-21T10:00:00Z',
      workType: 'Heat',
      systemCount: 2,
      notes: null,
    });

    const visit = await pool.query('SELECT * FROM visits WHERE id = $1', [visitId]);
    expect(visit.rows[0].has_multiple_systems).toBe(true);

    const systems = await pool.query('SELECT * FROM visit_systems WHERE visit_id = $1 ORDER BY system_number', [visitId]);
    expect(systems.rows).toHaveLength(2);
    expect(systems.rows[0].system_number).toBe(1);
    expect(systems.rows[1].system_number).toBe(2);
  });
});

// ── calculateVisitPrice ───────────────────────────────────────────────────────
describe('calculateVisitPrice', () => {
  const { calculateVisitPrice } = require('../src/services/pricing');

  async function makePricingVisit({ systemCount = 1 } = {}) {
    const addrRes = await pool.query(
      `INSERT INTO addresses (id, street) VALUES (gen_random_uuid()::text, '1 PRICING ST') RETURNING id`
    );
    const techRes = await pool.query(
      `INSERT INTO technicians (id, name, role, is_active, created_at)
       VALUES (gen_random_uuid()::text, 'PT', 'technician', true, $1) RETURNING id`,
      [new Date().toISOString()]
    );
    const visitRes = await pool.query(
      `INSERT INTO visits (id, address_id, technician_id, status, has_multiple_systems, is_deferred, created_at, updated_at)
       VALUES (gen_random_uuid()::text, $1, $2, 'assigned', $3, false, $4, $4) RETURNING id`,
      [addrRes.rows[0].id, techRes.rows[0].id, systemCount > 1, new Date().toISOString()]
    );
    const visitId = visitRes.rows[0].id;
    const techId = techRes.rows[0].id;
    for (let i = 1; i <= systemCount; i++) {
      await pool.query(
        `INSERT INTO visit_systems (id, visit_id, system_number) VALUES (gen_random_uuid()::text, $1, $2)`,
        [visitId, i]
      );
    }
    return { visitId, techId };
  }

  beforeEach(async () => {
    await pool.query(`
      INSERT INTO catalog_services (service_name, default_price, is_bundle, multiplies_by_system_count)
      VALUES
        ('PT-SVC',        150, false, false),
        ('PT-SVC-MULTI',   50, false, true),
        ('Cancel',          0, false, false)
      ON CONFLICT (service_name) DO NOTHING
    `);
    await pool.query(`
      INSERT INTO catalog_items (item_name, category, default_price, tech_supplied, multiplies_by_system_count, custom_price, finish_addon_price)
      VALUES
        ('PT-ITEM-A',    'accessory', 25, false, false, false, 15),
        ('PT-ITEM-MULTI','accessory', 40, false, true,  false, null),
        ('PT-ITEM-CUST', 'fix',        0, false, false, true,  null)
      ON CONFLICT (item_name) DO NOTHING
    `);
  });

  it('returns service default_price for basic service with no items', async () => {
    const { visitId } = await makePricingVisit();
    await pool.query(
      `INSERT INTO visit_services (id, visit_id, service_name, is_finish, is_temporarily, price)
       VALUES (gen_random_uuid()::text, $1, 'PT-SVC', false, false, 150)`,
      [visitId]
    );
    const total = await calculateVisitPrice(pool, visitId);
    expect(total).toBe(150);
  });

  it('returns 0 when Cancel is the service regardless of items', async () => {
    const { visitId } = await makePricingVisit();
    await pool.query(
      `INSERT INTO visit_services (id, visit_id, service_name, is_finish, is_temporarily, price)
       VALUES (gen_random_uuid()::text, $1, 'Cancel', false, false, 0)`,
      [visitId]
    );
    await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, 'PT-ITEM-A', 'accessory', 1, 25, false)`,
      [visitId]
    );
    const total = await calculateVisitPrice(pool, visitId);
    expect(total).toBe(0);
  });

  it('multiplies service price by systemCount when multiplies_by_system_count = true', async () => {
    const { visitId } = await makePricingVisit({ systemCount: 3 });
    await pool.query(
      `INSERT INTO visit_services (id, visit_id, service_name, is_finish, is_temporarily, price)
       VALUES (gen_random_uuid()::text, $1, 'PT-SVC-MULTI', false, false, 50)`,
      [visitId]
    );
    const total = await calculateVisitPrice(pool, visitId);
    expect(total).toBe(150); // 50 * 3 systems
  });

  it('adds finish_addon_price when service is_finish = true', async () => {
    const { visitId } = await makePricingVisit();
    await pool.query(
      `INSERT INTO visit_services (id, visit_id, service_name, is_finish, is_temporarily, price)
       VALUES (gen_random_uuid()::text, $1, 'PT-SVC', true, false, 150)`,
      [visitId]
    );
    await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, 'PT-ITEM-A', 'accessory', 1, 25, false)`,
      [visitId]
    );
    const total = await calculateVisitPrice(pool, visitId);
    expect(total).toBe(190); // 150 (service) + 25 (item default) + 15 (finish addon)
  });

  it('uses visit_items.price directly for custom_price items', async () => {
    const { visitId } = await makePricingVisit();
    await pool.query(
      `INSERT INTO visit_services (id, visit_id, service_name, is_finish, is_temporarily, price)
       VALUES (gen_random_uuid()::text, $1, 'PT-SVC', false, false, 150)`,
      [visitId]
    );
    await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, 'PT-ITEM-CUST', 'fix', 1, 99, false)`,
      [visitId]
    );
    const total = await calculateVisitPrice(pool, visitId);
    expect(total).toBe(249); // 150 + 99 (custom stored price)
  });

  it('uses technician price override when available', async () => {
    const { visitId, techId } = await makePricingVisit();
    await pool.query(
      `INSERT INTO visit_services (id, visit_id, service_name, is_finish, is_temporarily, price)
       VALUES (gen_random_uuid()::text, $1, 'PT-SVC', false, false, 150)`,
      [visitId]
    );
    await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, 'PT-ITEM-A', 'accessory', 1, 25, false)`,
      [visitId]
    );
    await pool.query(
      `INSERT INTO technician_price_overrides (id, technician_id, item_name, override_price)
       VALUES (gen_random_uuid()::text, $1, 'PT-ITEM-A', 30)`,
      [techId]
    );
    const total = await calculateVisitPrice(pool, visitId);
    expect(total).toBe(180); // 150 (service) + 30 (override, not catalog 25)
  });
});
