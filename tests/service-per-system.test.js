const request = require('supertest');
const fs = require('fs/promises');
const path = require('path');
const app = require('../src/index');
const { pool: appPool } = require('../src/db/pool');
const { pool, truncateTables } = require('./helpers/db');
const { seedAssignedVisit } = require('./helpers/seeds');

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
  // The catalog is shared by every suite; restore it after this one.
  savedCatalog = {
    services: (await pool.query('SELECT * FROM catalog_services')).rows,
    items: (await pool.query(
      "SELECT * FROM catalog_items WHERE item_name IN ('Weight-In-Data', 'T-6', 'Ecobee')"
    )).rows,
  };
});

let savedCatalog;

async function restoreCatalog() {
  for (const row of savedCatalog.services) {
    await pool.query(
      `UPDATE catalog_services SET default_price = $2, is_bundle = $3, multiplies_by_system_count = $4
       WHERE service_name = $1`,
      [row.service_name, row.default_price, row.is_bundle, row.multiplies_by_system_count]
    );
  }
  const keptServices = savedCatalog.services.map(row => row.service_name);
  await pool.query('DELETE FROM catalog_services WHERE NOT (service_name = ANY($1))', [keptServices]);
  for (const row of savedCatalog.items) {
    await pool.query(
      `UPDATE catalog_items SET default_price = $2, multiplies_by_system_count = $3, finish_addon_price = $4
       WHERE item_name = $1`,
      [row.item_name, row.default_price, row.multiplies_by_system_count, row.finish_addon_price]
    );
  }
  const keptItems = savedCatalog.items.map(row => row.item_name);
  await pool.query(
    "DELETE FROM catalog_items WHERE item_name IN ('Weight-In-Data', 'T-6', 'Ecobee') AND NOT (item_name = ANY($1))",
    [keptItems]
  );
}

beforeEach(async () => {
  await truncateTables();
  await pool.query(
    `INSERT INTO catalog_services (service_name, default_price, is_bundle, multiplies_by_system_count) VALUES
       ('AC', 30, false, true), ('Heat', 30, false, true), ('AC & Heat', 30, true, false),
       ('Prestart', 20, false, false), ('Drive Run', 10, false, false), ('Finish', 0, false, false)
     ON CONFLICT (service_name) DO UPDATE SET default_price = EXCLUDED.default_price,
       is_bundle = EXCLUDED.is_bundle, multiplies_by_system_count = EXCLUDED.multiplies_by_system_count`
  );
  await pool.query(
    `INSERT INTO catalog_items (item_name, category, default_price, tech_supplied, multiplies_by_system_count, finish_addon_price) VALUES
       ('Weight-In-Data', 'accessory', 10, false, true, 10),
       ('T-6', 'thermostat', 0, true, false, null), ('Ecobee', 'thermostat', 0, true, false, null)
     ON CONFLICT (item_name) DO UPDATE SET default_price = EXCLUDED.default_price,
       multiplies_by_system_count = EXCLUDED.multiplies_by_system_count, finish_addon_price = EXCLUDED.finish_addon_price`
  );
});

afterAll(async () => {
  await truncateTables();
  await restoreCatalog();
  await Promise.all([pool.end(), appPool.end()]);
});

async function twoSystemVisit() {
  const seeded = await seedAssignedVisit();
  await pool.query(
    `INSERT INTO visit_systems (id, visit_id, system_number) VALUES (gen_random_uuid()::text, $1, 2)`,
    [seeded.visitId]
  );
  return seeded;
}

function patchServices({ visitId, token }, services) {
  return request(app)
    .patch(`/api/visits/${visitId}/services`)
    .set('Authorization', `Bearer ${token}`)
    .send({ services });
}

function addItem({ visitId, token }, itemName, category, quantity = 1) {
  return request(app)
    .post(`/api/visits/${visitId}/items`)
    .set('Authorization', `Bearer ${token}`)
    .send({ itemName, category, quantity });
}

