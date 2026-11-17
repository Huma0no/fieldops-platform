const request = require('supertest');
const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const app = require('../src/index');
const { pool: appPool } = require('../src/db/pool');
const { pool, truncateTables } = require('./helpers/db');
const { seedAssignedVisit, seedDispatcherWithToken, seedTechnicianWithToken } = require('./helpers/seeds');

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

function uploadPhoto({ visitId, token }, photoId, bytes = 'jpeg-bytes') {
  return request(app)
    .post(`/api/visits/${visitId}/photos`)
    .set('Authorization', `Bearer ${token}`)
    .field('photoId', photoId)
    .field('category', 'site_evidence')
    .field('tag', 'NO_PDRAIN')
    .field('slug', 'SITE_NO_PDRAIN')
    .attach('photo', Buffer.from(bytes), 'photo.jpg');
}

it('accepts a Report whose photo is still on the phone, then stores the photo for Dispatch', async () => {
  const visit = await seedAssignedVisit();
  const photoId = randomUUID();
  const detail = await request(app).get(`/api/visits/${visit.visitId}`).set('Authorization', `Bearer ${visit.token}`);
  const draft = drafts.createLocalVisitDraft({ ...detail.body, technicianId: visit.tech.id }, { now: '2026-11-17T10:00:00.000Z' });
  drafts.tapService(draft._service, null, 'prestart');
  draft._service.rows = [{ systemNumber: 1, serviceName: 'Prestart', isFinish: false, isTemporarily: false, price: 20 }];
  draft.totalPrice = 20;
  draft.evidenceRefs = [{ id: photoId, slug: 'SITE_NO_PDRAIN', tag: 'NO_PDRAIN', label: null, category: 'site_evidence', systemNumber: null, storedAt: null }];
  const snapshot = createCompletionSnapshot(draft, { id: `photo-${photoId}`, now: '2026-11-17T10:00:00.000Z' });

  const accepted = await request(app)
    .post(`/api/visits/${visit.visitId}/complete`)
    .set('Authorization', `Bearer ${visit.token}`)
    .send({ submissionId: snapshot.submissionId, snapshot });
  expect(accepted.status).toBe(200);
  const pending = await pool.query('SELECT stored_at FROM visit_photos WHERE id = $1', [photoId]);
  expect(pending.rows).toEqual([{ stored_at: null }]);

  const { token: dispatcherToken } = await seedDispatcherWithToken();
  const notYet = await request(app).get(`/api/visits/${visit.visitId}/photos/${photoId}`).set('Authorization', `Bearer ${dispatcherToken}`);
  expect(notYet.status).toBe(404);

  // The visit is completed; the phone still delivers its photo.
  const uploaded = await uploadPhoto(visit, photoId);
  expect(uploaded.status).toBe(200);
  expect(uploaded.body).toEqual({ photoId, slug: 'SITE_NO_PDRAIN', storedAt: `${visit.visitId}/${photoId}.jpg` });

  const image = await request(app).get(`/api/visits/${visit.visitId}/photos/${photoId}`).set('Authorization', `Bearer ${dispatcherToken}`);
  expect(image.status).toBe(200);
  expect(Buffer.from(image.body).toString()).toBe('jpeg-bytes');
  const report = await request(app).get(`/api/visits/${visit.visitId}`).set('Authorization', `Bearer ${dispatcherToken}`);
  expect(report.body.photos).toEqual([expect.objectContaining({ id: photoId, storedAt: `${visit.visitId}/${photoId}.jpg` })]);
});

it('stores a retried upload once', async () => {
  const visit = await seedAssignedVisit();
  const photoId = randomUUID();
  expect((await uploadPhoto(visit, photoId, 'first')).status).toBe(200);
  const retry = await uploadPhoto(visit, photoId, 'second');
  expect(retry.status).toBe(200);
  const rows = await pool.query('SELECT id FROM visit_photos WHERE visit_id = $1', [visit.visitId]);
  expect(rows.rows).toHaveLength(1);
  const image = await request(app).get(`/api/visits/${visit.visitId}/photos/${photoId}`).set('Authorization', `Bearer ${visit.token}`);
  expect(Buffer.from(image.body).toString()).toBe('first');
});

