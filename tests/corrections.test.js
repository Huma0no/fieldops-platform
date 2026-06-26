const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');
const {
  seedDispatcherWithToken, seedTechnicianWithToken, seedTech, seedToken,
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
async function seedCompletedVisitAt(technicianId, completedAt, totalPrice = 200) {
  const { visitId } = await seedCompletedVisit({ technicianId });
  await pool.query(
    `UPDATE visits SET completed_at = $1, total_price = $2 WHERE id = $3`,
    [completedAt, totalPrice, visitId]
  );
  return visitId;
}

// ── POST /api/visits/:id/request-correction ───────────────────────────────────

describe('POST /api/visits/:id/request-correction', () => {
  it('creates a correction row and returns correctionId + pending status', async () => {
    const { tech, token } = await seedTechnicianWithToken();
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });

    const res = await request(app)
      .post(`/api/visits/${visitId}/request-correction`)
      .set('Authorization', `Bearer ${token}`)
      .send({ correctedFields: { notes: 'updated notes', totalPrice: 120 }, reason: 'wrong notes' });

    expect(res.status).toBe(200);
    expect(res.body.correctionId).toBeDefined();
    expect(res.body.status).toBe('pending');

    const row = await pool.query('SELECT * FROM corrections WHERE id = $1', [res.body.correctionId]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].visit_id).toBe(visitId);
    expect(row.rows[0].requested_by).toBe(tech.id);
    expect(row.rows[0].status).toBe('pending');
    expect(JSON.parse(row.rows[0].corrected_fields)).toEqual({ notes: 'updated notes', totalPrice: 120 });
    expect(row.rows[0].reason).toBe('wrong notes');
  });

  it('creates notifications for all dispatchers and owners', async () => {
    const { tech, token } = await seedTechnicianWithToken();
    const { dispatcher } = await seedDispatcherWithToken();
    const owner = await seedTech({ role: 'owner', name: 'Owner-1' });
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });

    await request(app)
      .post(`/api/visits/${visitId}/request-correction`)
      .set('Authorization', `Bearer ${token}`)
      .send({ correctedFields: { notes: 'fix' } });

    const notifs = await pool.query(
      `SELECT * FROM notifications WHERE type = 'correction_requested'`
    );
    const recipientIds = notifs.rows.map((r) => r.recipient_id);
    expect(recipientIds).toContain(dispatcher.id);
    expect(recipientIds).toContain(owner.id);
    expect(recipientIds).not.toContain(tech.id);
  });

  it('returns 400 if a pending correction already exists', async () => {
    const { tech, token } = await seedTechnicianWithToken();
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });

    await request(app)
      .post(`/api/visits/${visitId}/request-correction`)
      .set('Authorization', `Bearer ${token}`)
      .send({ correctedFields: { notes: 'first' } });

    const res = await request(app)
      .post(`/api/visits/${visitId}/request-correction`)
      .set('Authorization', `Bearer ${token}`)
      .send({ correctedFields: { notes: 'second' } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already pending/i);
  });

  it('returns 400 if visit is not in a submitted status', async () => {
    const { tech, token } = await seedTechnicianWithToken();
    // seedCompletedVisit returns status='completed' — change to 'assigned'
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    await pool.query(`UPDATE visits SET status = 'assigned' WHERE id = $1`, [visitId]);

    const res = await request(app)
      .post(`/api/visits/${visitId}/request-correction`)
      .set('Authorization', `Bearer ${token}`)
      .send({ correctedFields: { notes: 'fix' } });

    expect(res.status).toBe(400);
  });

  it('returns 403 if caller is not the assigned technician', async () => {
    const { tech } = await seedTechnicianWithToken();
    const { token: otherToken } = await seedTechnicianWithToken({ name: 'Other-Tech' });
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });

    const res = await request(app)
      .post(`/api/visits/${visitId}/request-correction`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ correctedFields: { notes: 'fix' } });

    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown visit', async () => {
    const { token } = await seedTechnicianWithToken();
    const res = await request(app)
      .post('/api/visits/nonexistent-id/request-correction')
      .set('Authorization', `Bearer ${token}`)
      .send({ correctedFields: { notes: 'fix' } });
    expect(res.status).toBe(404);
  });

  it('returns 403 for dispatcher role', async () => {
    const { token } = await seedDispatcherWithToken();
    const res = await request(app)
      .post('/api/visits/some-id/request-correction')
      .set('Authorization', `Bearer ${token}`)
      .send({ correctedFields: { notes: 'fix' } });
    expect(res.status).toBe(403);
  });
});

// ── PATCH /api/dispatch/corrections/:id/approve ───────────────────────────────

