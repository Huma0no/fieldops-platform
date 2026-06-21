const request = require('supertest');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');
const { seedDispatcherWithToken } = require('./helpers/seeds');

beforeEach(truncateTables);
afterAll(() => pool.end());

async function seedAddress({ street = '100 EXISTING ST', zip = '77001' } = {}) {
  const r = await pool.query(
    `INSERT INTO addresses (id, street, city, state, zip)
     VALUES (gen_random_uuid()::text, $1, 'Houston', 'TX', $2)
     RETURNING *`,
    [street, zip]
  );
  return r.rows[0];
}

const incomingData = {
  address: '100 EXISTING STREET',
  city: 'Houston',
  state: 'TX',
  zip: '77001',
  subdivision: 'Eastview',
  builder: 'LENNAR',
};

const pendingVisitData = {
  orderNumber: 'ORD-RESOLVE',
  scheduledTime: '2026-06-21T08:00:00Z',
  workType: 'AC',
  systemCount: 1,
  notes: null,
  batchId: null,
};

describe('POST /api/addresses/:id/resolve-comparison', () => {
  it('create_new: inserts a new address and creates a visit pointing to it', async () => {
    const { token } = await seedDispatcherWithToken();
    const existing = await seedAddress();

    const res = await request(app)
      .post(`/api/addresses/${existing.id}/resolve-comparison`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'create_new', incomingData, pendingVisitData });

    expect(res.status).toBe(200);
    expect(res.body.visitId).toBeDefined();
    expect(res.body.addressId).toBeDefined();

    // New address should be different from existing
    expect(res.body.addressId).not.toBe(existing.id);

    const visit = await pool.query('SELECT * FROM visits WHERE id = $1', [res.body.visitId]);
    expect(visit.rows[0].address_id).toBe(res.body.addressId);
    expect(visit.rows[0].status).toBe('pending_review');

    // Original address unchanged
    const orig = await pool.query('SELECT * FROM addresses WHERE id = $1', [existing.id]);
    expect(orig.rows[0].street).toBe('100 EXISTING ST');
  });

  it('merge_keep_new: updates existing address with incomingData and creates visit', async () => {
    const { token } = await seedDispatcherWithToken();
    const existing = await seedAddress();

    const res = await request(app)
      .post(`/api/addresses/${existing.id}/resolve-comparison`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'merge_keep_new', incomingData, pendingVisitData });

    expect(res.status).toBe(200);
    expect(res.body.addressId).toBe(existing.id);

    const updated = await pool.query('SELECT * FROM addresses WHERE id = $1', [existing.id]);
    expect(updated.rows[0].street).toBe('100 EXISTING STREET');
    expect(updated.rows[0].subdivision).toBe('Eastview');

    const visit = await pool.query('SELECT * FROM visits WHERE id = $1', [res.body.visitId]);
    expect(visit.rows[0].address_id).toBe(existing.id);
  });

  it('merge_keep_existing: leaves address unchanged and creates visit pointing to it', async () => {
    const { token } = await seedDispatcherWithToken();
    const existing = await seedAddress();

    const res = await request(app)
      .post(`/api/addresses/${existing.id}/resolve-comparison`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'merge_keep_existing', incomingData, pendingVisitData });

    expect(res.status).toBe(200);
    expect(res.body.addressId).toBe(existing.id);

    const unchanged = await pool.query('SELECT * FROM addresses WHERE id = $1', [existing.id]);
    expect(unchanged.rows[0].street).toBe('100 EXISTING ST');

    const visit = await pool.query('SELECT * FROM visits WHERE id = $1', [res.body.visitId]);
    expect(visit.rows[0].address_id).toBe(existing.id);
  });

  it('returns 400 for unknown action', async () => {
    const { token } = await seedDispatcherWithToken();
    const existing = await seedAddress();

    const res = await request(app)
      .post(`/api/addresses/${existing.id}/resolve-comparison`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'do_something_weird', incomingData, pendingVisitData });

    expect(res.status).toBe(400);
  });

  it('returns 404 when address id does not exist', async () => {
    const { token } = await seedDispatcherWithToken();

    const res = await request(app)
      .post('/api/addresses/nonexistent-id/resolve-comparison')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'merge_keep_existing', incomingData, pendingVisitData });

    expect(res.status).toBe(404);
  });
});
