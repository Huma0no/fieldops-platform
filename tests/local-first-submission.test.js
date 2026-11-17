// A Report built and priced entirely on the device (no Workspace writes to the
// server) is accepted as is: same prices, no PP-01 discrepancy, and the
// companion the technician turned off stays off.
const request = require('supertest');
const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const app = require('../src/index');
const { pool: appPool } = require('../src/db/pool');
const { pool, truncateTables } = require('./helpers/db');
const { seedAssignedVisit } = require('./helpers/seeds');

let drafts;
let pricing;
let createCompletionSnapshot;
const tag = randomUUID().slice(0, 8);
const BOARD = `LF-BOARD-${tag}`;
const COMPANIONS = [`LF-COMP-A-${tag}`, `LF-COMP-B-${tag}`];
const TSTAT = `LF-TSTAT-${tag}`;

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
  pricing = await import('../frontend/shared/pricing.mjs');

  await pool.query(
    `INSERT INTO catalog_services (service_name, default_price, is_bundle, multiplies_by_system_count) VALUES
       ('AC', 30, false, true), ('Finish', 0, false, false)
     ON CONFLICT (service_name) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO catalog_items (item_name, category, default_price, tech_supplied) VALUES
       ($1, 'accessory', 30, true), ($2, 'accessory', 10, true), ($3, 'accessory', 10, false), ($4, 'thermostat', 0, true)`,
    [BOARD, ...COMPANIONS, TSTAT]
  );
  for (const companion of COMPANIONS) {
    await pool.query(
      `INSERT INTO catalog_item_relations (item_name, relation_type, related_item_name) VALUES ($1, 'companion', $2)`,
      [BOARD, companion]
    );
  }
});

beforeEach(truncateTables);

afterAll(async () => {
  await truncateTables();
  await pool.query('DELETE FROM catalog_item_relations WHERE item_name = $1', [BOARD]);
  await pool.query('DELETE FROM catalog_items WHERE item_name = ANY($1)', [[BOARD, ...COMPANIONS, TSTAT]]);
  await Promise.all([pool.end(), appPool.end()]);
});

it('accepts a Report priced on the device with no discrepancy, keeping a companion off', async () => {
  const { visitId, token, tech } = await seedAssignedVisit();
  const detail = await request(app).get(`/api/visits/${visitId}`).set('Authorization', `Bearer ${token}`);
  expect(detail.status).toBe(200);
  const draft = drafts.createLocalVisitDraft({ ...detail.body, technicianId: tech.id }, { now: '2026-11-17T10:00:00.000Z' });

  const [services, items, relations] = await Promise.all([
    pool.query('SELECT * FROM catalog_services'),
    pool.query('SELECT * FROM catalog_items'),
    pool.query('SELECT * FROM catalog_item_relations'),
  ]);
  const byName = name => items.rows.find(row => row.item_name === name);

  // Workspace edits, local only.
  drafts.tapService(draft._service, null, 'ac');
  drafts.tapService(draft._service, null, 'finish');
  drafts.addLocalVisitDraftItem(draft, byName(BOARD), { catalogItems: items.rows, itemRelations: relations.rows });
  const turnedOff = draft._items.find(item => item.item_name === COMPANIONS[0]);
  drafts.removeLocalVisitDraftItem(draft, turnedOff.id, relations.rows);
  drafts.addLocalVisitDraftItem(draft, byName(TSTAT), { catalogItems: items.rows, itemRelations: relations.rows });
  const tstat = draft._items.find(item => item.item_name === TSTAT);
  drafts.setLocalVisitDraftItemQuantity(draft, tstat.id, 2);

  // Local pricing, as the Workspace's repriceVisit does.
  const numbers = drafts.systemNumbersOf(draft);
  const priced = pricing.priceVisit({
    services: drafts.serviceRowsFromState(draft._service, numbers),
    items: draft._items.map(item => ({ itemName: item.item_name, category: item.category, quantity: item.quantity })),
    systemCount: numbers.length,
    catalog: { services: services.rows, items: items.rows },
  });
  draft._service.rows = priced.services;
  draft._items = draft._items.map((item, i) => ({ ...item, price: priced.items[i].price, tech_supplied: priced.items[i].techSupplied }));
  draft.totalPrice = priced.total;

  const snapshot = createCompletionSnapshot(draft, { id: `local-first-${tag}`, now: '2026-11-17T10:00:00.000Z' });
  const res = await request(app)
    .post(`/api/visits/${visitId}/complete`)
    .set('Authorization', `Bearer ${token}`)
    .send({ submissionId: snapshot.submissionId, snapshot });
  expect(res.status).toBe(200);
  expect(res.body.priceDiscrepancies).toEqual([]);
  expect(res.body.totalPrice).toBe(priced.total);
  const stored = await pool.query('SELECT item_name, quantity FROM visit_items WHERE visit_id = $1 ORDER BY item_name', [visitId]);
  expect(stored.rows).toEqual([
    { item_name: BOARD, quantity: 1 },
    { item_name: COMPANIONS[1], quantity: 1 },
    { item_name: TSTAT, quantity: 2 },
  ].sort((a, b) => a.item_name.localeCompare(b.item_name)));
});