describe('PATCH /api/dispatch/corrections/:id/approve', () => {
  async function seedPendingCorrection(visitId, techId, correctedFields = { notes: 'updated' }) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO corrections (id, visit_id, requested_by, corrected_fields, reason, status, requested_at)
       VALUES ($1, $2, $3, $4, 'test reason', 'pending', $5)`,
      [id, visitId, techId, JSON.stringify(correctedFields), new Date().toISOString()]
    );
    return id;
  }

  it('applies correctedFields to the visit and transitions correction to approved', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    const corrId = await seedPendingCorrection(visitId, tech.id, { notes: 'fixed notes', totalPrice: 99 });

    const res = await request(app)
      .patch(`/api/dispatch/corrections/${corrId}/approve`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.affectsClosedPeriod).toBeDefined();

    const visit = await pool.query('SELECT notes, total_price FROM visits WHERE id = $1', [visitId]);
    expect(visit.rows[0].notes).toBe('fixed notes');
    expect(visit.rows[0].total_price).toBe(99);

    const corr = await pool.query('SELECT status, resolved_at FROM corrections WHERE id = $1', [corrId]);
    expect(corr.rows[0].status).toBe('approved');
    expect(corr.rows[0].resolved_at).toBeDefined();
  });

  it('inserts an edit_log row with source correction_approved', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    const corrId = await seedPendingCorrection(visitId, tech.id);

    await request(app)
      .patch(`/api/dispatch/corrections/${corrId}/approve`)
      .set('Authorization', `Bearer ${token}`);

    const log = await pool.query(
      `SELECT * FROM edit_log WHERE visit_id = $1 AND source = 'correction_approved'`,
      [visitId]
    );
    expect(log.rows).toHaveLength(1);
  });

  it('notifies the requesting technician of approval', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    const corrId = await seedPendingCorrection(visitId, tech.id);

    await request(app)
      .patch(`/api/dispatch/corrections/${corrId}/approve`)
      .set('Authorization', `Bearer ${token}`);

    const notif = await pool.query(
      `SELECT * FROM notifications WHERE recipient_id = $1 AND type = 'correction_approved'`,
      [tech.id]
    );
    expect(notif.rows).toHaveLength(1);
  });

  it('returns affectsClosedPeriod=false when period is open', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const visitId = await seedCompletedVisitAt(tech.id, '2026-06-25T10:00:00Z');
    await seedPayPeriod('2026-06-23', '2026-06-29', 'open');
    const corrId = await seedPendingCorrection(visitId, tech.id);

    const res = await request(app)
      .patch(`/api/dispatch/corrections/${corrId}/approve`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.affectsClosedPeriod).toBe(false);
  });

  it('returns affectsClosedPeriod=true and notifies dispatchers when period is closed', async () => {
    const { token, dispatcher } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const visitId = await seedCompletedVisitAt(tech.id, '2026-06-25T10:00:00Z');
    await seedPayPeriod('2026-06-23', '2026-06-29', 'closed');
    const corrId = await seedPendingCorrection(visitId, tech.id);

    const res = await request(app)
      .patch(`/api/dispatch/corrections/${corrId}/approve`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.affectsClosedPeriod).toBe(true);

    const notif = await pool.query(
      `SELECT * FROM notifications WHERE type = 'correction_needs_period_adjustment'`
    );
    expect(notif.rows.length).toBeGreaterThan(0);
  });

  it('silently ignores unknown fields in correctedFields', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    const corrId = await seedPendingCorrection(visitId, tech.id, { notes: 'ok', unknownField: 'bad' });

    const res = await request(app)
      .patch(`/api/dispatch/corrections/${corrId}/approve`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const visit = await pool.query('SELECT notes FROM visits WHERE id = $1', [visitId]);
    expect(visit.rows[0].notes).toBe('ok');
  });

  it('returns 400 if correction is not pending', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    const corrId = await seedPendingCorrection(visitId, tech.id);
    await pool.query(`UPDATE corrections SET status = 'approved' WHERE id = $1`, [corrId]);

    const res = await request(app)
      .patch(`/api/dispatch/corrections/${corrId}/approve`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown correction', async () => {
    const { token } = await seedDispatcherWithToken();
    const res = await request(app)
      .patch('/api/dispatch/corrections/nonexistent-id/approve')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('returns 403 for technician role', async () => {
    const { token } = await seedTechnicianWithToken();
    const res = await request(app)
      .patch('/api/dispatch/corrections/some-id/approve')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

// ── PATCH /api/dispatch/corrections/:id/reject ────────────────────────────────

describe('PATCH /api/dispatch/corrections/:id/reject', () => {
  async function seedPendingCorrection(visitId, techId) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO corrections (id, visit_id, requested_by, corrected_fields, status, requested_at)
       VALUES ($1, $2, $3, '{}', 'pending', $4)`,
      [id, visitId, techId, new Date().toISOString()]
    );
    return id;
  }

  it('transitions correction to rejected and stores dispatcherNote', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    const corrId = await seedPendingCorrection(visitId, tech.id);

    const res = await request(app)
      .patch(`/api/dispatch/corrections/${corrId}/reject`)
      .set('Authorization', `Bearer ${token}`)
      .send({ dispatcherNote: 'Not a valid correction' });

    expect(res.status).toBe(200);
    expect(res.body.correctionId).toBe(corrId);
    expect(res.body.status).toBe('rejected');
    expect(res.body.dispatcherNote).toBe('Not a valid correction');

    const row = await pool.query('SELECT * FROM corrections WHERE id = $1', [corrId]);
    expect(row.rows[0].status).toBe('rejected');
    expect(row.rows[0].dispatcher_note).toBe('Not a valid correction');
    expect(row.rows[0].resolved_at).toBeDefined();
  });

  it('notifies the requesting technician of rejection with note in message', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    const corrId = await seedPendingCorrection(visitId, tech.id);

    await request(app)
      .patch(`/api/dispatch/corrections/${corrId}/reject`)
      .set('Authorization', `Bearer ${token}`)
      .send({ dispatcherNote: 'prices look correct' });

    const notif = await pool.query(
      `SELECT * FROM notifications WHERE recipient_id = $1 AND type = 'correction_rejected'`,
      [tech.id]
    );
    expect(notif.rows).toHaveLength(1);
    expect(notif.rows[0].body).toContain('prices look correct');
  });

  it('notifies technician without note suffix when no dispatcherNote', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    const corrId = await seedPendingCorrection(visitId, tech.id);

    await request(app)
      .patch(`/api/dispatch/corrections/${corrId}/reject`)
      .set('Authorization', `Bearer ${token}`);

    const notif = await pool.query(
      `SELECT * FROM notifications WHERE recipient_id = $1 AND type = 'correction_rejected'`,
      [tech.id]
    );
    expect(notif.rows).toHaveLength(1);
    expect(notif.rows[0].body).not.toContain(':');
  });

  it('returns 400 if correction is not pending', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    const corrId = await seedPendingCorrection(visitId, tech.id);
    await pool.query(`UPDATE corrections SET status = 'rejected' WHERE id = $1`, [corrId]);

    const res = await request(app)
      .patch(`/api/dispatch/corrections/${corrId}/reject`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown correction', async () => {
    const { token } = await seedDispatcherWithToken();
    const res = await request(app)
      .patch('/api/dispatch/corrections/nonexistent-id/reject')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('returns 403 for technician role', async () => {
    const { token } = await seedTechnicianWithToken();
    const res = await request(app)
      .patch('/api/dispatch/corrections/some-id/reject')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

// ── GET /api/dispatch/corrections ─────────────────────────────────────────────

describe('GET /api/dispatch/corrections', () => {
  async function seedCorrection(visitId, techId, status = 'pending') {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await pool.query(
      `INSERT INTO corrections (id, visit_id, requested_by, corrected_fields, reason, status, requested_at)
       VALUES ($1, $2, $3, $4, 'some reason', $5, $6)`,
      [id, visitId, techId, JSON.stringify({ notes: 'fix' }), status, now]
    );
    return id;
  }

  it('returns all corrections with address street and requester name', async () => {
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
    expect(entry.correctedFields).toEqual({ notes: 'fix' });
    expect(entry.reason).toBe('some reason');
    expect(entry.status).toBe('pending');
    expect(entry).toHaveProperty('requestedAt');
    expect(entry).toHaveProperty('resolvedAt');
    expect(entry).toHaveProperty('dispatcherNote');
  });

  it('filters by ?status=pending', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const { visitId: v1 } = await seedCompletedVisit({ technicianId: tech.id });
    const { visitId: v2 } = await seedCompletedVisit({ technicianId: tech.id });
    await seedCorrection(v1, tech.id, 'pending');
    await seedCorrection(v2, tech.id, 'approved');

    const res = await request(app)
      .get('/api/dispatch/corrections?status=pending')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.every((c) => c.status === 'pending')).toBe(true);
    const approvedIds = res.body.filter((c) => c.status === 'approved');
    expect(approvedIds).toHaveLength(0);
  });

  it('returns pending corrections before non-pending ones', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const { visitId: v1 } = await seedCompletedVisit({ technicianId: tech.id });
    const { visitId: v2 } = await seedCompletedVisit({ technicianId: tech.id });
    await seedCorrection(v1, tech.id, 'approved');
    await seedCorrection(v2, tech.id, 'pending');

    const res = await request(app)
      .get('/api/dispatch/corrections')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const statuses = res.body.map((c) => c.status);
    const firstNonPending = statuses.findIndex((s) => s !== 'pending');
    const lastPending = statuses.lastIndexOf('pending');
    if (firstNonPending !== -1 && lastPending !== -1) {
      expect(lastPending).toBeLessThan(firstNonPending);
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
