const request = require('supertest');
const fs = require('fs/promises');
const path = require('path');
const app = require('../src/index');
const { pool: appPool } = require('../src/db/pool');
const { pool, truncateTables } = require('./helpers/db');
const { randomUUID } = require('crypto');
const { seedAssignedVisit, seedDispatcherWithToken } = require('./helpers/seeds');

let drafts;
let createCompletionSnapshot;

function asModule(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

beforeAll(async () => {
  const read = file => fs.readFile(path.join(__dirname, '../frontend/pwa/src/lib', file), 'utf8');
  const draftUrl = asModule(await read('workspace-visit.mjs'));
  const submission = (await read('completion-submission.mjs'))
    .replace("'./db.js'", `'${asModule(await read('db.js'))}'`)
    .replace("'../../../shared/api.js'", `'${asModule('export const api = {};')}'`)
    .replace("'./cancel-justification.mjs'", `'${asModule(await read('cancel-justification.mjs'))}'`)
    .replace("'./workspace-visit.mjs'", `'${draftUrl}'`);
  drafts = await import(draftUrl);
  ({ createCompletionSnapshot } = await import(asModule(submission)));
  await pool.query(
    `INSERT INTO catalog_services (service_name, default_price, is_bundle, multiplies_by_system_count)
     VALUES ('Prestart', 20, false, false) ON CONFLICT (service_name) DO NOTHING`
  );
});

beforeEach(truncateTables);
afterAll(async () => {
  await Promise.all([pool.end(), appPool.end()]);
});



// Two calls at the same address for the same technician; both drafts are
// downloaded up front (local-first), before either report is sent.
async function twoVisitsSameAddress() {
  const a = await seedAssignedVisit();
  const now = new Date().toISOString();
  const b = await pool.query(
    `INSERT INTO visits (id, address_id, technician_id, status, has_multiple_systems, is_deferred, scheduled_time, date, created_at, updated_at)
     VALUES (gen_random_uuid()::text, $1, $2, 'assigned', false, false, '2026-07-01T11:00:00Z', '2026-07-01', $3, $3) RETURNING id`,
    [a.addressId, a.tech.id, now]
  );
  await pool.query(`INSERT INTO visit_systems (id, visit_id, system_number) VALUES (gen_random_uuid()::text, $1, 1)`, [b.rows[0].id]);
  const draftFor = async visitId => {
    const detail = await request(app).get(`/api/visits/${visitId}`).set('Authorization', `Bearer ${a.token}`);
    const draft = drafts.createLocalVisitDraft({ ...detail.body, technicianId: a.tech.id }, { now: '2026-11-18T10:00:00.000Z' });
    drafts.tapService(draft._service, null, 'prestart');
    draft._service.rows = [{ systemNumber: 1, serviceName: 'Prestart', isFinish: false, isTemporarily: false, price: 20 }];
    draft.totalPrice = 20;
    return draft;
  };
  const send = draft => {
    const snapshot = createCompletionSnapshot(draft, { now: '2026-11-18T10:00:00.000Z' });
    return request(app).post(`/api/visits/${draft.id}/complete`).set('Authorization', `Bearer ${a.token}`)
      .send({ submissionId: snapshot.submissionId, snapshot });
  };
  return { a, visitA: a.visitId, visitB: b.rows[0].id, draftFor, send };
}

const FULL = { systemNumber: 1, linesetLength: 25, factoryChargeOz: 100, factoryLineConfig: null, approxAdjustOz: 5, adjustedOz: 10,
  fanSpeedCfm: 1200, liquidLineTemp: 80, suctionLineTemp: 50, condenserSatTemp: 90, subcoolingValue: 10, oemSubcoolingGoal: 10, subcoolingDeviation: 0 };

it('accepts a report without Weigh-In after another report at the same address wrote Weigh-In', async () => {
  const { visitA, visitB, draftFor, send } = await twoVisitsSameAddress();
  const [draftA, draftB] = [await draftFor(visitA), await draftFor(visitB)];
  draftA._weighInData = [FULL];
  expect((await send(draftA)).status).toBe(200);
  const res = await send(draftB);
  expect(res.status).toBe(200);
  expect(res.body.weighInData).toEqual([]);
});

it('accepts two reports at the same address with different Weigh-In and flags the change', async () => {
  const { visitA, visitB, draftFor, send } = await twoVisitsSameAddress();
  const [draftA, draftB] = [await draftFor(visitA), await draftFor(visitB)];
  draftA._weighInData = [FULL];
  expect((await send(draftA)).status).toBe(200);
  draftB._weighInData = [{ ...FULL, linesetLength: 30, adjustedOz: 14, factoryChargeOz: null }];
  const res = await send(draftB);
  expect(res.status).toBe(200);

  // The phone is the source of truth: stored as sent.
  const stored = await pool.query('SELECT lineset_length, adjusted_oz, factory_charge_oz FROM weigh_in_data WHERE system_number = 1');
  expect(stored.rows).toEqual([{ lineset_length: 30, adjusted_oz: 14, factory_charge_oz: null }]);
  // The previous values are kept in the accepted Report for Dispatch.
  const { token } = await seedDispatcherWithToken();
  const report = await request(app).get(`/api/visits/${visitB}/download`).set('Authorization', `Bearer ${token}`);
  expect(report.body.weighInDiscrepancies).toEqual([
    { systemNumber: 1, field: 'linesetLength', previous: 25, reported: 30 },
    { systemNumber: 1, field: 'factoryChargeOz', previous: 100, reported: null },
    { systemNumber: 1, field: 'adjustedOz', previous: 10, reported: 14 },
  ]);
  const first = await request(app).get(`/api/visits/${visitA}/download`).set('Authorization', `Bearer ${token}`);
  expect(first.body.weighInDiscrepancies).toEqual([]);
});
