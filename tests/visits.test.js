const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');
const { seedTechnicianWithToken, seedDispatcherWithToken, seedInLobbyVisit, seedTech, seedToken } = require('./helpers/seeds');

beforeEach(truncateTables);
afterAll(() => pool.end());

// ── GET /api/visits/lobby ────────────────────────────────────────────────────
describe('GET /api/visits/lobby', () => {
  it('returns [] when no in_lobby visits', async () => {
    const { token } = await seedTechnicianWithToken();
    const res = await request(app).get('/api/visits/lobby').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns visit with builder tag always present', async () => {
    const { token } = await seedTechnicianWithToken();
    await seedInLobbyVisit();
    const res = await request(app).get('/api/visits/lobby').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const v = res.body[0];
    expect(v.id).toBeDefined();
    expect(v.address.street).toBeDefined();
    expect(v.hasMultipleSystems).toBe(false);
    expect(v.isDeferred).toBe(false);
    expect(v.tags).toContain('builder');
    expect(v.tags).not.toContain('multiSystem');
    expect(v.tags).not.toContain('a2l');
  });

  it('includes multiSystem tag when has_multiple_systems is true', async () => {
    const { token } = await seedTechnicianWithToken();
    await seedInLobbyVisit({ systemCount: 2 });
    const res = await request(app).get('/api/visits/lobby').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body[0].hasMultipleSystems).toBe(true);
    expect(res.body[0].tags).toContain('multiSystem');
  });

  it('includes a2l tag when visit has a2l equipment', async () => {
    const { token } = await seedTechnicianWithToken();
    await seedInLobbyVisit({ withA2l: true });
    const res = await request(app).get('/api/visits/lobby').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body[0].tags).toContain('a2l');
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/visits/lobby');
    expect(res.status).toBe(401);
  });
});

