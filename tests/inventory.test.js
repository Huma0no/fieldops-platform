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

function getCurrentPeriodStart() {
  const today = new Date();
  const day = today.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diff);
  return monday.toISOString().slice(0, 10);
}

async function seedInventoryAssignment(technicianId, itemName, quantityAssigned, periodStart) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO inventory_assignments (id, technician_id, item_name, quantity_assigned, period_start, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, technicianId, itemName, quantityAssigned, periodStart, new Date().toISOString()]
  );
  return id;
}

// ── GET /api/inventory/mine ───────────────────────────────────────────────────

describe('GET /api/inventory/mine', () => {
  it('returns balance = assigned - consumed for current period', async () => {
    const { tech, token } = await seedTechnicianWithToken();
    const itemName = `ITEM-${crypto.randomBytes(4).toString('hex')}`;
    await seedCatalogItem(itemName, { techSupplied: true });

    const periodStart = getCurrentPeriodStart();
    await seedInventoryAssignment(tech.id, itemName, 10, periodStart);

    // Seed a completed visit with a tech-supplied item_visit row for this tech
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, $2, 'accessory', 3, 50, true)`,
      [visitId, itemName]
    );

    // Also update completed_at to be within this period
    await pool.query(
      `UPDATE visits SET completed_at = $1 WHERE id = $2`,
      [new Date().toISOString(), visitId]
    );

    const res = await request(app)
      .get('/api/inventory/mine')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const item = res.body.find((i) => i.itemName === itemName);
    expect(item).toBeDefined();
    expect(item.quantityAssigned).toBe(10);
    expect(item.quantityConsumed).toBe(3);
    expect(item.balance).toBe(7);
  });

  it('returns balance = assigned when no consumption', async () => {
    const { tech, token } = await seedTechnicianWithToken();
    const itemName = `ITEM-${crypto.randomBytes(4).toString('hex')}`;
    await seedCatalogItem(itemName);

    const periodStart = getCurrentPeriodStart();
    await seedInventoryAssignment(tech.id, itemName, 5, periodStart);

    const res = await request(app)
      .get('/api/inventory/mine')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const item = res.body.find((i) => i.itemName === itemName);
    expect(item).toBeDefined();
    expect(item.quantityConsumed).toBe(0);
    expect(item.balance).toBe(5);
  });

  it('returns empty array when no assignments for current period', async () => {
    const { token } = await seedTechnicianWithToken();

    const res = await request(app)
      .get('/api/inventory/mine')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns 403 for dispatcher role', async () => {
    const { token } = await seedDispatcherWithToken();

    const res = await request(app)
      .get('/api/inventory/mine')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});

// ── GET /api/dispatch/inventory ───────────────────────────────────────────────

describe('GET /api/dispatch/inventory', () => {
  it('returns inventory grouped by technician', async () => {
    const { dispatcher, token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const itemName = `ITEM-${crypto.randomBytes(4).toString('hex')}`;
    await seedCatalogItem(itemName);

    const periodStart = getCurrentPeriodStart();
    await seedInventoryAssignment(tech.id, itemName, 8, periodStart);

    const res = await request(app)
      .get('/api/dispatch/inventory')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const techEntry = res.body.find((e) => e.technicianId === tech.id);
    expect(techEntry).toBeDefined();
    expect(techEntry.technicianName).toBe(tech.name);
    expect(Array.isArray(techEntry.items)).toBe(true);
    const itemEntry = techEntry.items.find((i) => i.itemName === itemName);
    expect(itemEntry.quantityAssigned).toBe(8);
    expect(itemEntry.balance).toBeDefined();
  });

  it('returns 403 for technician role', async () => {
    const { token } = await seedTechnicianWithToken();

    const res = await request(app)
      .get('/api/dispatch/inventory')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});

// ── POST /api/dispatch/inventory/assign ───────────────────────────────────────

describe('POST /api/dispatch/inventory/assign', () => {
  it('creates an inventory_assignments row', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const itemName = `ITEM-${crypto.randomBytes(4).toString('hex')}`;
    await seedCatalogItem(itemName);

    const periodStart = getCurrentPeriodStart();

    const res = await request(app)
      .post('/api/dispatch/inventory/assign')
      .set('Authorization', `Bearer ${token}`)
      .send({ technicianId: tech.id, itemName, quantityAssigned: 12, periodStart });

    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(res.body.technicianId).toBe(tech.id);
    expect(res.body.itemName).toBe(itemName);
    expect(res.body.quantityAssigned).toBe(12);
    expect(res.body.periodStart).toBe(periodStart);

    const row = await pool.query(
      `SELECT * FROM inventory_assignments WHERE id = $1`,
      [res.body.id]
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].quantity_assigned).toBe(12);
  });

  it('returns 400 if technician does not exist', async () => {
    const { token } = await seedDispatcherWithToken();
    const itemName = `ITEM-${crypto.randomBytes(4).toString('hex')}`;
    await seedCatalogItem(itemName);

    const res = await request(app)
      .post('/api/dispatch/inventory/assign')
      .set('Authorization', `Bearer ${token}`)
      .send({ technicianId: 'bad-id', itemName, quantityAssigned: 5, periodStart: '2026-06-23' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Technician');
  });

  it('returns 400 if itemName does not exist in catalog', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();

    const res = await request(app)
      .post('/api/dispatch/inventory/assign')
      .set('Authorization', `Bearer ${token}`)
      .send({ technicianId: tech.id, itemName: 'NONEXISTENT-ITEM', quantityAssigned: 5, periodStart: '2026-06-23' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('item');
  });

  it('returns 403 for technician role', async () => {
    const { token } = await seedTechnicianWithToken();

    const res = await request(app)
      .post('/api/dispatch/inventory/assign')
      .set('Authorization', `Bearer ${token}`)
      .send({ technicianId: 'x', itemName: 'x', quantityAssigned: 1, periodStart: '2026-06-23' });

    expect(res.status).toBe(403);
  });
});
