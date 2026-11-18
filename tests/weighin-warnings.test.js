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


it('lists missing Weigh-In data only for systems where Weigh-In is expected', () => {
  const draft = drafts.createLocalVisitDraft({ id: 'v1', systems: [{ systemNumber: 1 }, { systemNumber: 2 }] });
  expect(drafts.weighInWarnings(draft)).toEqual([]);

  draft.evidenceRefs = [{ id: 'p1', tag: 'SCALE', systemNumber: 1, noLocation: true }];
  draft._weighInData = [{ systemNumber: 1, linesetLength: 25 }];
  expect(drafts.weighInWarnings(draft)).toEqual([
    'System 1: Adjusted oz, Liquid temp, Condenser sat, SCALE photo without location, FAN photo',
  ]);

  // Billing Weight-In-Data expects Weigh-In on every system.
  draft._items = [{ item_name: 'Weight-In-Data', category: 'accessory' }];
  expect(drafts.weighInWarnings(draft)).toHaveLength(2);
  drafts.setDriveRun(draft._service, true);
  expect(drafts.weighInWarnings(draft)).toEqual([]);
});

it('accepts a Report with empty Weigh-In and a SCALE photo without location, and shows it incomplete', async () => {
  const visit = await seedAssignedVisit();
  const detail = await request(app).get(`/api/visits/${visit.visitId}`).set('Authorization', `Bearer ${visit.token}`);
  const draft = drafts.createLocalVisitDraft({ ...detail.body, technicianId: visit.tech.id }, { now: '2026-11-17T10:00:00.000Z' });
  drafts.tapService(draft._service, null, 'prestart');
  draft._service.rows = [{ systemNumber: 1, serviceName: 'Prestart', isFinish: false, isTemporarily: false, price: 20 }];
  draft.totalPrice = 20;
  const photoId = randomUUID();
  draft.evidenceRefs = [{ id: photoId, slug: 'X_SCALE_SYS1', tag: 'SCALE', label: null, category: 'weigh_in_scale', systemNumber: 1, storedAt: null, noLocation: true }];
  const snapshot = createCompletionSnapshot(draft, { now: '2026-11-17T10:00:00.000Z' });
  expect(snapshot.weighInWarnings).toEqual(['System 1: Lineset ft, Adjusted oz, Liquid temp, Condenser sat, SCALE photo without location, FAN photo']);

  const res = await request(app).post(`/api/visits/${visit.visitId}/complete`)
    .set('Authorization', `Bearer ${visit.token}`).send({ submissionId: snapshot.submissionId, snapshot });
  expect(res.status).toBe(200);

  const { token } = await seedDispatcherWithToken();
  const report = await request(app).get(`/api/visits/${visit.visitId}/download`).set('Authorization', `Bearer ${token}`);
  expect(report.body.weighInWarnings).toEqual(snapshot.weighInWarnings);
});