// ── POST /api/visits/:id/claim ───────────────────────────────────────────────
describe('POST /api/visits/:id/claim', () => {
  it('assigns visit to technician and returns it', async () => {
    const { tech, token } = await seedTechnicianWithToken();
    const { visitId } = await seedInLobbyVisit();

    const res = await request(app)
      .post(`/api/visits/${visitId}/claim`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(visitId);
    expect(res.body.technicianId).toBe(tech.id);
    expect(res.body.status).toBe('assigned');
    expect(res.body.address.street).toBeDefined();
    expect(res.body.tags).toContain('builder');

    const row = await pool.query('SELECT status, technician_id FROM visits WHERE id = $1', [visitId]);
    expect(row.rows[0].status).toBe('assigned');
    expect(row.rows[0].technician_id).toBe(tech.id);
  });

  it('returns 404 for unknown visit id', async () => {
    const { token } = await seedTechnicianWithToken();
    const res = await request(app)
      .post('/api/visits/nonexistent-id/claim')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Visit not found');
  });

  it('returns 409 when visit already claimed', async () => {
    const { token: tokenA } = await seedTechnicianWithToken({ name: 'Tech-A' });
    const { token: tokenB } = await seedTechnicianWithToken({ name: 'Tech-B' });
    const { visitId } = await seedInLobbyVisit();

    await request(app).post(`/api/visits/${visitId}/claim`).set('Authorization', `Bearer ${tokenA}`);

    const res = await request(app)
      .post(`/api/visits/${visitId}/claim`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('This visit was just claimed by another technician');
  });

  it('returns 403 for dispatcher role', async () => {
    const { token } = await seedDispatcherWithToken();
    const { visitId } = await seedInLobbyVisit();
    const res = await request(app)
      .post(`/api/visits/${visitId}/claim`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

// ── GET /api/visits/mine ─────────────────────────────────────────────────────
describe('GET /api/visits/mine', () => {
  it('returns assigned visits for the authenticated technician', async () => {
    const { tech, token } = await seedTechnicianWithToken();
    const { visitId } = await seedInLobbyVisit();
    await request(app).post(`/api/visits/${visitId}/claim`).set('Authorization', `Bearer ${token}`);

    const res = await request(app).get('/api/visits/mine').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const v = res.body[0];
    expect(v.id).toBe(visitId);
    expect(v.technicianId).toBe(tech.id);
    expect(v.status).toBe('assigned');
    expect(v.address.street).toBeDefined();
    expect(v.tags).toContain('builder');
  });

  it('excludes visits assigned to other technicians', async () => {
    const { token: tokenA } = await seedTechnicianWithToken({ name: 'Tech-A' });
    const { token: tokenB } = await seedTechnicianWithToken({ name: 'Tech-B' });
    const { visitId } = await seedInLobbyVisit();
    await request(app).post(`/api/visits/${visitId}/claim`).set('Authorization', `Bearer ${tokenA}`);

    const res = await request(app).get('/api/visits/mine').set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('returns deferred visits before non-deferred visits', async () => {
    const { token } = await seedTechnicianWithToken();
    const { visitId: idA } = await seedInLobbyVisit();
    const { visitId: idB } = await seedInLobbyVisit();
    await request(app).post(`/api/visits/${idA}/claim`).set('Authorization', `Bearer ${token}`);
    await request(app).post(`/api/visits/${idB}/claim`).set('Authorization', `Bearer ${token}`);
    await pool.query('UPDATE visits SET is_deferred = true WHERE id = $1', [idB]);

    const res = await request(app).get('/api/visits/mine').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body[0].id).toBe(idB);
    expect(res.body[0].isDeferred).toBe(true);
    expect(res.body[1].id).toBe(idA);
  });

  it('returns 403 for dispatcher role', async () => {
    const { token } = await seedDispatcherWithToken();
    const res = await request(app).get('/api/visits/mine').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

// ── POST /api/visits/:id/start ───────────────────────────────────────────────
describe('POST /api/visits/:id/start', () => {
  it('transitions assigned visit to in_progress', async () => {
    const { token } = await seedTechnicianWithToken();
    const { visitId } = await seedInLobbyVisit();
    await request(app).post(`/api/visits/${visitId}/claim`).set('Authorization', `Bearer ${token}`);

    const res = await request(app)
      .post(`/api/visits/${visitId}/start`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: visitId, status: 'in_progress' });

    const row = await pool.query('SELECT status FROM visits WHERE id = $1', [visitId]);
    expect(row.rows[0].status).toBe('in_progress');
  });

  it('returns 403 if wrong technician tries to start', async () => {
    const { token: tokenA } = await seedTechnicianWithToken({ name: 'Tech-A' });
    const { token: tokenB } = await seedTechnicianWithToken({ name: 'Tech-B' });
    const { visitId } = await seedInLobbyVisit();
    await request(app).post(`/api/visits/${visitId}/claim`).set('Authorization', `Bearer ${tokenA}`);

    const res = await request(app)
      .post(`/api/visits/${visitId}/start`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('This visit is not assigned to you');
  });

  it('returns 400 if visit is not in assigned status', async () => {
    const { token } = await seedTechnicianWithToken();
    const { visitId } = await seedInLobbyVisit();
    await request(app).post(`/api/visits/${visitId}/claim`).set('Authorization', `Bearer ${token}`);
    await request(app).post(`/api/visits/${visitId}/start`).set('Authorization', `Bearer ${token}`);

    const res = await request(app)
      .post(`/api/visits/${visitId}/start`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Visit cannot be started — current status: in_progress');
  });

  it('returns 404 for unknown visit', async () => {
    const { token } = await seedTechnicianWithToken();
    const res = await request(app)
      .post('/api/visits/nonexistent-id/start')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

// ── GET /api/visits/:id ──────────────────────────────────────────────────────
describe('GET /api/visits/:id', () => {
  it('returns full visit detail with nested arrays', async () => {
    const { token } = await seedTechnicianWithToken();
    const { visitId } = await seedInLobbyVisit({ systemCount: 1 });
    await request(app).post(`/api/visits/${visitId}/claim`).set('Authorization', `Bearer ${token}`);

    const res = await request(app)
      .get(`/api/visits/${visitId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const v = res.body;
    expect(v.id).toBe(visitId);
    expect(v.status).toBe('assigned');
    expect(v.totalPrice).toBe(0);
    expect(v.address.street).toBeDefined();
    expect(v.address.city).toBeDefined();
    expect(Array.isArray(v.systems)).toBe(true);
    expect(v.systems).toHaveLength(1);
    expect(v.systems[0].systemNumber).toBe(1);
    expect(Array.isArray(v.services)).toBe(true);
    expect(Array.isArray(v.items)).toBe(true);
    expect(Array.isArray(v.photos)).toBe(true);
    expect(Array.isArray(v.weighInData)).toBe(true);
  });

  it('returns persisted item ids, notes, and weigh-in data for Workspace rehydration', async () => {
    const { token } = await seedTechnicianWithToken();
    const { visitId, addressId } = await seedInLobbyVisit({ systemCount: 1 });
    const itemName = `Rehydration Accessory ${crypto.randomUUID()}`;
    const configKey = `REHYDRATION-${crypto.randomUUID()}`;
    await request(app).post(`/api/visits/${visitId}/claim`).set('Authorization', `Bearer ${token}`);
    await pool.query(`UPDATE visits SET notes = 'Existing field note' WHERE id = $1`, [visitId]);
    await pool.query(`
      INSERT INTO catalog_items (item_name, category, default_price, tech_supplied)
      VALUES ($1, 'accessory', 15, true)
    `, [itemName]);
    const item = await pool.query(`
      INSERT INTO visit_items (id, visit_id, item_name, category, description, quantity, price, tech_supplied)
      VALUES (gen_random_uuid()::text, $1, $2, 'accessory', 'Installed at return', 2, 15, true)
      RETURNING id
    `, [visitId, itemName]);
    await pool.query(`
      INSERT INTO catalog_lineset_configs (config_key, reference_length_ft, adjust_rate_oz_per_ft)
      VALUES ($1, 25, 0.5)
    `, [configKey]);
    await pool.query(`
      INSERT INTO weigh_in_data
        (id, address_id, system_number, lineset_length, factory_line_config, approx_adjust_oz,
         adjusted_oz, fan_speed_cfm, liquid_line_temp, suction_line_temp, condenser_sat_temp,
         subcooling_value, oem_subcooling_goal, subcooling_deviation)
      VALUES
        (gen_random_uuid()::text, $1, 1, 35, $2, 5, 82, 1200, 90, 55, 105, 18, 10, 8)
    `, [addressId, configKey]);

    const res = await request(app)
      .get(`/api/visits/${visitId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.notes).toBe('Existing field note');
    expect(res.body.items).toEqual([expect.objectContaining({
      id: item.rows[0].id,
      itemName,
      description: 'Installed at return',
      quantity: 2,
      price: 15,
    })]);
    expect(res.body.weighInData).toEqual([expect.objectContaining({
      addressId,
      systemNumber: 1,
      linesetLength: 35,
      factoryLineConfig: configKey,
      fanSpeedCfm: 1200,
      subcoolingValue: 18,
    })]);

    const remove = await request(app)
      .delete(`/api/visits/${visitId}/items/${res.body.items[0].id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(remove.status).toBe(200);
    expect((await pool.query('SELECT id FROM visit_items WHERE visit_id = $1', [visitId])).rows).toHaveLength(0);
  });

  it('suppresses Weigh-In photo metadata for a cancelled visit without deleting stored evidence', async () => {
    const { token } = await seedTechnicianWithToken();
    const { visitId } = await seedInLobbyVisit({ systemCount: 1 });
    await request(app).post(`/api/visits/${visitId}/claim`).set('Authorization', `Bearer ${token}`);
    await pool.query("UPDATE visits SET status = 'cancelled', total_price = 0 WHERE id = $1", [visitId]);
    await pool.query(
      `INSERT INTO visit_photos (id, visit_id, system_number, slug, tag, label, category, stored_at)
       VALUES (gen_random_uuid()::text, $1, 1, 'CANCELLED-SCALE', 'SCALE', null, 'weigh_in_scale', null),
              (gen_random_uuid()::text, $1, 1, 'CANCELLED-FAN', 'FAN', null, 'fan_speed', null),
              (gen_random_uuid()::text, $1, null, 'CANCELLED-EVIDENCE', 'gas_meter', null, 'site_evidence', null)`,
      [visitId]
    );

    const res = await request(app)
      .get(`/api/visits/${visitId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.photos).toEqual([expect.objectContaining({ tag: 'gas_meter', category: 'site_evidence' })]);
    await expect(pool.query('SELECT id FROM visit_photos WHERE visit_id = $1', [visitId])).resolves.toMatchObject({ rowCount: 3 });
  });

  it('returns Weigh-In photo metadata for a normal completed visit', async () => {
    const { token } = await seedTechnicianWithToken();
    const { visitId } = await seedInLobbyVisit({ systemCount: 1 });
    await request(app).post(`/api/visits/${visitId}/claim`).set('Authorization', `Bearer ${token}`);
    await pool.query("UPDATE visits SET status = 'completed' WHERE id = $1", [visitId]);
    await pool.query(
      `INSERT INTO visit_photos (id, visit_id, system_number, slug, tag, label, category, stored_at)
       VALUES (gen_random_uuid()::text, $1, 1, 'COMPLETED-SCALE', 'SCALE', null, 'weigh_in_scale', null)`,
      [visitId]
    );

    const res = await request(app)
      .get(`/api/visits/${visitId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.photos).toEqual([expect.objectContaining({ tag: 'SCALE', category: 'weigh_in_scale' })]);
  });

  it('returns 403 if technician does not own the visit', async () => {
    const { token: tokenA } = await seedTechnicianWithToken({ name: 'Tech-A' });
    const { token: tokenB } = await seedTechnicianWithToken({ name: 'Tech-B' });
    const { visitId } = await seedInLobbyVisit();
    await request(app).post(`/api/visits/${visitId}/claim`).set('Authorization', `Bearer ${tokenA}`);

    const res = await request(app)
      .get(`/api/visits/${visitId}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('This visit is not assigned to you');
  });

  it('dispatcher can view any visit regardless of assignment', async () => {
    const { token: techToken } = await seedTechnicianWithToken();
    const { token: dispToken } = await seedDispatcherWithToken();
    const { visitId } = await seedInLobbyVisit();
    await request(app).post(`/api/visits/${visitId}/claim`).set('Authorization', `Bearer ${techToken}`);

    const res = await request(app)
      .get(`/api/visits/${visitId}`)
      .set('Authorization', `Bearer ${dispToken}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(visitId);
  });

  it('returns 404 for unknown visit', async () => {
    const { token } = await seedTechnicianWithToken();
    const res = await request(app)
      .get('/api/visits/nonexistent-id')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

// ── PATCH /api/dispatch/visits/:id/reassign ──────────────────────────────────
describe('PATCH /api/dispatch/visits/:id/reassign', () => {
  it('reassigns in_lobby visit to technician and creates notification', async () => {
    const { token: dispToken } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const { visitId } = await seedInLobbyVisit();

    const res = await request(app)
      .patch(`/api/dispatch/visits/${visitId}/reassign`)
      .set('Authorization', `Bearer ${dispToken}`)
      .send({ technicianId: tech.id });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(visitId);
    expect(res.body.technicianId).toBe(tech.id);
    expect(res.body.status).toBe('assigned');

    const notif = await pool.query(
      `SELECT * FROM notifications WHERE recipient_id = $1 AND type = 'visit_assigned'`,
      [tech.id]
    );
    expect(notif.rows).toHaveLength(1);
    expect(notif.rows[0].body).toMatch(/assigned to/);
  });

  it('sets status to assigned when visit was in_lobby', async () => {
    const { token: dispToken } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const { visitId } = await seedInLobbyVisit();

    await request(app)
      .patch(`/api/dispatch/visits/${visitId}/reassign`)
      .set('Authorization', `Bearer ${dispToken}`)
      .send({ technicianId: tech.id });

    const row = await pool.query('SELECT status FROM visits WHERE id = $1', [visitId]);
    expect(row.rows[0].status).toBe('assigned');
  });

  it('assigns status to assigned when visit was pending_review (manual direct assign)', async () => {
    const { token: dispToken } = await seedDispatcherWithToken();
    const { tech, token: techToken } = await seedTechnicianWithToken();

    const addrRes = await pool.query(
      `INSERT INTO addresses (id, street, city, subdivision, builder)
       VALUES (gen_random_uuid()::text, '1 MANUAL ST', 'Houston', 'TEST SUB', 'DR HORTON') RETURNING id`
    );
    const now = new Date().toISOString();
    const visitRes = await pool.query(
      `INSERT INTO visits (id, address_id, status, has_multiple_systems, is_deferred, scheduled_time, date, created_at, updated_at)
       VALUES (gen_random_uuid()::text, $1, 'pending_review', false, false, '2026-07-01T09:00:00Z', '2026-07-01', $2, $2)
       RETURNING id`,
      [addrRes.rows[0].id, now]
    );
    const visitId = visitRes.rows[0].id;

    const res = await request(app)
      .patch(`/api/dispatch/visits/${visitId}/reassign`)
      .set('Authorization', `Bearer ${dispToken}`)
      .send({ technicianId: tech.id });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('assigned');

    const row = await pool.query('SELECT status FROM visits WHERE id = $1', [visitId]);
    expect(row.rows[0].status).toBe('assigned');

    const mine = await request(app).get('/api/visits/mine').set('Authorization', `Bearer ${techToken}`);
    expect(mine.status).toBe(200);
    expect(mine.body.some(v => v.id === visitId)).toBe(true);
  });

  it('leaves status unchanged when visit is in_progress', async () => {
    const { token: dispToken } = await seedDispatcherWithToken();
    const { tech: techA, token: tokenA } = await seedTechnicianWithToken({ name: 'Tech-A' });
    const { tech: techB } = await seedTechnicianWithToken({ name: 'Tech-B' });
    const { visitId } = await seedInLobbyVisit();
    await request(app).post(`/api/visits/${visitId}/claim`).set('Authorization', `Bearer ${tokenA}`);
    await request(app).post(`/api/visits/${visitId}/start`).set('Authorization', `Bearer ${tokenA}`);

    const res = await request(app)
      .patch(`/api/dispatch/visits/${visitId}/reassign`)
      .set('Authorization', `Bearer ${dispToken}`)
      .send({ technicianId: techB.id });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('in_progress');

    const row = await pool.query('SELECT status FROM visits WHERE id = $1', [visitId]);
    expect(row.rows[0].status).toBe('in_progress');
  });

  it('returns 400 for inactive technician', async () => {
    const { token: dispToken } = await seedDispatcherWithToken();
    const inactive = await seedTech({ role: 'technician', name: 'Inactive', isActive: false });
    const { visitId } = await seedInLobbyVisit();

    const res = await request(app)
      .patch(`/api/dispatch/visits/${visitId}/reassign`)
      .set('Authorization', `Bearer ${dispToken}`)
      .send({ technicianId: inactive.id });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Technician not found or inactive');
  });

  it('returns 404 for unknown visit', async () => {
    const { token: dispToken } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();

    const res = await request(app)
      .patch('/api/dispatch/visits/nonexistent-id/reassign')
      .set('Authorization', `Bearer ${dispToken}`)
      .send({ technicianId: tech.id });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Visit not found');
  });

  it('returns 403 for technician role', async () => {
    const { tech, token: techToken } = await seedTechnicianWithToken();
    const { visitId } = await seedInLobbyVisit();

    const res = await request(app)
      .patch(`/api/dispatch/visits/${visitId}/reassign`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ technicianId: tech.id });

    expect(res.status).toBe(403);
  });
});
