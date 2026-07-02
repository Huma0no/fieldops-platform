const request = require('supertest');
const crypto  = require('crypto');
const app     = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');
const { seedDispatcherWithToken, seedTechnicianWithToken } = require('./helpers/seeds');

beforeEach(truncateTables);
afterAll(() => pool.end());

// ── helpers ───────────────────────────────────────────────────────────────────

async function seedEquipmentRow (model = `MDL-${crypto.randomBytes(4).toString('hex')}`) {
  await pool.query(
    `INSERT INTO catalog_equipment (model, unit_type, brand, pesp, factory_charge_oz, revised_charge_oz)
     VALUES ($1, 'condenser', 'TestBrand', 10.5, 120, 118)
     ON CONFLICT (model) DO NOTHING`,
    [model]
  );
  return model;
}

async function seedItemRow (itemName = `ITEM-${crypto.randomBytes(4).toString('hex')}`) {
  await pool.query(
    `INSERT INTO catalog_items (item_name, category, default_price, tech_supplied)
     VALUES ($1, 'accessory', 75, false)
     ON CONFLICT (item_name) DO NOTHING`,
    [itemName]
  );
  return itemName;
}

async function seedServiceRow (serviceName = `SVC-${crypto.randomBytes(4).toString('hex')}`) {
  await pool.query(
    `INSERT INTO catalog_services (service_name, default_price)
     VALUES ($1, 250)
     ON CONFLICT (service_name) DO NOTHING`,
    [serviceName]
  );
  return serviceName;
}

// ── GET /api/catalog/equipment ────────────────────────────────────────────────

describe('GET /api/catalog/equipment', () => {
  it('returns array for technician', async () => {
    const { token } = await seedTechnicianWithToken();
    const model = await seedEquipmentRow();

    const res = await request(app)
      .get('/api/catalog/equipment')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.find(r => r.model === model)).toBeDefined();
  });

  it('returns array for dispatcher', async () => {
    const { token } = await seedDispatcherWithToken();

    const res = await request(app)
      .get('/api/catalog/equipment')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns 401 with no token', async () => {
    const res = await request(app).get('/api/catalog/equipment');
    expect(res.status).toBe(401);
  });
});

// ── GET /api/catalog/lineset-configs ─────────────────────────────────────────

describe('GET /api/catalog/lineset-configs', () => {
  it('returns array for technician', async () => {
    const { token } = await seedTechnicianWithToken();

    const res = await request(app)
      .get('/api/catalog/lineset-configs')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns 401 with no token', async () => {
    const res = await request(app).get('/api/catalog/lineset-configs');
    expect(res.status).toBe(401);
  });
});

// ── GET /api/catalog/items ────────────────────────────────────────────────────

describe('GET /api/catalog/items', () => {
  it('returns seeded item for technician', async () => {
    const { token } = await seedTechnicianWithToken();
    const itemName = await seedItemRow();

    const res = await request(app)
      .get('/api/catalog/items')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.find(r => r.item_name === itemName)).toBeDefined();
  });

  it('returns 401 with no token', async () => {
    const res = await request(app).get('/api/catalog/items');
    expect(res.status).toBe(401);
  });
});

// ── GET /api/catalog/item-relations ──────────────────────────────────────────

describe('GET /api/catalog/item-relations', () => {
  it('returns array for dispatcher', async () => {
    const { token } = await seedDispatcherWithToken();

    const res = await request(app)
      .get('/api/catalog/item-relations')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns 401 with no token', async () => {
    const res = await request(app).get('/api/catalog/item-relations');
    expect(res.status).toBe(401);
  });
});

// ── GET /api/catalog/services ─────────────────────────────────────────────────

describe('GET /api/catalog/services', () => {
  it('returns seeded service for technician', async () => {
    const { token } = await seedTechnicianWithToken();
    const serviceName = await seedServiceRow();

    const res = await request(app)
      .get('/api/catalog/services')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.find(r => r.service_name === serviceName)).toBeDefined();
  });

  it('returns 401 with no token', async () => {
    const res = await request(app).get('/api/catalog/services');
    expect(res.status).toBe(401);
  });
});

// ── POST /api/dispatch/catalog/equipment ─────────────────────────────────────

