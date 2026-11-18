const request = require('supertest');
const fs = require('fs/promises');
const path = require('path');
const app = require('../src/index');
const { pool: appPool } = require('../src/db/pool');
const { pool, truncateTables } = require('./helpers/db');
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

// A Prestart Report built by the PWA from the visit detail; `edit` changes the
// draft's systems the way the Workspace does.
async function submit(visit, edit) {
  const detail = await request(app).get(`/api/visits/${visit.visitId}`).set('Authorization', `Bearer ${visit.token}`);
  const draft = drafts.createLocalVisitDraft({ ...detail.body, technicianId: visit.tech.id }, { now: '2026-11-17T10:00:00.000Z' });
  edit(draft);
  drafts.tapService(draft._service, null, 'prestart');
  draft._service.rows = drafts.systemNumbersOf(draft).map(systemNumber => ({
    systemNumber, serviceName: 'Prestart', isFinish: false, isTemporarily: false, price: 20,
  }));
  draft.totalPrice = 20 * draft._service.rows.length;
  const snapshot = createCompletionSnapshot(draft, { now: '2026-11-17T10:00:00.000Z' });
  return request(app)
    .post(`/api/visits/${visit.visitId}/complete`)
    .set('Authorization', `Bearer ${visit.token}`)
    .send({ submissionId: snapshot.submissionId, snapshot });
}

it('adds a technician system to the call and shows the change to Dispatch', async () => {
  const visit = await seedAssignedVisit();
  const res = await submit(visit, draft => {
    expect(drafts.addTechSystem(draft, { outdoorModel: 'GSXN403610', refrigerant: 'R-32' })).toBe(2);
  });
  expect(res.status).toBe(200);

  const systems = await pool.query(
    'SELECT system_number, outdoor_model, refrigerant, added_by_technician FROM visit_systems WHERE visit_id = $1 ORDER BY system_number',
    [visit.visitId]
  );
  expect(systems.rows).toEqual([
    { system_number: 1, outdoor_model: null, refrigerant: null, added_by_technician: false },
    { system_number: 2, outdoor_model: 'GSXN403610', refrigerant: 'R-32', added_by_technician: true },
  ]);
  const services = await pool.query('SELECT system_number FROM visit_services WHERE visit_id = $1 ORDER BY system_number', [visit.visitId]);
  expect(services.rows.map(row => row.system_number)).toEqual([1, 2]);

  const { token } = await seedDispatcherWithToken();
  const detail = await request(app).get(`/api/visits/${visit.visitId}`).set('Authorization', `Bearer ${token}`);
  expect(detail.body.hasMultipleSystems).toBe(true);
  expect(detail.body.systems[1]).toMatchObject({ systemNumber: 2, addedByTechnician: true });
  expect(detail.body.systemChanges).toEqual([{
    systemNumber: 2,
    change: 'added',
    before: null,
    after: { indoorModel: null, outdoorModel: 'GSXN403610', coilModel: null, refrigerant: 'R-32' },
    technicianName: visit.tech.name,
    changedAt: expect.any(String),
  }]);
});

it('logs an equipment correction with its before and after', async () => {
  const visit = await seedAssignedVisit();
  await pool.query("UPDATE visit_systems SET outdoor_model = 'GSX140361', refrigerant = 'R-410A' WHERE visit_id = $1", [visit.visitId]);
  const res = await submit(visit, draft => drafts.setSystemEquipment(draft, 1, { outdoorModel: 'GSXN403610', refrigerant: 'R-32' }));
  expect(res.status).toBe(200);
  const change = await pool.query('SELECT change, before, after FROM visit_system_changes WHERE visit_id = $1', [visit.visitId]);
  expect(change.rows).toEqual([{
    change: 'equipment_modified',
    before: { indoorModel: null, outdoorModel: 'GSX140361', coilModel: null, refrigerant: 'R-410A' },
    after: { indoorModel: null, outdoorModel: 'GSXN403610', coilModel: null, refrigerant: 'R-32' },
  }]);
});

