// W2: Acc/Fix usage from the technician's last 30 completed Reports, and the
// pinned template per category (★ → "yours"; null resets to suggested).
const request = require('supertest');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');
const { seedTechnicianWithToken, seedDispatcherWithToken, seedCompletedVisit } = require('./helpers/seeds');

beforeEach(truncateTables);
afterAll(() => pool.end());

async function seedItem(itemName, category) {
  await pool.query(
    `INSERT INTO catalog_items (item_name, category, default_price, tech_supplied)
     VALUES ($1, $2, 10, false) ON CONFLICT (item_name) DO NOTHING`,
    [itemName, category]
  );
}

async function useItems(technicianId, itemNames, completedAt) {
  const { visitId } = await seedCompletedVisit({ technicianId });
  await pool.query('UPDATE visits SET completed_at = $1 WHERE id = $2', [completedAt, visitId]);
  for (const itemName of itemNames) {
    const { rows } = await pool.query('SELECT category FROM catalog_items WHERE item_name = $1', [itemName]);
    await pool.query(
      `INSERT INTO visit_items (visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES ($1, $2, $3, 2, 10, false)`,
      [visitId, itemName, rows[0].category]
    );
  }
}

it('counts the reports using each item among the last 30 completed', async () => {
  const { tech, token } = await seedTechnicianWithToken();
  const other = await seedTechnicianWithToken();
  await seedItem('W2-ACC', 'accessory');
  await seedItem('W2-FIX', 'fix');
  // The oldest report falls outside the last 30.
  await useItems(tech.id, ['W2-ACC', 'W2-FIX'], '2026-01-01T00:00:00.000Z');
  for (let day = 1; day <= 30; day++) {
    await useItems(tech.id, day <= 3 ? ['W2-ACC'] : [], `2026-02-${String(Math.min(day, 28)).padStart(2, '0')}T${String(day % 24).padStart(2, '0')}:00:00.000Z`);
  }
  await useItems(other.tech.id, ['W2-ACC', 'W2-FIX'], '2026-03-01T00:00:00.000Z');

  const res = await request(app).get('/api/workspace/acc-fix').set('Authorization', `Bearer ${token}`);

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ usage: { 'W2-ACC': 3 }, templates: { accessory: null, fix: null } });
});

it('saves a pinned template per category and resets it with null', async () => {
  const { token } = await seedTechnicianWithToken();
  const put = (category, keys) => request(app)
    .put(`/api/workspace/acc-fix/templates/${category}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ keys });

  expect((await put('accessory', ['UT3000', 'LP Kit', 'UT3000'])).body).toEqual({ category: 'accessory', keys: ['UT3000', 'LP Kit'] });
  expect((await put('fix', ['Leaks'])).status).toBe(200);
  let res = await request(app).get('/api/workspace/acc-fix').set('Authorization', `Bearer ${token}`);
  expect(res.body.templates).toEqual({ accessory: ['UT3000', 'LP Kit'], fix: ['Leaks'] });

  expect((await put('accessory', null)).status).toBe(200);
  res = await request(app).get('/api/workspace/acc-fix').set('Authorization', `Bearer ${token}`);
  expect(res.body.templates).toEqual({ accessory: null, fix: ['Leaks'] });
});

it('rejects bad input and other roles', async () => {
  const { token } = await seedTechnicianWithToken();
  const dispatcher = await seedDispatcherWithToken();
  const bad = await request(app).put('/api/workspace/acc-fix/templates/thermostat')
    .set('Authorization', `Bearer ${token}`).send({ keys: [] });
  expect(bad.status).toBe(400);
  const badKeys = await request(app).put('/api/workspace/acc-fix/templates/fix')
    .set('Authorization', `Bearer ${token}`).send({ keys: 'Leaks' });
  expect(badKeys.status).toBe(400);
  const forbidden = await request(app).get('/api/workspace/acc-fix').set('Authorization', `Bearer ${dispatcher.token}`);
  expect(forbidden.status).toBe(403);
});
