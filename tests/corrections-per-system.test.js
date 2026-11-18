const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/index');
const { pool: appPool } = require('../src/db/pool');
const { pool, truncateTables } = require('./helpers/db');
const { seedDispatcherWithToken, seedCompletedVisit } = require('./helpers/seeds');

beforeAll(async () => {
  for (const name of ['AC', 'Heat', 'Prestart']) {
    await pool.query(
      `INSERT INTO catalog_services (service_name, default_price, multiplies_by_system_count) VALUES ($1, 30, true)
       ON CONFLICT (service_name) DO NOTHING`, [name]);
  }
});
beforeEach(truncateTables);
afterAll(async () => { await Promise.all([pool.end(), appPool.end()]); });

// A completed two-system visit with per-system services and an open correction.
async function seedTwoSystemCorrection() {
  const { token } = await seedDispatcherWithToken();
  const { visitId, technicianId } = await seedCompletedVisit();
  await pool.query(`INSERT INTO visit_systems (id, visit_id, system_number) VALUES (gen_random_uuid()::text, $1, 2)`, [visitId]);
  await pool.query(
    `INSERT INTO visit_services (id, visit_id, service_name, is_finish, is_temporarily, price, system_number)
     VALUES (gen_random_uuid()::text, $1, 'AC', false, false, 30, 1), (gen_random_uuid()::text, $1, 'Prestart', false, false, 20, 2)`,
    [visitId]
  );
  const correctionId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO corrections (id, visit_id, initiator_id, origin, request_message, status, requested_at)
     VALUES ($1, $2, $3, 'technician_requested', 'fix services', 'open', $4)`,
    [correctionId, visitId, technicianId, new Date().toISOString()]
  );
  const apply = services => request(app).patch(`/api/dispatch/corrections/${correctionId}/apply`)
    .set('Authorization', `Bearer ${token}`).send({ changes: { services } });
  return { visitId, apply };
}

it('keeps per-system services when Dispatch corrects one system', async () => {
  const { visitId, apply } = await seedTwoSystemCorrection();
  const res = await apply([
    { systemNumber: 1, serviceName: 'AC', isFinish: false },
    { systemNumber: 2, serviceName: 'Heat', isFinish: true },
  ]);
  expect(res.status).toBe(200);
  const rows = await pool.query('SELECT system_number, service_name, is_finish FROM visit_services WHERE visit_id = $1 ORDER BY system_number', [visitId]);
  expect(rows.rows).toEqual([
    { system_number: 1, service_name: 'AC', is_finish: false },
    { system_number: 2, service_name: 'Heat', is_finish: true },
  ]);
  const log = await pool.query('SELECT summary FROM edit_log WHERE visit_id = $1', [visitId]);
  expect(log.rows[0].summary).toBe('Service changed from System 1 AC, System 2 Prestart to System 1 AC, System 2 Heat with Finish.');
});

it('rejects a correction that leaves a system without service or adds Temporarily to a completed report', async () => {
  const { apply } = await seedTwoSystemCorrection();
  const missing = await apply([{ systemNumber: 1, serviceName: 'AC' }]);
  expect(missing.status).toBe(400);
  expect(missing.body.error).toBe('System 2: no service selected');
  const temporarily = await apply([
    { systemNumber: 1, serviceName: 'AC', isTemporarily: true },
    { systemNumber: 2, serviceName: 'Prestart' },
  ]);
  expect(temporarily.status).toBe(400);
  expect(temporarily.body.error).toBe('Temporarily changes the report status and cannot be added in Corrections');
});
