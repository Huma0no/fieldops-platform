const request = require('supertest');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');
const { seedAssignedVisit, seedDispatcherWithToken, seedTechnicianWithToken } = require('./helpers/seeds');

beforeEach(truncateTables);
afterAll(() => pool.end());

async function addService(visitId, serviceName = 'AC', isTemporarily = false) {
  await pool.query(`
    INSERT INTO catalog_services (service_name, default_price, is_bundle, multiplies_by_system_count)
    VALUES ('AC', 150, false, false),
           ('Heat', 100, false, false),
           ('Cancel', 0, false, false)
    ON CONFLICT (service_name) DO NOTHING
  `);
  await pool.query(
    `INSERT INTO visit_services (id, visit_id, service_name, is_finish, is_temporarily, price)
     VALUES (gen_random_uuid()::text, $1, $2, false, $3, 150)`,
    [visitId, serviceName, isTemporarily]
  );
  await pool.query(
    `UPDATE visits SET total_price = 150 WHERE id = $1`,
    [visitId]
  );
}

// ── POST /api/visits/:id/complete ────────────────────────────────────────────

describe('POST /api/visits/:id/complete', () => {
  it('completes a visit with AC service — returns report JSON and sets status=completed', async () => {
    const { visitId, token, street } = await seedAssignedVisit();
    await addService(visitId, 'AC');

    const res = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(visitId);
    expect(res.body.status).toBe('completed');
    expect(res.body.completedAt).toBeTruthy();
    expect(res.body.address).toBeDefined();
    expect(res.body.systems).toBeDefined();
    expect(res.body.services[0].serviceName).toBe('AC');

    const row = await pool.query('SELECT status, completed_at FROM visits WHERE id = $1', [visitId]);
    expect(row.rows[0].status).toBe('completed');
    expect(row.rows[0].completed_at).toBeTruthy();
  });

  it('sets status=temporarily when is_temporarily=true on the service', async () => {
    const { visitId, token } = await seedAssignedVisit();
    await addService(visitId, 'AC', true);

    const res = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('temporarily');
  });

  it('sets status=cancelled when service is Cancel', async () => {
    const { visitId, token } = await seedAssignedVisit();
    await addService(visitId, 'Cancel');

    const res = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
  });

  it('is idempotent — second call on terminal visit returns report without error', async () => {
    const { visitId, token } = await seedAssignedVisit();
    await addService(visitId, 'AC');

    await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`);

    const res = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
  });

  it('idempotency check fires before ownership check — different token still gets 200 on terminal visit', async () => {
    const { visitId, token } = await seedAssignedVisit();
    await addService(visitId, 'AC');

    // Complete it with the real token
    await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`);

    // A second technician retrying (offline queue scenario) — should get the same result back
    const { token: otherToken } = await seedTechnicianWithToken({ name: 'Other-Tech' });
    const res = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
  });

  it('returns 400 if no service is selected', async () => {
    const { visitId, token } = await seedAssignedVisit();

    const res = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No service selected');
  });

  it('returns 403 if technician is not the assignee', async () => {
    const { visitId } = await seedAssignedVisit();
    const { token: otherToken } = await seedTechnicianWithToken({ name: 'Not-Assignee' });
    await addService(visitId, 'AC');

    const res = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown visit', async () => {
    const { token } = await seedAssignedVisit();

    const res = await request(app)
      .post(`/api/visits/nonexistent-id/complete`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('notifies all dispatchers/owners on completion', async () => {
    const { visitId, token } = await seedAssignedVisit();
    await addService(visitId, 'AC');
    const { dispatcher } = await seedDispatcherWithToken();

    await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`);

    const notifs = await pool.query(
      `SELECT * FROM notifications WHERE recipient_id = $1 AND type = 'completion_received'`,
      [dispatcher.id]
    );
    expect(notifs.rows).toHaveLength(1);
    expect(notifs.rows[0].body).toContain('completed');
  });

  it('expires pending transfers and notifies recipient on completion', async () => {
    const { visitId, token, tech } = await seedAssignedVisit();
    await addService(visitId, 'AC');
    const { tech: toTech } = await seedTechnicianWithToken({ name: 'Transfer-Target' });

    await pool.query(
      `INSERT INTO transfers (id, visit_id, from_tech_id, to_tech_id, status, created_at)
       VALUES (gen_random_uuid()::text, $1, $2, $3, 'pending', $4)`,
      [visitId, tech.id, toTech.id, new Date().toISOString()]
    );

    await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`);

    const xfer = await pool.query(
      `SELECT status FROM transfers WHERE visit_id = $1`,
      [visitId]
    );
    expect(xfer.rows[0].status).toBe('expired');

    const notif = await pool.query(
      `SELECT * FROM notifications WHERE recipient_id = $1 AND type = 'transfer_expired'`,
      [toTech.id]
    );
    expect(notif.rows).toHaveLength(1);
    expect(notif.rows[0].body).toContain('expired');
  });
});

// ── GET /api/visits/:id/report-preview ───────────────────────────────────────

describe('GET /api/visits/:id/report-preview', () => {
  it('returns { reportText: "..." } for the assignee', async () => {
    const { visitId, token } = await seedAssignedVisit();
    await addService(visitId, 'AC');

    const res = await request(app)
      .get(`/api/visits/${visitId}/report-preview`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(typeof res.body.reportText).toBe('string');
    expect(res.body.reportText.split(',')).toHaveLength(10);
  });

  it('allows dispatcher to access report-preview', async () => {
    const { visitId } = await seedAssignedVisit();
    await addService(visitId, 'AC');
    const { token: dispToken } = await seedDispatcherWithToken();

    const res = await request(app)
      .get(`/api/visits/${visitId}/report-preview`)
      .set('Authorization', `Bearer ${dispToken}`);

    expect(res.status).toBe(200);
    expect(res.body.reportText).toBeDefined();
  });

  it('returns 403 if technician is not the assignee', async () => {
    const { visitId } = await seedAssignedVisit();
    const { token: otherToken } = await seedTechnicianWithToken({ name: 'NotAssignee' });

    const res = await request(app)
      .get(`/api/visits/${visitId}/report-preview`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown visit', async () => {
    const { token } = await seedAssignedVisit();

    const res = await request(app)
      .get(`/api/visits/bad-id/report-preview`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

// ── GET /api/visits/:id/download ─────────────────────────────────────────────

describe('GET /api/visits/:id/download', () => {
  it('returns full JSON with nested visit data for assignee', async () => {
    const { visitId, token } = await seedAssignedVisit();
    await addService(visitId, 'AC');

    const res = await request(app)
      .get(`/api/visits/${visitId}/download`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(visitId);
    expect(res.body.address).toBeDefined();
    expect(res.body.systems).toBeDefined();
    expect(res.body.services).toBeDefined();
    expect(res.body.items).toBeDefined();
    expect(res.body.photos).toBeDefined();
    expect(res.body.weighInData).toBeDefined();
  });

  it('allows dispatcher to download', async () => {
    const { visitId } = await seedAssignedVisit();
    await addService(visitId, 'AC');
    const { token: dispToken } = await seedDispatcherWithToken();

    const res = await request(app)
      .get(`/api/visits/${visitId}/download`)
      .set('Authorization', `Bearer ${dispToken}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(visitId);
  });

  it('returns 403 if technician is not the assignee', async () => {
    const { visitId } = await seedAssignedVisit();
    const { token: otherToken } = await seedTechnicianWithToken({ name: 'NotAssignee2' });

    const res = await request(app)
      .get(`/api/visits/${visitId}/download`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(403);
  });
});