describe('POST /api/dispatch/catalog/equipment', () => {
  it('creates a new equipment row and returns 201 (dispatcher)', async () => {
    const { token } = await seedDispatcherWithToken();
    const model = `MDL-${crypto.randomBytes(4).toString('hex')}`;

    const res = await request(app)
      .post('/api/dispatch/catalog/equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({ model, unit_type: 'condenser', brand: 'Carrier', refrigerant: 'R-410A', pesp: 11.5 });

    expect(res.status).toBe(201);
    expect(res.body.model).toBe(model);
    expect(res.body.unit_type).toBe('condenser');
    expect(res.body.brand).toBe('Carrier');
    expect(res.body.pesp).toBe(11.5);
  });

  it('returns 409 if model already exists', async () => {
    const { token } = await seedDispatcherWithToken();
    const model = await seedEquipmentRow();

    const res = await request(app)
      .post('/api/dispatch/catalog/equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({ model, unit_type: 'condenser', brand: 'Brand' });

    expect(res.status).toBe(409);
  });

  it('returns 400 if model is missing', async () => {
    const { token } = await seedDispatcherWithToken();

    const res = await request(app)
      .post('/api/dispatch/catalog/equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({ unit_type: 'condenser', brand: 'Brand' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/model/i);
  });

  it('returns 400 if unit_type is missing', async () => {
    const { token } = await seedDispatcherWithToken();

    const res = await request(app)
      .post('/api/dispatch/catalog/equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({ model: 'X-001', brand: 'Brand' });

    expect(res.status).toBe(400);
  });

  it('returns 400 if brand is missing', async () => {
    const { token } = await seedDispatcherWithToken();

    const res = await request(app)
      .post('/api/dispatch/catalog/equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({ model: 'X-001', unit_type: 'condenser' });

    expect(res.status).toBe(400);
  });

  it('returns 403 for technician role', async () => {
    const { token } = await seedTechnicianWithToken();

    const res = await request(app)
      .post('/api/dispatch/catalog/equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({ model: 'X-001', unit_type: 'condenser', brand: 'Brand' });

    expect(res.status).toBe(403);
  });
});

// ── POST /api/dispatch/catalog/items ─────────────────────────────────────────

describe('POST /api/dispatch/catalog/items', () => {
  it('creates a new catalog item and returns 201 (dispatcher)', async () => {
    const { token } = await seedDispatcherWithToken();
    const itemName = `ITEM-${crypto.randomBytes(4).toString('hex')}`;

    const res = await request(app)
      .post('/api/dispatch/catalog/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ item_name: itemName, category: 'accessory', tech_supplied: false, default_price: 55 });

    expect(res.status).toBe(201);
    expect(res.body.item_name).toBe(itemName);
    expect(res.body.category).toBe('accessory');
    expect(res.body.default_price).toBe(55);
    expect(res.body.tech_supplied).toBe(false);
  });

  it('returns 409 if item_name already exists', async () => {
    const { token } = await seedDispatcherWithToken();
    const itemName = await seedItemRow();

    const res = await request(app)
      .post('/api/dispatch/catalog/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ item_name: itemName, category: 'accessory', tech_supplied: false });

    expect(res.status).toBe(409);
  });

  it('returns 400 if item_name is missing', async () => {
    const { token } = await seedDispatcherWithToken();

    const res = await request(app)
      .post('/api/dispatch/catalog/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'accessory', tech_supplied: false });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/item_name/i);
  });

  it('returns 400 if category is invalid', async () => {
    const { token } = await seedDispatcherWithToken();

    const res = await request(app)
      .post('/api/dispatch/catalog/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ item_name: 'Some Item', category: 'bad-cat', tech_supplied: false });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/category/i);
  });

  it('returns 403 for technician role', async () => {
    const { token } = await seedTechnicianWithToken();

    const res = await request(app)
      .post('/api/dispatch/catalog/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ item_name: 'X', category: 'accessory', tech_supplied: false });

    expect(res.status).toBe(403);
  });
});

// ── PATCH /api/dispatch/catalog/:table/:id ────────────────────────────────────

describe('PATCH /api/dispatch/catalog/:table/:id', () => {
  it('updates an editable column on catalog_equipment (dispatcher)', async () => {
    const { token } = await seedDispatcherWithToken();
    const model = await seedEquipmentRow();

    const res = await request(app)
      .patch(`/api/dispatch/catalog/catalog_equipment/${encodeURIComponent(model)}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ pesp: 12.5 });

    expect(res.status).toBe(200);
    expect(res.body.model).toBe(model);
    expect(res.body.pesp).toBe(12.5);
  });

  it('updates an editable column on catalog_items (dispatcher)', async () => {
    const { token } = await seedDispatcherWithToken();
    const itemName = await seedItemRow();

    const res = await request(app)
      .patch(`/api/dispatch/catalog/catalog_items/${encodeURIComponent(itemName)}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ default_price: 99 });

    expect(res.status).toBe(200);
    expect(res.body.item_name).toBe(itemName);
    expect(res.body.default_price).toBe(99);
  });

  it('updates an editable column on catalog_services (dispatcher)', async () => {
    const { token } = await seedDispatcherWithToken();
    const serviceName = await seedServiceRow();

    const res = await request(app)
      .patch(`/api/dispatch/catalog/catalog_services/${encodeURIComponent(serviceName)}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ default_price: 300 });

    expect(res.status).toBe(200);
    expect(res.body.service_name).toBe(serviceName);
    expect(res.body.default_price).toBe(300);
  });

  it('returns 403 for technician role', async () => {
    const { token } = await seedTechnicianWithToken();
    const model = await seedEquipmentRow();

    const res = await request(app)
      .patch(`/api/dispatch/catalog/catalog_equipment/${encodeURIComponent(model)}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ pesp: 5 });

    expect(res.status).toBe(403);
  });

  it('returns 400 for unknown table', async () => {
    const { token } = await seedDispatcherWithToken();

    const res = await request(app)
      .patch('/api/dispatch/catalog/unknown_table/some-id')
      .set('Authorization', `Bearer ${token}`)
      .send({ some_col: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/table/i);
  });

  it('returns 400 when body has a disallowed column', async () => {
    const { token } = await seedDispatcherWithToken();
    const model = await seedEquipmentRow();

    const res = await request(app)
      .patch(`/api/dispatch/catalog/catalog_equipment/${encodeURIComponent(model)}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ model: 'hacked' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/column/i);
  });

  it('returns 400 when body is empty', async () => {
    const { token } = await seedDispatcherWithToken();
    const model = await seedEquipmentRow();

    const res = await request(app)
      .patch(`/api/dispatch/catalog/catalog_equipment/${encodeURIComponent(model)}`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 404 when row does not exist', async () => {
    const { token } = await seedDispatcherWithToken();

    const res = await request(app)
      .patch('/api/dispatch/catalog/catalog_equipment/NONEXISTENT-MODEL')
      .set('Authorization', `Bearer ${token}`)
      .send({ pesp: 5 });

    expect(res.status).toBe(404);
  });
});