describe('per-system service pricing', () => {
  it('charges each system its own service: $30, $20 with Finish, Temporarily no effect', async () => {
    const visit = await twoSystemVisit();
    const res = await patchServices(visit, [
      { systemNumber: 1, serviceName: 'AC & Heat', isFinish: false, isTemporarily: true },
      { systemNumber: 2, serviceName: 'Heat', isFinish: true, isTemporarily: false },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.services.map(row => [row.systemNumber, row.serviceName, row.price])).toEqual([
      [1, 'AC & Heat', 30],
      [2, 'Heat', 20],
    ]);
    expect(res.body.totalPrice).toBe(50);
  });

  it('accepts Finish alone at $0 and Prestart per system', async () => {
    const visit = await twoSystemVisit();
    const res = await patchServices(visit, [
      { systemNumber: 1, serviceName: 'Finish' },
      { systemNumber: 2, serviceName: 'Prestart', isFinish: true },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.services).toEqual([
      { systemNumber: 1, serviceName: 'Finish', isFinish: true, isTemporarily: false, price: 0 },
      { systemNumber: 2, serviceName: 'Prestart', isFinish: false, isTemporarily: false, price: 20 },
    ]);
    expect(res.body.totalPrice).toBe(20);
  });

  it('charges Drive Run once for the call and rejects it beside other services', async () => {
    const visit = await twoSystemVisit();
    const driveRun = await patchServices(visit, [{ serviceName: 'Drive Run' }]);
    expect(driveRun.status).toBe(200);
    expect(driveRun.body.totalPrice).toBe(10);
    const mixed = await patchServices(visit, [
      { serviceName: 'Drive Run' },
      { systemNumber: 1, serviceName: 'AC' },
    ]);
    expect(mixed.status).toBe(400);
  });

  it('rejects unknown and repeated system numbers', async () => {
    const visit = await twoSystemVisit();
    expect((await patchServices(visit, [{ systemNumber: 3, serviceName: 'AC' }])).status).toBe(400);
    expect((await patchServices(visit, [
      { systemNumber: 1, serviceName: 'AC' },
      { systemNumber: 1, serviceName: 'Heat' },
    ])).status).toBe(400);
  });

  it('prices Weigh-In per system: $20 with Finish, $10 without', async () => {
    const visit = await twoSystemVisit();
    expect((await addItem(visit, 'Weight-In-Data', 'accessory')).status).toBe(200);
    const res = await patchServices(visit, [
      { systemNumber: 1, serviceName: 'AC', isFinish: true },
      { systemNumber: 2, serviceName: 'AC', isFinish: false },
    ]);
    expect(res.status).toBe(200);
    // Services 20 + 30, Weigh-In 20 + 10.
    expect(res.body.totalPrice).toBe(80);
  });
});

describe('per-system Report submission', () => {
  async function draftFor({ visitId, token, tech }) {
    const detail = await request(app).get(`/api/visits/${visitId}`).set('Authorization', `Bearer ${token}`);
    expect(detail.status).toBe(200);
    return drafts.createLocalVisitDraft({ ...detail.body, technicianId: tech.id }, { now: '2026-11-17T10:00:00.000Z' });
  }

  function submit({ visitId, token }, snapshot) {
    return request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ submissionId: snapshot.submissionId, snapshot });
  }

  it('accepts mixed per-system services and two thermostat models from the PWA snapshot', async () => {
    const visit = await twoSystemVisit();
    const synced = await patchServices(visit, [
      { systemNumber: 1, serviceName: 'AC', isFinish: true },
      { systemNumber: 2, serviceName: 'Prestart' },
    ]);
    expect(synced.status).toBe(200);
    expect((await addItem(visit, 'T-6', 'thermostat', 2)).status).toBe(200);
    const last = await addItem(visit, 'Ecobee', 'thermostat', 1);
    expect(last.status).toBe(200);

    const draft = await draftFor(visit);
    expect(drafts.isCustomSystemService(draft._service, 2)).toBe(true);
    const snapshot = createCompletionSnapshot(draft, { id: 'per-system-mixed', now: '2026-11-17T10:00:00.000Z' });
    expect(snapshot.services.map(row => [row.systemNumber, row.serviceName, row.price])).toEqual([[1, 'AC', 20], [2, 'Prestart', 20]]);

    const res = await submit(visit, snapshot);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ acknowledged: true, status: 'completed', totalPrice: 40 });
    const text = await request(app).get(`/api/visits/${visit.visitId}/report-preview`).set('Authorization', `Bearer ${visit.token}`);
    expect(text.status).toBe(200);
    const reportText = JSON.stringify(text.body);
    expect(reportText).toContain('Finish/ AC started (System 1) 2 T-6 tstats, 1 Ecobee tstat $20');
    expect(reportText).toContain('System Prestarted (System 2) $20');
  });

  it('prints one line with the system count when every system shares the service', async () => {
    const visit = await twoSystemVisit();
    await patchServices(visit, [
      { systemNumber: 1, serviceName: 'AC' },
      { systemNumber: 2, serviceName: 'AC' },
    ]);
    const snapshot = createCompletionSnapshot(await draftFor(visit), { id: 'per-system-uniform', now: '2026-11-17T10:00:00.000Z' });
    const res = await submit(visit, snapshot);
    expect(res.status).toBe(200);
    const text = await request(app).get(`/api/visits/${visit.visitId}/report-preview`).set('Authorization', `Bearer ${visit.token}`);
    expect(JSON.stringify(text.body)).toContain('AC started (2 Systems) $60');
  });

  it('accepts a Drive Run Report although the address keeps earlier Weigh-In measurements', async () => {
    const visit = await twoSystemVisit();
    await pool.query(
      `INSERT INTO weigh_in_data (address_id, system_number, lineset_length, adjusted_oz)
       VALUES ($1, 1, 35, 4)`,
      [visit.addressId]
    );
    const synced = await patchServices(visit, [{ serviceName: 'Drive Run' }]);
    expect(synced.status).toBe(200);
    const draft = await draftFor(visit);
    // Drive Run clears the Weigh-In section in the Workspace draft.
    draft._weighInData = [];
    const snapshot = createCompletionSnapshot(draft, { id: 'per-system-drive-run', now: '2026-11-17T10:00:00.000Z' });
    expect(snapshot.services).toEqual([
      { systemNumber: null, serviceName: 'Drive Run', isFinish: false, isTemporarily: false, price: 10 },
    ]);
    const res = await submit(visit, snapshot);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ acknowledged: true, totalPrice: 10 });
  });

  it('rejects a Report while a system has no service', async () => {
    const visit = await twoSystemVisit();
    await patchServices(visit, [{ systemNumber: 1, serviceName: 'AC' }]);
    const draft = await draftFor(visit);
    expect(() => createCompletionSnapshot(draft, { id: 'per-system-missing' })).toThrow('System 2: no service selected');

    const snapshot = { ...createCompletionSnapshot({ ...draft, _service: { ...draft._service, overrides: { 2: { ac: true } } } }, { id: 'per-system-missing' }) };
    snapshot.services = snapshot.services.filter(row => row.systemNumber === 1);
    const res = await submit(visit, snapshot);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('System 2: no service selected');
  });
});
