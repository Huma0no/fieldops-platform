const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');
const { seedDispatcherWithToken, seedTechnicianWithToken } = require('./helpers/seeds');

beforeEach(truncateTables);
afterAll(() => pool.end());

function uniqueCatalogName(prefix) {
  return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

async function insertCatalogItem(itemName, category, defaultPrice = 50) {
  await pool.query(
    `INSERT INTO catalog_items (item_name, category, default_price, tech_supplied)
     VALUES ($1, $2, $3, true)`,
    [itemName, category, defaultPrice]
  );
}

// ── POST /api/dispatch/parse-pdf ─────────────────────────────────────────────
describe('POST /api/dispatch/parse-pdf', () => {
  it('returns 403 for technician role', async () => {
    const { pool: p } = require('./helpers/db');
    const crypto = require('crypto');
    const tech = await p.query(
      `INSERT INTO technicians (id, name, role, is_active, created_at)
       VALUES (gen_random_uuid()::text, 'T', 'technician', true, $1) RETURNING id`,
      [new Date().toISOString()]
    );
    const token = crypto.randomBytes(32).toString('hex');
    await p.query('INSERT INTO device_tokens (token, technician_id, created_at) VALUES ($1, $2, $3)',
      [token, tech.rows[0].id, new Date().toISOString()]);

    const res = await request(app)
      .post('/api/dispatch/parse-pdf')
      .set('Authorization', `Bearer ${token}`)
      .attach('pdf', Buffer.from('fake pdf'), 'test.pdf');
    expect(res.status).toBe(403);
  });

  it('creates a batch and returns batchId + 2 calls', async () => {
    const { token } = await seedDispatcherWithToken();
    const res = await request(app)
      .post('/api/dispatch/parse-pdf')
      .set('Authorization', `Bearer ${token}`)
      .attach('pdf', Buffer.from('fake pdf content'), 'upload.pdf');

    expect(res.status).toBe(200);
    expect(res.body.batchId).toBeDefined();
    expect(res.body.totalCalls).toBe(2);
    expect(res.body.calls).toHaveLength(2);
    expect(res.body.calls[0].index).toBe(1);
    expect(res.body.calls[1].index).toBe(2);

    const batch = await pool.query('SELECT * FROM pdf_batches WHERE id = $1', [res.body.batchId]);
    expect(batch.rows[0].status).toBe('in_review');
    expect(batch.rows[0].total_calls).toBe(2);
  });

  it('deletes released batches before creating a new one', async () => {
    const { token } = await seedDispatcherWithToken();
    // Seed a released batch
    await pool.query(
      `INSERT INTO pdf_batches (id, total_calls, skipped_count, status, created_at)
       VALUES (gen_random_uuid()::text, 1, 0, 'released', $1)`,
      [new Date().toISOString()]
    );

    await request(app)
      .post('/api/dispatch/parse-pdf')
      .set('Authorization', `Bearer ${token}`)
      .attach('pdf', Buffer.from('pdf'), 'upload.pdf');

    const batches = await pool.query("SELECT * FROM pdf_batches WHERE status = 'released'");
    expect(batches.rows).toHaveLength(0);
  });
});

// ── GET /api/dispatch/batch/:batchId/call/:index ─────────────────────────────
describe('GET /api/dispatch/batch/:batchId/call/:index', () => {
  async function parsePdf(token) {
    const res = await request(app)
      .post('/api/dispatch/parse-pdf')
      .set('Authorization', `Bearer ${token}`)
      .attach('pdf', Buffer.from('pdf'), 'upload.pdf');
    return res.body;
  }

  it('returns call at index 1', async () => {
    const { token } = await seedDispatcherWithToken();
    const { batchId } = await parsePdf(token);

    const res = await request(app)
      .get(`/api/dispatch/batch/${batchId}/call/1`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.index).toBe(1);
    expect(res.body.totalCalls).toBe(2);
    expect(res.body.call.orderNumber).toBe('ORD-001');
  });

  it('returns call at index 2', async () => {
    const { token } = await seedDispatcherWithToken();
    const { batchId } = await parsePdf(token);

    const res = await request(app)
      .get(`/api/dispatch/batch/${batchId}/call/2`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.call.orderNumber).toBe('ORD-002');
    expect(res.body.call.systemCount).toBe(2);
  });

  it('returns 404 for out-of-range index', async () => {
    const { token } = await seedDispatcherWithToken();
    const { batchId } = await parsePdf(token);

    const res = await request(app)
      .get(`/api/dispatch/batch/${batchId}/call/99`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown batchId', async () => {
    const { token } = await seedDispatcherWithToken();
    const res = await request(app)
      .get('/api/dispatch/batch/nonexistent-id/call/1')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

// ── POST /api/dispatch/batch/:batchId/call/:index/confirm ────────────────────
describe('POST /api/dispatch/batch/:batchId/call/:index/confirm', () => {
  async function parsePdf(token) {
    const res = await request(app)
      .post('/api/dispatch/parse-pdf')
      .set('Authorization', `Bearer ${token}`)
      .attach('pdf', Buffer.from('pdf'), 'upload.pdf');
    return res.body;
  }

  it('creates a visit and returns { created: true, visitId }', async () => {
    const { token } = await seedDispatcherWithToken();
    const { batchId } = await parsePdf(token);

    const res = await request(app)
      .post(`/api/dispatch/batch/${batchId}/call/1/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        orderNumber: 'ORD-001',
        address: '123 Maple St',
        city: 'Houston',
        state: 'TX',
        zip: '77001',
        subdivision: 'MAPLE GROVE',
        builder: 'DR HORTON',
        scheduledTime: '2026-06-21T09:00:00Z',
        workType: 'AC',
        systemCount: 1,
      });

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(true);
    expect(res.body.visitId).toBeDefined();

    const visit = await pool.query('SELECT * FROM visits WHERE id = $1', [res.body.visitId]);
    expect(visit.rows[0].status).toBe('pending_review');
    expect(visit.rows[0].batch_id).toBe(batchId);
    expect(visit.rows[0].order_number).toBe('ORD-001');

    const systems = await pool.query('SELECT * FROM visit_systems WHERE visit_id = $1', [res.body.visitId]);
    expect(systems.rows).toHaveLength(1);
  });

  it('returns comparisonRequired when near-match address exists', async () => {
    const { token } = await seedDispatcherWithToken();
    await pool.query(
      `INSERT INTO addresses (id, street, zip) VALUES (gen_random_uuid()::text, '123 MAPLE STREET', '77001')`
    );
    const { batchId } = await parsePdf(token);

    const res = await request(app)
      .post(`/api/dispatch/batch/${batchId}/call/1/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        orderNumber: 'ORD-001',
        address: '123 MAPLE ST',
        city: 'Houston',
        state: 'TX',
        zip: '77001',
        workType: 'AC',
      });

    expect(res.status).toBe(200);
    expect(res.body.comparisonRequired).toBe(true);
    expect(res.body.existingAddress.street).toBe('123 MAPLE STREET');
    expect(res.body.incomingData).toBeDefined();
  });

  it('persists thermostat and accessories as visit_items', async () => {
    const { token } = await seedDispatcherWithToken();
    const thermostat = uniqueCatalogName('PDF thermostat');
    const accessory = uniqueCatalogName('PDF accessory');
    await insertCatalogItem(thermostat, 'thermostat', 120);
    await insertCatalogItem(accessory, 'accessory', 25);
    const { batchId } = await parsePdf(token);

    const res = await request(app)
      .post(`/api/dispatch/batch/${batchId}/call/1/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        orderNumber: 'ORD-001',
        address: '50 INTAKE ST',
        city: 'Houston',
        state: 'TX',
        zip: '77001',
        workType: 'AC',
        systemCount: 1,
        preSpecifiedThermostat: thermostat,
        preSpecifiedThermostatQty: 2,
        preIdentifiedAccessories: [accessory],
      });

    expect(res.status).toBe(200);
    const items = await pool.query(
      `SELECT category, item_name, quantity FROM visit_items WHERE visit_id = $1 ORDER BY category`,
      [res.body.visitId]
    );
    expect(items.rows).toHaveLength(2);
    expect(items.rows.find(r => r.category === 'thermostat')).toMatchObject({ item_name: thermostat, quantity: 2 });
    expect(items.rows.find(r => r.category === 'accessory')).toMatchObject({ item_name: accessory, quantity: 1 });
  });

  it('rejects an unknown PDF accessory before creating a visit', async () => {
    const { token } = await seedDispatcherWithToken();
    const { batchId } = await parsePdf(token);
    const unknownAccessory = uniqueCatalogName('Unknown PDF accessory');

    const res = await request(app)
      .post(`/api/dispatch/batch/${batchId}/call/1/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        orderNumber: 'ORD-UNKNOWN-ACCESSORY', address: '51 INTAKE ST', city: 'Houston', state: 'TX', zip: '77001',
        preIdentifiedAccessories: [unknownAccessory],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain(`accessory \"${unknownAccessory}\"`);
    expect((await pool.query('SELECT id FROM visits WHERE batch_id = $1', [batchId])).rows).toHaveLength(0);
    expect((await pool.query('SELECT item_name FROM catalog_items WHERE item_name = $1', [unknownAccessory])).rows).toHaveLength(0);
  });
});

// ── POST /api/dispatch/batch/:batchId/call/:index/skip ──────────────────────
describe('POST /api/dispatch/batch/:batchId/call/:index/skip', () => {
  it('increments skipped_count and returns it', async () => {
    const { token } = await seedDispatcherWithToken();
    const parseRes = await request(app)
      .post('/api/dispatch/parse-pdf')
      .set('Authorization', `Bearer ${token}`)
      .attach('pdf', Buffer.from('pdf'), 'upload.pdf');
    const { batchId } = parseRes.body;

    const res = await request(app)
      .post(`/api/dispatch/batch/${batchId}/call/1/skip`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe(true);
    expect(res.body.skippedCount).toBe(1);

    const batch = await pool.query('SELECT skipped_count FROM pdf_batches WHERE id = $1', [batchId]);
    expect(batch.rows[0].skipped_count).toBe(1);
  });
});

// ── POST /api/dispatch/batch/:batchId/release-to-lobby ──────────────────────
describe('POST /api/dispatch/batch/:batchId/release-to-lobby', () => {
  async function setupBatchWithConfirmedCalls(token) {
    const parseRes = await request(app)
      .post('/api/dispatch/parse-pdf')
      .set('Authorization', `Bearer ${token}`)
      .attach('pdf', Buffer.from('pdf'), 'upload.pdf');
    const { batchId } = parseRes.body;

    // Confirm call 1
    await request(app)
      .post(`/api/dispatch/batch/${batchId}/call/1/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ orderNumber: 'ORD-001', address: '10 FIRST ST', city: 'Houston', state: 'TX', zip: '77001', workType: 'AC' });

    // Confirm call 2
    await request(app)
      .post(`/api/dispatch/batch/${batchId}/call/2/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ orderNumber: 'ORD-002', address: '20 SECOND ST', city: 'Houston', state: 'TX', zip: '77002', workType: 'Heat', systemCount: 2 });

    return batchId;
  }

  it('returns mismatch when not all calls are confirmed or skipped', async () => {
    const { token } = await seedDispatcherWithToken();
    const parseRes = await request(app)
      .post('/api/dispatch/parse-pdf')
      .set('Authorization', `Bearer ${token}`)
      .attach('pdf', Buffer.from('pdf'), 'upload.pdf');
    const { batchId } = parseRes.body;

    // Confirm only 1 of 2 calls
    await request(app)
      .post(`/api/dispatch/batch/${batchId}/call/1/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send({ orderNumber: 'ORD-001', address: '10 FIRST ST', city: 'Houston', state: 'TX', zip: '77001', workType: 'AC' });

    const res = await request(app)
      .post(`/api/dispatch/batch/${batchId}/release-to-lobby`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.mismatch).toBe(true);
    expect(res.body.expected).toBe(2);
    expect(res.body.actual).toBe(1);
  });

  it('releases visits to in_lobby and marks batch released', async () => {
    const { token } = await seedDispatcherWithToken();
    const batchId = await setupBatchWithConfirmedCalls(token);

    const res = await request(app)
      .post(`/api/dispatch/batch/${batchId}/release-to-lobby`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.releasedCount).toBe(2);
    expect(res.body.visitIds).toHaveLength(2);

    const batch = await pool.query('SELECT status FROM pdf_batches WHERE id = $1', [batchId]);
    expect(batch.rows[0].status).toBe('released');

    const visits = await pool.query('SELECT status FROM visits WHERE batch_id = $1', [batchId]);
    for (const v of visits.rows) expect(v.status).toBe('in_lobby');
  });
});

// ── POST /api/dispatch/visits/create-manual ──────────────────────────────────
describe('POST /api/dispatch/visits/create-manual', () => {
  it('creates a visit and a batch, returns visitId + batchId', async () => {
    const { token } = await seedDispatcherWithToken();

    const res = await request(app)
      .post('/api/dispatch/visits/create-manual')
      .set('Authorization', `Bearer ${token}`)
      .send({
        orderNumber: 'MANUAL-1',
        address: '500 MANUAL RD',
        city: 'Houston',
        state: 'TX',
        zip: '77005',
        workType: 'AC',
        systemCount: 1,
      });

    expect(res.status).toBe(200);
    expect(res.body.visitId).toBeDefined();
    expect(res.body.batchId).toBeDefined();

    const visit = await pool.query('SELECT * FROM visits WHERE id = $1', [res.body.visitId]);
    expect(visit.rows[0].status).toBe('pending_review');
    expect(visit.rows[0].batch_id).toBe(res.body.batchId);

    const batch = await pool.query('SELECT * FROM pdf_batches WHERE id = $1', [res.body.batchId]);
    expect(batch.rows[0].status).toBe('in_review');
    expect(batch.rows[0].total_calls).toBe(1);
  });

  it('returns comparisonRequired when near-match address exists', async () => {
    const { token } = await seedDispatcherWithToken();
    await pool.query(
      `INSERT INTO addresses (id, street, zip) VALUES (gen_random_uuid()::text, '500 MANUAL ROAD', '77005')`
    );

    const res = await request(app)
      .post('/api/dispatch/visits/create-manual')
      .set('Authorization', `Bearer ${token}`)
      .send({
        address: '500 MANUAL RD',
        city: 'Houston',
        state: 'TX',
        zip: '77005',
        workType: 'AC',
      });

    expect(res.status).toBe(200);
    expect(res.body.comparisonRequired).toBe(true);
    expect(res.body.existingAddress.street).toBe('500 MANUAL ROAD');
  });

  it('persists thermostat and accessories as visit_items', async () => {
    const { token } = await seedDispatcherWithToken();
    const thermostat = uniqueCatalogName('Manual thermostat');
    const accessory = uniqueCatalogName('Manual accessory');
    await insertCatalogItem(thermostat, 'thermostat', 90);
    await insertCatalogItem(accessory, 'accessory', 60);

    const res = await request(app)
      .post('/api/dispatch/visits/create-manual')
      .set('Authorization', `Bearer ${token}`)
      .send({
        orderNumber: 'MANUAL-2',
        address: '600 ITEMS RD',
        city: 'Houston',
        state: 'TX',
        zip: '77006',
        workType: 'AC',
        systems: [{ indoorModel: 'IN-1', outdoorModel: 'OUT-1' }, { indoorModel: 'IN-2', outdoorModel: 'OUT-2' }],
        thermostat,
        thermostatQty: 3,
        accessories: accessory,
      });

    expect(res.status).toBe(200);
    const items = await pool.query(
      `SELECT category, item_name, quantity FROM visit_items WHERE visit_id = $1 ORDER BY category`,
      [res.body.visitId]
    );
    expect(items.rows).toHaveLength(2);
    expect(items.rows.find(r => r.category === 'thermostat')).toMatchObject({ item_name: thermostat, quantity: 3 });
    // 2 systems → accessory quantity = 2
    expect(items.rows.find(r => r.category === 'accessory')).toMatchObject({ item_name: accessory, quantity: 2 });
    const catalogItems = await pool.query(
      'SELECT item_name, category, default_price, tech_supplied FROM catalog_items WHERE item_name = ANY($1)',
      [[thermostat, accessory]]
    );
    expect(catalogItems.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ item_name: thermostat, category: 'thermostat', default_price: 90, tech_supplied: true }),
      expect.objectContaining({ item_name: accessory, category: 'accessory', default_price: 60, tech_supplied: true }),
    ]));
  });

  it.each([
    ['unknown thermostat', 'thermostat', 'thermostat'],
    ['wrong-category thermostat', 'thermostat', 'accessory'],
    ['unknown accessory', 'accessory', 'accessory'],
    ['wrong-category accessory', 'accessory', 'thermostat'],
  ])('rejects %s without creating a visit or mutating the catalog', async (_label, field, catalogCategory) => {
    const { token } = await seedDispatcherWithToken();
    const itemName = uniqueCatalogName(_label);
    if (_label.startsWith('wrong-category')) {
      await insertCatalogItem(itemName, catalogCategory);
    }
    const visitsBefore = await pool.query('SELECT COUNT(*) FROM visits');

    const res = await request(app)
      .post('/api/dispatch/visits/create-manual')
      .set('Authorization', `Bearer ${token}`)
      .send({
        address: `700 ${itemName} RD`,
        city: 'Houston',
        state: 'TX',
        zip: '77007',
        workType: 'AC',
        systems: [{ indoorModel: 'IN-A', outdoorModel: 'OUT-A' }],
        ...(field === 'thermostat' ? { thermostat: itemName } : { accessories: itemName }),
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain(`${field} \"${itemName}\"`);
    const visitsAfter = await pool.query('SELECT COUNT(*) FROM visits');
    expect(visitsAfter.rows[0].count).toBe(visitsBefore.rows[0].count);
    if (_label.startsWith('unknown')) {
      expect((await pool.query('SELECT item_name FROM catalog_items WHERE item_name = $1', [itemName])).rows).toHaveLength(0);
    }
  });

  it('releases a valid manual Intake visit and exposes it through My Calls after assignment', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech, token: technicianToken } = await seedTechnicianWithToken({ name: uniqueCatalogName('Assigned tech') });
    const thermostat = uniqueCatalogName('Release thermostat');
    await insertCatalogItem(thermostat, 'thermostat');

    const create = await request(app)
      .post('/api/dispatch/visits/create-manual')
      .set('Authorization', `Bearer ${token}`)
      .send({ address: '800 RELEASE RD', city: 'Houston', state: 'TX', zip: '77008', workType: 'AC', thermostat });
    expect(create.status).toBe(200);

    const release = await request(app)
      .post(`/api/dispatch/batch/${create.body.batchId}/release-to-lobby`)
      .set('Authorization', `Bearer ${token}`);
    expect(release.body).toMatchObject({ releasedCount: 1, visitIds: [create.body.visitId] });

    const assign = await request(app)
      .patch(`/api/dispatch/visits/${create.body.visitId}/reassign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ technicianId: tech.id });
    expect(assign.status).toBe(200);

    const mine = await request(app)
      .get('/api/visits/mine')
      .set('Authorization', `Bearer ${technicianToken}`);
    expect(mine.status).toBe(200);
    expect(mine.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: create.body.visitId, status: 'assigned' })]));
  });
});
