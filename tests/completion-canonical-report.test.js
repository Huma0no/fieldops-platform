const request = require('supertest');
const { randomUUID } = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const app = require('../src/index');
const { pool: appPool } = require('../src/db/pool');
const { pool, truncateTables } = require('./helpers/db');
const { seedAssignedVisit } = require('./helpers/seeds');

let createLocalVisitDraft;
let createCompletionSnapshot;

function asModule(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

beforeAll(async () => {
  const dbSource = await fs.readFile(path.join(__dirname, '../frontend/pwa/src/lib/db.js'), 'utf8');
  const draftSource = await fs.readFile(path.join(__dirname, '../frontend/pwa/src/lib/workspace-visit.mjs'), 'utf8');
  const cancelSource = await fs.readFile(path.join(__dirname, '../frontend/pwa/src/lib/cancel-justification.mjs'), 'utf8');
  const submissionSource = await fs.readFile(path.join(__dirname, '../frontend/pwa/src/lib/completion-submission.mjs'), 'utf8');
  const dbUrl = asModule(dbSource);
  const draftUrl = asModule(draftSource);
  const cancelUrl = asModule(cancelSource);
  const apiUrl = asModule('export const api = {};');
  const rewritten = submissionSource
    .replace("'./db.js'", `'${dbUrl}'`)
    .replace("'../../../shared/api.js'", `'${apiUrl}'`)
    .replace("'./cancel-justification.mjs'", `'${cancelUrl}'`)
    .replace("'./workspace-visit.mjs'", `'${draftUrl}'`);
  const draftModule = await import(draftUrl);
  const submissionModule = await import(asModule(rewritten));
  createLocalVisitDraft = draftModule.createLocalVisitDraft;
  createCompletionSnapshot = submissionModule.createCompletionSnapshot;
});

beforeEach(truncateTables);
afterAll(async () => {
  await Promise.all([pool.end(), appPool.end()]);
});

it('accepts a normal Report built from the PWA snapshot constructor and current Service detail', async () => {
  const { visitId, token, tech } = await seedAssignedVisit();
  await pool.query(
    `INSERT INTO catalog_services (service_name, default_price, is_bundle, multiplies_by_system_count)
     VALUES ('AC', 150, false, false)
     ON CONFLICT (service_name) DO UPDATE SET default_price = EXCLUDED.default_price`
  );
  const serviceSelection = await request(app)
    .patch(`/api/visits/${visitId}/services`)
    .set('Authorization', `Bearer ${token}`)
    .send({ services: [{ systemNumber: 1, serviceName: 'AC' }] });
  expect(serviceSelection.status).toBe(200);
  const itemName = `CANONICAL-ITEM-${randomUUID()}`;
  await pool.query(
    `INSERT INTO catalog_items (item_name, category, default_price, tech_supplied)
     VALUES ($1, 'accessory', 10, false)`, [itemName]
  );
  const addItem = await request(app)
    .post(`/api/visits/${visitId}/items`)
    .set('Authorization', `Bearer ${token}`)
    .send({ itemName, category: 'accessory', quantity: 2 });
  expect(addItem.status).toBe(200);

  const detailResponse = await request(app)
    .get(`/api/visits/${visitId}`)
    .set('Authorization', `Bearer ${token}`);
  expect(detailResponse.status).toBe(200);
  const draft = createLocalVisitDraft(detailResponse.body, { now: '2026-11-13T10:00:00.000Z' });
  draft.notes = 'Normal Report notes';
  const snapshot = {
    ...createCompletionSnapshot(draft, {
      id: 'pwa-canonical-normal-report',
      now: '2026-11-13T10:00:00.000Z',
      technicianId: tech.id,
    }),
    acceptedAt: '1900-01-01T00:00:00.000Z',
    completedAt: '1900-01-01T00:00:00.000Z',
  };

  const response = await request(app)
    .post(`/api/visits/${visitId}/complete`)
    .set('Authorization', `Bearer ${token}`)
    .send({ submissionId: snapshot.submissionId, snapshot });

  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({
    acknowledged: true,
    submissionId: snapshot.submissionId,
    technicianId: tech.id,
    status: 'completed',
    totalPrice: 160,
    items: [expect.objectContaining({ itemName, quantity: 2, price: 10 })],
  });
  expect(response.body.acceptedAt).not.toBe(snapshot.acceptedAt);
  expect(response.body.completedAt).not.toBe(snapshot.completedAt);
  expect((await pool.query('SELECT status FROM visits WHERE id = $1', [visitId])).rows[0].status).toBe('completed');
  expect((await pool.query('SELECT count(*)::int AS count FROM completion_submissions WHERE visit_id = $1', [visitId])).rows[0].count).toBe(1);
});

it('accepts a stale device total and records the discrepancy (PP-01)', async () => {
  const { visitId, token, tech } = await seedAssignedVisit();
  await pool.query(
    `INSERT INTO catalog_services (service_name, default_price, is_bundle, multiplies_by_system_count)
     VALUES ('AC', 150, false, false)
     ON CONFLICT (service_name) DO UPDATE SET default_price = EXCLUDED.default_price`
  );
  // Reproduce the Workspace race: the service row exists but the async service
  // PATCH has not yet synchronized visits.total_price.
  await pool.query(
    `INSERT INTO visit_services (visit_id, service_name, is_finish, is_temporarily, price, system_number)
     VALUES ($1, 'AC', false, false, 150, 1)`, [visitId]
  );
  const detail = await request(app)
    .get(`/api/visits/${visitId}`)
    .set('Authorization', `Bearer ${token}`);
  expect(detail.status).toBe(200);
  const draft = createLocalVisitDraft(detail.body, { now: '2026-11-13T10:00:00.000Z' });
  expect(draft.totalPrice).toBe(0);
  expect(draft._service.rows[0].price).toBe(150);

  const staleSnapshot = createCompletionSnapshot(draft, {
    id: 'pwa-stale-service-total',
    now: '2026-11-13T10:00:00.000Z',
    technicianId: tech.id,
  });
  const accepted = await request(app)
    .post(`/api/visits/${visitId}/complete`)
    .set('Authorization', `Bearer ${token}`)
    .send({ submissionId: staleSnapshot.submissionId, snapshot: staleSnapshot });
  expect(accepted.status).toBe(200);
  expect(accepted.body).toMatchObject({ acknowledged: true, status: 'completed', totalPrice: 150 });
  expect(accepted.body.priceDiscrepancies).toEqual([
    { field: 'totalPrice', submitted: 0, accepted: 150 },
  ]);
});

it('rolls back an incomplete PWA snapshot and accepts the explicitly corrected snapshot with a fresh identity', async () => {
  const { visitId, token, tech } = await seedAssignedVisit();
  await pool.query(
    `INSERT INTO catalog_services (service_name, default_price, is_bundle, multiplies_by_system_count)
     VALUES ('AC', 150, false, false)
     ON CONFLICT (service_name) DO UPDATE SET default_price = EXCLUDED.default_price`
  );
  const serviceSelection = await request(app)
    .patch(`/api/visits/${visitId}/services`)
    .set('Authorization', `Bearer ${token}`)
    .send({ services: [{ systemNumber: 1, serviceName: 'AC' }] });
  expect(serviceSelection.status).toBe(200);
  const detailResponse = await request(app)
    .get(`/api/visits/${visitId}`)
    .set('Authorization', `Bearer ${token}`);
  const draft = createLocalVisitDraft(detailResponse.body, { now: '2026-11-13T10:00:00.000Z' });
  draft.notes = 'Corrected Report notes';
  const reviewedSnapshot = createCompletionSnapshot(draft, {
    id: 'pwa-incomplete-report-attempt',
    now: '2026-11-13T10:00:00.000Z',
    technicianId: tech.id,
  });
  const reviewed = { ...reviewedSnapshot, address: { ...reviewedSnapshot.address } };
  delete reviewed.address.city;

  const rejected = await request(app)
    .post(`/api/visits/${visitId}/complete`)
    .set('Authorization', `Bearer ${token}`)
    .send({ submissionId: reviewed.submissionId, snapshot: reviewed });

  expect(rejected.status).toBe(409);
  expect(rejected.body.code).toBe('REPORT_CONTENT_MISMATCH');
  expect((await pool.query('SELECT status FROM visits WHERE id = $1', [visitId])).rows[0].status).toBe('assigned');
  expect((await pool.query('SELECT count(*)::int AS count FROM completion_submissions WHERE visit_id = $1', [visitId])).rows[0].count).toBe(0);

  const corrected = createCompletionSnapshot(draft, {
    id: 'pwa-corrected-report-attempt',
    now: '2026-11-13T10:01:00.000Z',
    technicianId: tech.id,
  });
  const accepted = await request(app)
    .post(`/api/visits/${visitId}/complete`)
    .set('Authorization', `Bearer ${token}`)
    .send({ submissionId: corrected.submissionId, snapshot: corrected });

  expect(accepted.status).toBe(200);
  expect(accepted.body).toMatchObject({ acknowledged: true, submissionId: corrected.submissionId, status: 'completed' });
});

it('accepts a PWA snapshot containing equipment, Weigh-In, photo evidence, notes, and checklist findings', async () => {
  const { visitId, token, tech, addressId } = await seedAssignedVisit();
  await pool.query(
    `INSERT INTO catalog_services (service_name, default_price, is_bundle, multiplies_by_system_count)
     VALUES ('AC', 150, false, false)
     ON CONFLICT (service_name) DO UPDATE SET default_price = EXCLUDED.default_price`
  );
  await request(app)
    .patch(`/api/visits/${visitId}/services`)
    .set('Authorization', `Bearer ${token}`)
    .send({ services: [{ systemNumber: 1, serviceName: 'AC' }] });
  await pool.query(
    `INSERT INTO catalog_lineset_configs (config_key, reference_length_ft, adjust_rate_oz_per_ft)
     VALUES ('CANONICAL-LINESET', 15, 0.6)
     ON CONFLICT (config_key) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO weigh_in_data (id, address_id, system_number, lineset_length, factory_line_config)
     VALUES (gen_random_uuid()::text, $1, 1, 25, 'CANONICAL-LINESET')`, [addressId]
  );
  await pool.query(
    `INSERT INTO visit_photos (id, visit_id, system_number, slug, tag, label, category, stored_at)
     VALUES (gen_random_uuid()::text, $1, 1, 'CANONICAL_SCALE', 'SCALE', null, 'weigh_in_scale', null)`, [visitId]
  );
  const detailResponse = await request(app)
    .get(`/api/visits/${visitId}`)
    .set('Authorization', `Bearer ${token}`);
  const draft = createLocalVisitDraft(detailResponse.body, { now: '2026-11-13T10:00:00.000Z' });
  draft.notes = 'Report notes and findings';
  const snapshot = createCompletionSnapshot(draft, {
    id: 'pwa-complete-content-report',
    now: '2026-11-13T10:00:00.000Z',
    technicianId: tech.id,
    checklistAnswers: [{ item: 'gas_meter', answer: 'no', photoCount: 0, reportText: 'gas meter closed/missing' }],
  });

  const response = await request(app)
    .post(`/api/visits/${visitId}/complete`)
    .set('Authorization', `Bearer ${token}`)
    .send({ submissionId: snapshot.submissionId, snapshot });

  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ acknowledged: true, submissionId: snapshot.submissionId, status: 'completed' });
  expect(response.body.weighInData).toEqual(expect.arrayContaining([expect.objectContaining({ systemNumber: 1, linesetLength: 25 })]));
  expect(response.body.photos).toEqual(expect.arrayContaining([expect.objectContaining({ slug: 'CANONICAL_SCALE' })]));
  expect((await pool.query('SELECT status FROM visits WHERE id = $1', [visitId])).rows[0].status).toBe('completed');
});

