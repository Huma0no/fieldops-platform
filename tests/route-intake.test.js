const request = require('supertest');
const app = require('../src/index');
const { pool: appPool } = require('../src/db/pool');
const { pool, truncateTables } = require('./helpers/db');
const { seedDispatcherWithToken } = require('./helpers/seeds');
const { makeRoutePdf } = require('./fixtures/route-pdf');
const { route } = require('./fixtures/synthetic-route');
const { matchModel } = require('../src/services/modelMatch');

jest.setTimeout(180000);

beforeAll(async () => {
  for (const [model, unitType, brand] of [
    ['ML196UH045XE36B', 'furnace', 'Lennox'], ['5TTR5024', 'condenser', 'Trane'], ['5TTR5036', 'condenser', 'Trane'],
  ]) {
    await pool.query('INSERT INTO catalog_equipment (model, unit_type, brand) VALUES ($1, $2, $3) ON CONFLICT (model) DO NOTHING', [model, unitType, brand]);
  }
  for (const name of ['FIN180P', 'Dehum']) {
    await pool.query(`INSERT INTO catalog_items (item_name, category, default_price, tech_supplied) VALUES ($1, 'accessory', 0, true) ON CONFLICT (item_name) DO NOTHING`, [name]);
  }
});
beforeEach(truncateTables);
afterAll(async () => { await Promise.all([pool.end(), appPool.end()]); });

it('matches OCR model numbers to the catalog, tolerating look-alike and extra leading characters', () => {
  const models = ['5TTR5024', '5TTR5036', 'ML196UH045XE36B', '5TXCB003AS3'];
  expect(matchModel('5TXCBO03AS3', models)).toMatchObject({ model: '5TXCB003AS3', matched: true });
  expect(matchModel('S5TTR5024A1', models)).toMatchObject({ model: '5TTR5024', matched: true });
  expect(matchModel('ML196UHO45XE36BK', models)).toMatchObject({ model: 'ML196UH045XE36B', matched: true });
  expect(matchModel('XYZ123', models)).toMatchObject({ model: null, matched: false });
});

it('reads an image-only CP3000 route sheet and keeps every field it read', async () => {
  const { token } = await seedDispatcherWithToken();
  const res = await request(app)
    .post('/api/dispatch/parse-pdf')
    .set('Authorization', `Bearer ${token}`)
    .attach('pdf', makeRoutePdf(route), 'route.pdf');

  expect(res.status).toBe(200);
  expect(res.body.route).toEqual({ technician: 'SAMPLE TECH', date: '2026-06-24' });
  const calls = res.body.calls;
  expect(calls.map(c => c.orderNumber)).toEqual(['7100001', '7100002', '7100003', '7100004']);
  expect(calls[0]).toMatchObject({
    scheduledTime: '2026-06-24T08:00:00', address: '101 TESTWOOD LN', city: 'SAMPLEVILLE', state: 'TX',
    subdivision: 'ELM GROVE', builder: 'STONEBRIDGE', builderContactName: 'ALEX EXAMPLE',
    builderContactPhone: '555 010 0001', workType: 'AC & Heating Startup',
    systems: [{ indoorModel: 'ML196UH045XE36B', coilModel: 'CX35-36B-6F', outdoorModel: '5TTR5024' }],
  });
  // A confident catalog match is used and its OCR text kept; coils are always checked.
  expect(calls[0].ocr).toEqual({ 'systems.0.indoorModel': 'ML196UH045XE36BK', 'systems.0.outdoorModel': '5TTR5024A1' });
  expect(calls[0].flags['systems.0.outdoorModel']).toBeUndefined();
  expect(calls[0].flags['systems.0.coilModel']).toMatch(/not in catalog/);
  expect(calls[0].companyNotes).toMatch(/GATE CODE 0000/);
  expect(calls[0].companyNotes).toMatch(/Payment: ALL PAYMENT TYPES/);
  expect(calls[0].companyNotes).toMatch(/ROUGH: J SAMPLE 1\/2\/26/);
  // Two equipment lines = two systems; "#1210" inside notes is not a job; extra equipment suggests accessories.
  expect(calls[1]).toMatchObject({ zip: '77000', builderContactPhone: '555-010-0002' });
  expect(calls[1].systems.map(sys => sys.outdoorModel)).toEqual(['5TTR5024', '5TTR5036']);
  expect(calls[1].companyNotes).toMatch(/#1210 filter note/);
  expect(calls[1].preIdentifiedAccessories).toEqual(['Dehum', 'FIN180P']);
  // Block continued across the page break; truncated subdivision and unknown models flagged.
  expect(calls[2].companyNotes).toMatch(/BLOCK CONTINUES FROM PAGE 1/);
  expect(calls[2].systems).toEqual([{ indoorModel: 'GR9S960804CN', coilModel: 'CHPTA4830C*3', outdoorModel: 'GLXS5BA4210' }]);
  expect(calls[2].flags.subdivision).toMatch(/truncated/);
  expect(calls[2].flags['systems.0.indoorModel']).toMatch(/not in catalog/);
  // Time line not in the sheet: still a call, anchored on the job number, flagged.
  expect(calls[3]).toMatchObject({ scheduledTime: '', address: '404 FICTION WAY', builder: 'STONEBRIDGE' });
  expect(calls[3].flags.scheduledTime).toMatch(/time line not read/);
  expect(calls[3].flags.builder).toMatch(/guessed/);
  // No invented sample data.
  expect(JSON.stringify(calls)).not.toMatch(/MAPLE ST|ORD-00|DR HORTON|OAK AVE/);

  const confirm = await request(app)
    .post(`/api/dispatch/batch/${res.body.batchId}/call/2/confirm`)
    .set('Authorization', `Bearer ${token}`)
    .send({ ...calls[1], preIdentifiedAccessories: [] });
  expect(confirm.status).toBe(200);
  const visit = await pool.query('SELECT company_notes, contact_name, contact_phone, scheduled_time FROM visits WHERE id = $1', [confirm.body.visitId]);
  expect(visit.rows[0]).toMatchObject({ contact_name: 'JORDAN SAMPLE', contact_phone: '555-010-0002', scheduled_time: '2026-06-24T09:30:00' });
  expect(visit.rows[0].company_notes).toMatch(/TWO SYSTEMS/);
  const systems = await pool.query('SELECT system_number, indoor_model, outdoor_model FROM visit_systems WHERE visit_id = $1 ORDER BY 1', [confirm.body.visitId]);
  expect(systems.rows.map(r => r.outdoor_model)).toEqual(['5TTR5024', '5TTR5036']);
});