it('keeps photos to their visit and their technician', async () => {
  const visit = await seedAssignedVisit();
  const other = await seedAssignedVisit();
  const photoId = randomUUID();
  expect((await uploadPhoto(visit, photoId)).status).toBe(200);
  expect((await uploadPhoto(other, photoId)).status).toBe(409);

  const { token: strangerToken } = await seedTechnicianWithToken({ name: 'Stranger' });
  const denied = await request(app).get(`/api/visits/${visit.visitId}/photos/${photoId}`).set('Authorization', `Bearer ${strangerToken}`);
  expect(denied.status).toBe(403);
  expect((await request(app)
    .post(`/api/visits/${visit.visitId}/photos`)
    .set('Authorization', `Bearer ${strangerToken}`)
    .field('category', 'site_evidence').field('tag', 'X')
    .attach('photo', Buffer.from('x'), 'x.jpg')).status).toBe(403);
});

it('stores a photo and accepts its Report when both arrive at the same time', async () => {
  const visit = await seedAssignedVisit();
  const photoId = randomUUID();
  const detail = await request(app).get(`/api/visits/${visit.visitId}`).set('Authorization', `Bearer ${visit.token}`);
  const draft = drafts.createLocalVisitDraft({ ...detail.body, technicianId: visit.tech.id }, { now: '2026-11-17T10:00:00.000Z' });
  drafts.tapService(draft._service, null, 'prestart');
  draft._service.rows = [{ systemNumber: 1, serviceName: 'Prestart', isFinish: false, isTemporarily: false, price: 20 }];
  draft.totalPrice = 20;
  draft.evidenceRefs = [{ id: photoId, slug: 'SITE_NO_PDRAIN', tag: 'NO_PDRAIN', label: null, category: 'site_evidence', systemNumber: null, storedAt: null }];
  const snapshot = createCompletionSnapshot(draft, { id: `together-${photoId}`, now: '2026-11-17T10:00:00.000Z' });

  const [report, photo] = await Promise.all([
    request(app).post(`/api/visits/${visit.visitId}/complete`).set('Authorization', `Bearer ${visit.token}`)
      .send({ submissionId: snapshot.submissionId, snapshot }),
    uploadPhoto(visit, photoId),
  ]);
  expect(report.status).toBe(200);
  expect(photo.status).toBe(200);
  const stored = await pool.query('SELECT stored_at FROM visit_photos WHERE id = $1', [photoId]);
  expect(stored.rows[0].stored_at).toBe(`${visit.visitId}/${photoId}.jpg`);
});

it('accepts a reported photo from the original technician after the visit was transferred', async () => {
  const visit = await seedAssignedVisit();
  const photoId = randomUUID();
  const detail = await request(app).get(`/api/visits/${visit.visitId}`).set('Authorization', `Bearer ${visit.token}`);
  const draft = drafts.createLocalVisitDraft({ ...detail.body, technicianId: visit.tech.id }, { now: '2026-11-17T10:00:00.000Z' });
  drafts.tapService(draft._service, null, 'prestart');
  draft._service.rows = [{ systemNumber: 1, serviceName: 'Prestart', isFinish: false, isTemporarily: false, price: 20 }];
  draft.totalPrice = 20;
  draft.evidenceRefs = [{ id: photoId, slug: 'SITE_NO_PDRAIN', tag: 'NO_PDRAIN', label: null, category: 'site_evidence', systemNumber: null, storedAt: null }];
  const snapshot = createCompletionSnapshot(draft, { id: `moved-${photoId}`, now: '2026-11-17T10:00:00.000Z' });
  expect((await request(app).post(`/api/visits/${visit.visitId}/complete`).set('Authorization', `Bearer ${visit.token}`)
    .send({ submissionId: snapshot.submissionId, snapshot })).status).toBe(200);

  const { token: dispatcherToken } = await seedDispatcherWithToken();
  const { tech: newTech } = await seedTechnicianWithToken({ name: 'New owner' });
  expect((await request(app).patch(`/api/dispatch/visits/${visit.visitId}/reassign`)
    .set('Authorization', `Bearer ${dispatcherToken}`).send({ technicianId: newTech.id })).status).toBe(200);

  // Not in that Report: still refused.
  expect((await uploadPhoto(visit, randomUUID())).status).toBe(403);
  const uploaded = await uploadPhoto(visit, photoId);
  expect(uploaded.status).toBe(200);
  expect(uploaded.body.storedAt).toBe(`${visit.visitId}/${photoId}.jpg`);
});
