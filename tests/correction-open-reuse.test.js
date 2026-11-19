// CC-16: Finder → Open Correction reuses the visit's open correction, like
// the direct-open path, instead of failing on a second create.
const request = require('supertest');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');
const { seedDispatcherWithToken, seedTechnicianWithToken, seedCompletedVisit } = require('./helpers/seeds');

let openCorrectionFor;
beforeAll(async () => {
  ({ openCorrectionFor } = await import('../frontend/dispatch/src/lib/corrections.mjs'));
});
beforeEach(truncateTables);
afterAll(() => pool.end());

function fakeApi({ open = [] } = {}) {
  const calls = [];
  return {
    calls,
    get: async path => { calls.push(['get', path]); return path.includes('?') ? open : { id: path.split('/').pop() }; },
    post: async (path, body) => { calls.push(['post', path, body]); return { correctionId: 'new-id' }; },
  };
}

describe('openCorrectionFor', () => {
  it('reuses the open correction without creating another', async () => {
    const api = fakeApi({ open: [{ id: 'open-id' }] });
    expect(await openCorrectionFor(api, 'visit 1')).toEqual({ id: 'open-id' });
    expect(api.calls.filter(([method]) => method === 'post')).toEqual([]);
    expect(api.calls[0][1]).toBe('/dispatch/corrections?visitId=visit%201&status=open');
  });

  it('creates a correction when none is open', async () => {
    const api = fakeApi();
    expect(await openCorrectionFor(api, 'v1')).toEqual({ id: 'new-id' });
    expect(api.calls.filter(([method]) => method === 'post')).toEqual([['post', '/dispatch/corrections', { visitId: 'v1' }]]);
  });

  it('opens the same correction twice against the server', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    const api = {
      get: async path => (await request(app).get(`/api${path}`).set('Authorization', `Bearer ${token}`).expect(200)).body,
      post: async (path, body) => (await request(app).post(`/api${path}`).set('Authorization', `Bearer ${token}`).send(body).expect(201)).body,
    };

    const first = await openCorrectionFor(api, visitId);
    const second = await openCorrectionFor(api, visitId);

    expect(second.id).toBe(first.id);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM corrections WHERE visit_id = $1 AND status = 'open'`, [visitId]);
    expect(rows[0].n).toBe(1);
  });
});