it('rejects a Report that drops an office system or skips a number, and changes nothing', async () => {
  const visit = await seedAssignedVisit();
  const skipped = await submit(visit, draft => {
    draft.systems = [...draft.systems, { systemNumber: 3, outdoorModel: 'X', addedByTechnician: true }];
  });
  expect(skipped.status).toBe(409);
  expect(skipped.body.fields).toEqual(['systems']);

  const dropped = await submit(visit, draft => {
    drafts.addTechSystem(draft, { outdoorModel: 'GSXN403610' });
    draft.systems = draft.systems.filter(system => system.systemNumber !== 1);
  });
  expect(dropped.status).toBe(409);
  expect(dropped.body.fields).toEqual(['systems']);

  const rows = await pool.query('SELECT COUNT(*)::int AS n FROM visit_systems WHERE visit_id = $1', [visit.visitId]);
  const log = await pool.query('SELECT COUNT(*)::int AS n FROM visit_system_changes WHERE visit_id = $1', [visit.visitId]);
  expect([rows.rows[0].n, log.rows[0].n]).toEqual([1, 0]);
});

it('lets the technician remove only the last system they added, with its service, Weigh-In and photos', () => {
  const draft = drafts.createLocalVisitDraft({ id: 'v1', systems: [{ systemNumber: 1 }, { systemNumber: 2 }] });
  expect(drafts.canRemoveSystem(draft, 2)).toBe(false);
  const three = drafts.addTechSystem(draft, { outdoorModel: 'GSXN403610', refrigerant: 'R-32' });
  const four = drafts.addTechSystem(draft, { outdoorModel: 'Custom unit' });
  expect([three, four, draft.hasMultipleSystems]).toEqual([3, 4, true]);
  expect(drafts.canRemoveSystem(draft, 3)).toBe(false);

  draft._service.overrides[4] = { ac: true, heat: false, prestart: false, finish: false, temporarily: false };
  draft._weighInData = [{ systemNumber: 1 }, { systemNumber: 4 }];
  draft.evidenceRefs = [{ id: 'p-1', systemNumber: 1 }, { id: 'p-4', systemNumber: 4 }];
  draft._weighInPhotos = { '4-SCALE': true, '1-FAN': true };
  expect(drafts.removeTechSystem(draft, 4)).toEqual([{ id: 'p-4', systemNumber: 4 }]);
  expect(drafts.systemNumbersOf(draft)).toEqual([1, 2, 3]);
  expect(draft._service.overrides[4]).toBeUndefined();
  expect(draft._weighInData).toEqual([{ systemNumber: 1 }]);
  expect(draft.evidenceRefs).toEqual([{ id: 'p-1', systemNumber: 1 }]);
  expect(draft._weighInPhotos).toEqual({ '1-FAN': true });
  expect(drafts.canRemoveSystem(draft, 3)).toBe(true);
});

it('detaches photos of a removed system (file kept) before and after the Report', async () => {
  const visit = await seedAssignedVisit();
  const upload = (photoId, systemNumber) => request(app)
    .post(`/api/visits/${visit.visitId}/photos`).set('Authorization', `Bearer ${visit.token}`)
    .field('photoId', photoId).field('category', 'weigh_in_scale').field('tag', 'SCALE')
    .field('slug', `X_SCALE_SYS${systemNumber}`).field('systemNumber', String(systemNumber))
    .attach('photo', Buffer.from('jpeg'), 'scale.jpg');
  // System 2 was added, photographed (uploaded at once), then removed before the Report.
  const early = require('crypto').randomUUID();
  expect((await upload(early, 2)).status).toBe(200);
  // Removing the system dropped its photo references from the draft.
  const res = await submit(visit, draft => { draft.evidenceRefs = draft.evidenceRefs.filter(ref => ref.systemNumber !== 2); });
  expect(res.status).toBe(200);

  // Its second photo was still on the phone and arrives after the Report.
  const late = require('crypto').randomUUID();
  expect((await upload(late, 2)).status).toBe(200);

  const rows = await pool.query('SELECT id, detached_reason, stored_at FROM visit_photos WHERE visit_id = $1', [visit.visitId]);
  const state = Object.fromEntries(rows.rows.map(row => [row.id === early ? 'early' : 'late', [row.detached_reason, row.stored_at != null]]));
  expect(state).toEqual({ early: ['removed_system', true], late: ['removed_system', true] });
  const { token } = await seedDispatcherWithToken();
  const detail = await request(app).get(`/api/visits/${visit.visitId}`).set('Authorization', `Bearer ${token}`);
  expect(detail.body.photos).toEqual([]);
  const file = await request(app).get(`/api/visits/${visit.visitId}/photos/${early}`).set('Authorization', `Bearer ${token}`);
  expect(file.status).toBe(200);
});