it('accepts a Report whose thermostat was chosen in the Workspace after the draft was seeded', async () => {
  const { visitId, token, tech } = await seedAssignedVisit();
  await pool.query(
    `INSERT INTO catalog_services (service_name, default_price, is_bundle, multiplies_by_system_count)
     VALUES ('AC', 150, false, false)
     ON CONFLICT (service_name) DO UPDATE SET default_price = EXCLUDED.default_price`
  );
  const serviceSelection = await request(app)
    .patch(`/api/visits/${visitId}/services`)
    .set('Authorization', `Bearer ${token}`)
    .send({ services: [{ systemNumber: 1, serviceName: 'AC' }] });
  expect(serviceSelection.status).toBe(200);
  const catalogItem = { item_name: `CANONICAL-TSTAT-${randomUUID()}`, category: 'thermostat', default_price: 25, tech_supplied: true };
  await pool.query(
    `INSERT INTO catalog_items (item_name, category, default_price, tech_supplied)
     VALUES ($1, 'thermostat', $2, $3)`, [catalogItem.item_name, catalogItem.default_price, catalogItem.tech_supplied]
  );

  // The draft is seeded before the thermostat exists, as when a visit is opened from the Lobby.
  const detailResponse = await request(app)
    .get(`/api/visits/${visitId}`)
    .set('Authorization', `Bearer ${token}`);
  expect(detailResponse.status).toBe(200);
  const draft = createLocalVisitDraft(detailResponse.body, { now: '2026-11-13T10:00:00.000Z' });

  const addItem = await request(app)
    .post(`/api/visits/${visitId}/items`)
    .set('Authorization', `Bearer ${token}`)
    .send({ itemName: catalogItem.item_name, category: 'thermostat', quantity: 1 });
  expect(addItem.status).toBe(200);
  // Same entry the Workspace thermostat section builds from the cached catalog row.
  draft._items = [...(draft._items ?? []), {
    id: addItem.body.id,
    item_name: catalogItem.item_name,
    category: 'thermostat',
    quantity: 1,
    price: catalogItem.default_price,
    tech_supplied: catalogItem.tech_supplied ?? false,
  }];
  draft.totalPrice = addItem.body.totalPrice;
  const snapshot = createCompletionSnapshot(draft, {
    id: 'pwa-canonical-workspace-thermostat',
    now: '2026-11-13T10:00:00.000Z',
    technicianId: tech.id,
  });

  const response = await request(app)
    .post(`/api/visits/${visitId}/complete`)
    .set('Authorization', `Bearer ${token}`)
    .send({ submissionId: snapshot.submissionId, snapshot });

  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({
    acknowledged: true,
    status: 'completed',
    items: [expect.objectContaining({ itemName: catalogItem.item_name, price: 25, techSupplied: true })],
  });
});
