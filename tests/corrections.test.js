const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');
const {
  seedDispatcherWithToken, seedTechnicianWithToken, seedTech,
  seedCompletedVisit,
} = require('./helpers/seeds');

beforeEach(truncateTables);
afterAll(() => pool.end());

async function seedPayPeriod(weekStart, weekEnd, status = 'open') {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO pay_periods (id, week_start, week_end, status) VALUES ($1, $2, $3, $4)`,
    [id, weekStart, weekEnd, status]
  );
  return id;
}

// Seed a completed visit with a known completed_at inside a pay period window
async function seedCompletedVisitAt(technicianId, completedAt) {
  const { visitId } = await seedCompletedVisit({ technicianId });
  await pool.query(`UPDATE visits SET completed_at = $1 WHERE id = $2`, [completedAt, visitId]);
  return visitId;
}

// ── POST /api/visits/:id/request-correction ───────────────────────────────────

describe('POST /api/visits/:id/request-correction', () => {
  it('creates a correction row and returns correctionId + open status', async () => {
    const { tech, token } = await seedTechnicianWithToken();
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });

    const res = await request(app)
      .post(`/api/visits/${visitId}/request-correction`)
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Wrong total price, should be $150' });

    expect(res.status).toBe(200);
    expect(res.body.correctionId).toBeDefined();
    expect(res.body.status).toBe('open');

    const row = await pool.query('SELECT * FROM corrections WHERE id = $1', [res.body.correctionId]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].visit_id).toBe(visitId);
    expect(row.rows[0].requested_by).toBe(tech.id);
    expect(row.rows[0].status).toBe('open');
    expect(row.rows[0].message).toBe('Wrong total price, should be $150');
  });

  it('creates notifications for all dispatchers and owners, not the technician', async () => {
    const { tech, token } = await seedTechnicianWithToken();
    const { dispatcher } = await seedDispatcherWithToken();
    const owner = await seedTech({ role: 'owner', name: 'Owner-1' });
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });

    await request(app)
      .post(`/api/visits/${visitId}/request-correction`)
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'fix' });

    const notifs = await pool.query(`SELECT * FROM notifications WHERE type = 'correction_requested'`);
    const recipientIds = notifs.rows.map((r) => r.recipient_id);
    expect(recipientIds).toContain(dispatcher.id);
    expect(recipientIds).toContain(owner.id);
    expect(recipientIds).not.toContain(tech.id);
  });

  it('returns 400 if an open correction already exists for the visit', async () => {
    const { tech, token } = await seedTechnicianWithToken();
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });

    await request(app)
      .post(`/api/visits/${visitId}/request-correction`)
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'first' });

    const res = await request(app)
      .post(`/api/visits/${visitId}/request-correction`)
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'second' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already exists/i);
  });

  it('returns 400 if visit is not in a submitted status', async () => {
    const { tech, token } = await seedTechnicianWithToken();
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    await pool.query(`UPDATE visits SET status = 'assigned' WHERE id = $1`, [visitId]);

    const res = await request(app)
      .post(`/api/visits/${visitId}/request-correction`)
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'fix' });

    expect(res.status).toBe(400);
  });

  it('returns 403 if caller is not the assigned technician', async () => {
    const { tech } = await seedTechnicianWithToken();
    const { token: otherToken } = await seedTechnicianWithToken({ name: 'Other-Tech' });
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });

    const res = await request(app)
      .post(`/api/visits/${visitId}/request-correction`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ message: 'fix' });

    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown visit', async () => {
    const { token } = await seedTechnicianWithToken();
    const res = await request(app)
      .post('/api/visits/nonexistent-id/request-correction')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'fix' });
    expect(res.status).toBe(404);
  });

  it('returns 403 for dispatcher role', async () => {
    const { token } = await seedDispatcherWithToken();
    const res = await request(app)
      .post('/api/visits/some-id/request-correction')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'fix' });
    expect(res.status).toBe(403);
  });

  it('returns 409 if the visit\'s Ledger week has already closed', async () => {
    const { token, tech } = await seedTechnicianWithToken();
    const visitId = await seedCompletedVisitAt(tech.id, '2026-06-25T10:00:00Z');
    await seedPayPeriod('2026-06-23', '2026-06-29', 'closed');

    const res = await request(app)
      .post(`/api/visits/${visitId}/request-correction`)
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'fix' });

    expect(res.status).toBe(409);
  });

  it('allows the request when the Ledger week is still open', async () => {
    const { token, tech } = await seedTechnicianWithToken();
    const visitId = await seedCompletedVisitAt(tech.id, '2026-06-25T10:00:00Z');
    await seedPayPeriod('2026-06-23', '2026-06-29', 'open');

    const res = await request(app)
      .post(`/api/visits/${visitId}/request-correction`)
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'fix' });

    expect(res.status).toBe(200);
  });

  it('allows the request when no pay_periods row exists yet for that week', async () => {
    const { token, tech } = await seedTechnicianWithToken();
    const visitId = await seedCompletedVisitAt(tech.id, '2026-06-25T10:00:00Z');

    const res = await request(app)
      .post(`/api/visits/${visitId}/request-correction`)
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'fix' });

    expect(res.status).toBe(200);
  });
});

// ── PATCH /api/dispatch/corrections/:id/apply ──────────────────────────────────

describe('PATCH /api/dispatch/corrections/:id/apply', () => {
  async function seedOpenCorrection(visitId, techId, message = 'please fix') {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO corrections (id, visit_id, requested_by, message, status, requested_at)
       VALUES ($1, $2, $3, $4, 'open', $5)`,
      [id, visitId, techId, message, new Date().toISOString()]
    );
    return id;
  }

  it('transitions correction to applied and sets applied_at', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    const corrId = await seedOpenCorrection(visitId, tech.id);

    const res = await request(app)
      .patch(`/api/dispatch/corrections/${corrId}/apply`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('applied');
    expect(res.body.appliedAt).toBeDefined();

    const row = await pool.query('SELECT status, applied_at FROM corrections WHERE id = $1', [corrId]);
    expect(row.rows[0].status).toBe('applied');
    expect(row.rows[0].applied_at).toBeDefined();
  });

  it('does not modify the visit', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    const before = await pool.query('SELECT notes, total_price, updated_at FROM visits WHERE id = $1', [visitId]);
    const corrId = await seedOpenCorrection(visitId, tech.id);

    await request(app)
      .patch(`/api/dispatch/corrections/${corrId}/apply`)
      .set('Authorization', `Bearer ${token}`);

    const after = await pool.query('SELECT notes, total_price, updated_at FROM visits WHERE id = $1', [visitId]);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('notifies the requesting technician', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    const corrId = await seedOpenCorrection(visitId, tech.id);

    await request(app)
      .patch(`/api/dispatch/corrections/${corrId}/apply`)
      .set('Authorization', `Bearer ${token}`);

    const notif = await pool.query(
      `SELECT * FROM notifications WHERE recipient_id = $1 AND type = 'correction_applied'`,
      [tech.id]
    );
    expect(notif.rows).toHaveLength(1);
  });

  it('returns 400 if correction is not open (already applied)', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    const corrId = await seedOpenCorrection(visitId, tech.id);
    await pool.query(`UPDATE corrections SET status = 'applied' WHERE id = $1`, [corrId]);

    const res = await request(app)
      .patch(`/api/dispatch/corrections/${corrId}/apply`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it('returns 400 if correction is expired', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    const corrId = await seedOpenCorrection(visitId, tech.id);
    await pool.query(`UPDATE corrections SET status = 'expired' WHERE id = $1`, [corrId]);

    const res = await request(app)
      .patch(`/api/dispatch/corrections/${corrId}/apply`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown correction', async () => {
    const { token } = await seedDispatcherWithToken();
    const res = await request(app)
      .patch('/api/dispatch/corrections/nonexistent-id/apply')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('returns 403 for technician role', async () => {
    const { token } = await seedTechnicianWithToken();
    const res = await request(app)
      .patch('/api/dispatch/corrections/some-id/apply')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

// ── GET /api/dispatch/corrections ─────────────────────────────────────────────

describe('GET /api/dispatch/corrections', () => {
  async function seedCorrection(visitId, techId, status = 'open') {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await pool.query(
      `INSERT INTO corrections (id, visit_id, requested_by, message, status, requested_at)
       VALUES ($1, $2, $3, 'a message', $4, $5)`,
      [id, visitId, techId, status, now]
    );
    return id;
  }

  it('returns all corrections with address street, requester name, and message', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    const corrId = await seedCorrection(visitId, tech.id);

    const res = await request(app)
      .get('/api/dispatch/corrections')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const entry = res.body.find((c) => c.id === corrId);
    expect(entry).toBeDefined();
    expect(entry.visitId).toBe(visitId);
    expect(entry.address).toHaveProperty('street');
    expect(entry.requestedBy).toHaveProperty('id', tech.id);
    expect(entry.requestedBy).toHaveProperty('name', tech.name);
    expect(entry.message).toBe('a message');
    expect(entry.status).toBe('open');
    expect(entry).toHaveProperty('requestedAt');
    expect(entry).toHaveProperty('appliedAt');
    expect(entry.correctedFields).toBeUndefined();
    expect(entry.dispatcherNote).toBeUndefined();
    expect(entry.hasEvidence).toBeUndefined();
  });

  it('filters by ?status=open', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const { visitId: v1 } = await seedCompletedVisit({ technicianId: tech.id });
    const { visitId: v2 } = await seedCompletedVisit({ technicianId: tech.id });
    await seedCorrection(v1, tech.id, 'open');
    await seedCorrection(v2, tech.id, 'applied');

    const res = await request(app)
      .get('/api/dispatch/corrections?status=open')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.every((c) => c.status === 'open')).toBe(true);
    expect(res.body.filter((c) => c.status === 'applied')).toHaveLength(0);
  });

  it('returns open corrections before non-open ones', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const { visitId: v1 } = await seedCompletedVisit({ technicianId: tech.id });
    const { visitId: v2 } = await seedCompletedVisit({ technicianId: tech.id });
    await seedCorrection(v1, tech.id, 'applied');
    await seedCorrection(v2, tech.id, 'open');

    const res = await request(app)
      .get('/api/dispatch/corrections')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const statuses = res.body.map((c) => c.status);
    const firstNonOpen = statuses.findIndex((s) => s !== 'open');
    const lastOpen = statuses.lastIndexOf('open');
    if (firstNonOpen !== -1 && lastOpen !== -1) {
      expect(lastOpen).toBeLessThan(firstNonOpen);
    }
  });

  it('returns 403 for technician role', async () => {
    const { token } = await seedTechnicianWithToken();
    const res = await request(app)
      .get('/api/dispatch/corrections')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

// ── GET /api/dispatch/corrections/:id ─────────────────────────────────────────

describe('GET /api/dispatch/corrections/:id', () => {
  it('returns detail with message and visit snapshot', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    const corrId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO corrections (id, visit_id, requested_by, message, status, requested_at)
       VALUES ($1, $2, $3, 'detail message', 'open', $4)`,
      [corrId, visitId, tech.id, new Date().toISOString()]
    );

    const res = await request(app)
      .get(`/api/dispatch/corrections/${corrId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(corrId);
    expect(res.body.message).toBe('detail message');
    expect(res.body.visitSnapshot).toHaveProperty('totalPrice');
  });

  it('returns 404 for unknown correction', async () => {
    const { token } = await seedDispatcherWithToken();
    const res = await request(app)
      .get('/api/dispatch/corrections/nonexistent-id')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
