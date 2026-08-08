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

async function seedPayPeriod(weekStart, weekEnd) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO pay_periods (id, week_start, week_end, status) VALUES ($1, $2, $3, 'open')`,
    [id, weekStart, weekEnd]
  );
  return id;
}

async function seedOwnerWithToken() {
  const owner = await seedTech({ role: 'owner', name: `Owner-${crypto.randomBytes(3).toString('hex')}` });
  const token = await seedToken(owner.id);
  return { owner, token };
}

async function seedVisitInPeriod(technicianId, completedAt, totalPrice = 200) {
  const { visitId } = await seedCompletedVisit({ technicianId });
  await pool.query(
    `UPDATE visits SET completed_at = $1, total_price = $2 WHERE id = $3`,
    [completedAt, totalPrice, visitId]
  );
  return visitId;
}

// ── GET /api/dispatch/pay-periods ─────────────────────────────────────────────

describe('GET /api/dispatch/pay-periods', () => {
  it('returns pay periods ordered by week_start DESC', async () => {
    const { token } = await seedDispatcherWithToken();
    await seedPayPeriod('2026-06-16', '2026-06-22');
    await seedPayPeriod('2026-06-23', '2026-06-29');

    const res = await request(app)
      .get('/api/dispatch/pay-periods')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    expect(res.body[0].weekStart).toBe('2026-06-23');
    expect(res.body[1].weekStart).toBe('2026-06-16');
  });

  it('returns correct shape', async () => {
    const { token } = await seedDispatcherWithToken();
    await seedPayPeriod('2026-06-23', '2026-06-29');

    const res = await request(app)
      .get('/api/dispatch/pay-periods')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const p = res.body[0];
    expect(p).toHaveProperty('id');
    expect(p).toHaveProperty('weekStart');
    expect(p).toHaveProperty('weekEnd');
    expect(p).toHaveProperty('status');
    expect(p).toHaveProperty('paidAt');
    expect(p).toHaveProperty('createdAt');
  });

  it('returns 403 for technician role', async () => {
    const { token } = await seedTechnicianWithToken();
    const res = await request(app)
      .get('/api/dispatch/pay-periods')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

// ── GET /api/dispatch/pay-periods/:id ─────────────────────────────────────────

describe('GET /api/dispatch/pay-periods/:id', () => {
  it('returns period with lines including technician name', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const periodId = await seedPayPeriod('2026-06-23', '2026-06-29');

    await pool.query(
      `INSERT INTO pay_period_lines (id, period_id, technician_id, gross_amount, commission_retained, net_amount)
       VALUES (gen_random_uuid()::text, $1, $2, 300, 60, 240)`,
      [periodId, tech.id]
    );

    const res = await request(app)
      .get(`/api/dispatch/pay-periods/${periodId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(periodId);
    expect(res.body.weekStart).toBe('2026-06-23');
    expect(res.body.weekEnd).toBe('2026-06-29');
    expect(res.body.status).toBe('open');
    expect(Array.isArray(res.body.lines)).toBe(true);
    const line = res.body.lines[0];
    expect(line.technicianId).toBe(tech.id);
    expect(line.technicianName).toBe(tech.name);
    expect(line.grossAmount).toBe(300);
    expect(line.commissionRetained).toBe(60);
    expect(line.netAmount).toBe(240);
  });

  it('returns 404 for unknown period', async () => {
    const { token } = await seedDispatcherWithToken();
    const res = await request(app)
      .get('/api/dispatch/pay-periods/nonexistent-id')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('returns 403 for technician role', async () => {
    const { token } = await seedTechnicianWithToken();
    const res = await request(app)
      .get('/api/dispatch/pay-periods/some-id')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

// ── POST /api/dispatch/pay-periods/close ──────────────────────────────────────

describe('POST /api/dispatch/pay-periods/close', () => {
  it('calculates gross, applies 80/20 for technician, inserts lines, closes period', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const periodId = await seedPayPeriod('2026-06-23', '2026-06-29');

    await seedVisitInPeriod(tech.id, '2026-06-25T10:00:00Z', 200);
    await seedVisitInPeriod(tech.id, '2026-06-26T10:00:00Z', 100);

    const res = await request(app)
      .post('/api/dispatch/pay-periods/close')
      .set('Authorization', `Bearer ${token}`)
      .send({ periodId });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(periodId);
    expect(res.body.status).toBe('closed');
    expect(Array.isArray(res.body.lines)).toBe(true);
    const line = res.body.lines.find((l) => l.technicianId === tech.id);
    expect(line).toBeDefined();
    expect(line.grossAmount).toBe(300);
    expect(line.commissionRetained).toBe(60);
    expect(line.netAmount).toBe(240);
  });

  it('uses the technician\'s own commission_rate, snapshotted into commission_rate_applied', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    await pool.query('UPDATE technicians SET commission_rate = 30 WHERE id = $1', [tech.id]);
    const periodId = await seedPayPeriod('2026-06-23', '2026-06-29');

    await seedVisitInPeriod(tech.id, '2026-06-25T10:00:00Z', 200);

    const res = await request(app)
      .post('/api/dispatch/pay-periods/close')
      .set('Authorization', `Bearer ${token}`)
      .send({ periodId });

    expect(res.status).toBe(200);
    const line = res.body.lines.find((l) => l.technicianId === tech.id);
    expect(line.grossAmount).toBe(200);
    expect(line.commissionRateApplied).toBe(30);
    expect(line.commissionRetained).toBe(60);
    expect(line.netAmount).toBe(140);

    const row = await pool.query(
      'SELECT commission_rate_applied FROM pay_period_lines WHERE period_id = $1 AND technician_id = $2',
      [periodId, tech.id]
    );
    expect(row.rows[0].commission_rate_applied).toBe(30);
  });

  it('applies 100% net for owner role', async () => {
    const { token } = await seedDispatcherWithToken();
    const { owner } = await seedOwnerWithToken();
    const periodId = await seedPayPeriod('2026-06-23', '2026-06-29');

    await seedVisitInPeriod(owner.id, '2026-06-25T10:00:00Z', 500);

    const res = await request(app)
      .post('/api/dispatch/pay-periods/close')
      .set('Authorization', `Bearer ${token}`)
      .send({ periodId });

    expect(res.status).toBe(200);
    const line = res.body.lines.find((l) => l.technicianId === owner.id);
    expect(line).toBeDefined();
    expect(line.grossAmount).toBe(500);
    expect(line.commissionRetained).toBe(0);
    expect(line.netAmount).toBe(500);
  });

  it('excludes cancelled visits from gross', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const periodId = await seedPayPeriod('2026-06-23', '2026-06-29');

    await seedVisitInPeriod(tech.id, '2026-06-25T10:00:00Z', 200);

    // cancelled visit — must be excluded
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    await pool.query(
      `UPDATE visits SET status = 'cancelled', completed_at = '2026-06-26T10:00:00Z', total_price = 999 WHERE id = $1`,
      [visitId]
    );

    const res = await request(app)
      .post('/api/dispatch/pay-periods/close')
      .set('Authorization', `Bearer ${token}`)
      .send({ periodId });

    expect(res.status).toBe(200);
    const line = res.body.lines.find((l) => l.technicianId === tech.id);
    expect(line.grossAmount).toBe(200);
  });

  it('expires open corrections on visits within the closing period, leaves others untouched', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const periodId = await seedPayPeriod('2026-06-23', '2026-06-29');

    const inPeriodVisitId = await seedVisitInPeriod(tech.id, '2026-06-25T10:00:00Z', 200);
    const { visitId: outsidePeriodVisitId } = await seedCompletedVisit({ technicianId: tech.id });
    await pool.query(`UPDATE visits SET completed_at = '2026-07-10T10:00:00Z' WHERE id = $1`, [outsidePeriodVisitId]);
    const { visitId: appliedVisitId } = await seedCompletedVisit({ technicianId: tech.id });
    await pool.query(`UPDATE visits SET completed_at = '2026-06-26T10:00:00Z' WHERE id = $1`, [appliedVisitId]);

    async function seedCorrection(visitId, status) {
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO corrections (id, visit_id, requested_by, message, status, requested_at)
         VALUES ($1, $2, $3, 'msg', $4, $5)`,
        [id, visitId, tech.id, status, new Date().toISOString()]
      );
      return id;
    }

    const openInPeriodId = await seedCorrection(inPeriodVisitId, 'open');
    const openOutsidePeriodId = await seedCorrection(outsidePeriodVisitId, 'open');
    const alreadyAppliedId = await seedCorrection(appliedVisitId, 'applied');

    const res = await request(app)
      .post('/api/dispatch/pay-periods/close')
      .set('Authorization', `Bearer ${token}`)
      .send({ periodId });

    expect(res.status).toBe(200);

    const rows = await pool.query(
      'SELECT id, status FROM corrections WHERE id IN ($1, $2, $3)',
      [openInPeriodId, openOutsidePeriodId, alreadyAppliedId]
    );
    const statusById = Object.fromEntries(rows.rows.map((r) => [r.id, r.status]));
    expect(statusById[openInPeriodId]).toBe('expired');
    expect(statusById[openOutsidePeriodId]).toBe('open');
    expect(statusById[alreadyAppliedId]).toBe('applied');
  });

  it('does not create a line for technician with zero completed visits in period', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const periodId = await seedPayPeriod('2026-06-23', '2026-06-29');

    // visit outside the period window
    await seedVisitInPeriod(tech.id, '2026-07-10T10:00:00Z', 200);

    const res = await request(app)
      .post('/api/dispatch/pay-periods/close')
      .set('Authorization', `Bearer ${token}`)
      .send({ periodId });

    expect(res.status).toBe(200);
    expect(res.body.lines).toHaveLength(0);
  });

  it('returns 400 if period is already closed', async () => {
    const { token } = await seedDispatcherWithToken();
    const periodId = await seedPayPeriod('2026-06-23', '2026-06-29');
    await pool.query(`UPDATE pay_periods SET status = 'closed' WHERE id = $1`, [periodId]);

    const res = await request(app)
      .post('/api/dispatch/pay-periods/close')
      .set('Authorization', `Bearer ${token}`)
      .send({ periodId });

    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown period', async () => {
    const { token } = await seedDispatcherWithToken();
    const res = await request(app)
      .post('/api/dispatch/pay-periods/close')
      .set('Authorization', `Bearer ${token}`)
      .send({ periodId: 'nonexistent-id' });
    expect(res.status).toBe(404);
  });

  it('returns 403 for technician role', async () => {
    const { token } = await seedTechnicianWithToken();
    const res = await request(app)
      .post('/api/dispatch/pay-periods/close')
      .set('Authorization', `Bearer ${token}`)
      .send({ periodId: 'any-id' });
    expect(res.status).toBe(403);
  });
});

// ── PATCH /api/dispatch/pay-periods/:id/mark-paid ─────────────────────────────

describe('PATCH /api/dispatch/pay-periods/:id/mark-paid', () => {
  it('transitions closed period to paid and returns paidAt', async () => {
    const { token } = await seedDispatcherWithToken();
    const periodId = await seedPayPeriod('2026-06-23', '2026-06-29');
    await pool.query(`UPDATE pay_periods SET status = 'closed' WHERE id = $1`, [periodId]);

    const res = await request(app)
      .patch(`/api/dispatch/pay-periods/${periodId}/mark-paid`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(periodId);
    expect(res.body.status).toBe('paid');
    expect(res.body.paidAt).toBeDefined();
  });

  it('returns 400 if period is not closed (open)', async () => {
    const { token } = await seedDispatcherWithToken();
    const periodId = await seedPayPeriod('2026-06-23', '2026-06-29');

    const res = await request(app)
      .patch(`/api/dispatch/pay-periods/${periodId}/mark-paid`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown period', async () => {
    const { token } = await seedDispatcherWithToken();
    const res = await request(app)
      .patch('/api/dispatch/pay-periods/nonexistent-id/mark-paid')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('returns 403 for technician role', async () => {
    const { token } = await seedTechnicianWithToken();
    const res = await request(app)
      .patch('/api/dispatch/pay-periods/some-id/mark-paid')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

// ── GET /api/pay/mine ─────────────────────────────────────────────────────────

describe('GET /api/pay/mine', () => {
  it('returns all lines for authenticated technician across periods, newest first', async () => {
    const { tech, token } = await seedTechnicianWithToken();
    const { tech: other } = await seedTechnicianWithToken({ name: 'Other-Tech' });

    const periodId1 = await seedPayPeriod('2026-06-16', '2026-06-22');
    const periodId2 = await seedPayPeriod('2026-06-23', '2026-06-29');
    await pool.query(`UPDATE pay_periods SET status = 'closed' WHERE id IN ($1, $2)`, [periodId1, periodId2]);

    await pool.query(
      `INSERT INTO pay_period_lines (id, period_id, technician_id, gross_amount, commission_retained, net_amount)
       VALUES (gen_random_uuid()::text, $1, $2, 200, 40, 160)`,
      [periodId1, tech.id]
    );
    await pool.query(
      `INSERT INTO pay_period_lines (id, period_id, technician_id, gross_amount, commission_retained, net_amount)
       VALUES (gen_random_uuid()::text, $1, $2, 300, 60, 240)`,
      [periodId2, tech.id]
    );
    // other tech line — must never appear
    await pool.query(
      `INSERT INTO pay_period_lines (id, period_id, technician_id, gross_amount, commission_retained, net_amount)
       VALUES (gen_random_uuid()::text, $1, $2, 500, 100, 400)`,
      [periodId2, other.id]
    );

    const res = await request(app)
      .get('/api/pay/mine')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].periodId).toBe(periodId2);
    expect(res.body[0].weekStart).toBe('2026-06-23');
    expect(res.body[0].grossAmount).toBe(300);
    expect(res.body[1].periodId).toBe(periodId1);
    const hasOther = res.body.some((l) => l.technicianId === other.id);
    expect(hasOther).toBe(false);
  });

  it('filters by periodId when provided', async () => {
    const { tech, token } = await seedTechnicianWithToken();
    const periodId1 = await seedPayPeriod('2026-06-16', '2026-06-22');
    const periodId2 = await seedPayPeriod('2026-06-23', '2026-06-29');

    await pool.query(
      `INSERT INTO pay_period_lines (id, period_id, technician_id, gross_amount, commission_retained, net_amount)
       VALUES (gen_random_uuid()::text, $1, $2, 200, 40, 160)`,
      [periodId1, tech.id]
    );
    await pool.query(
      `INSERT INTO pay_period_lines (id, period_id, technician_id, gross_amount, commission_retained, net_amount)
       VALUES (gen_random_uuid()::text, $1, $2, 300, 60, 240)`,
      [periodId2, tech.id]
    );

    const res = await request(app)
      .get(`/api/pay/mine?periodId=${periodId1}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].periodId).toBe(periodId1);
    expect(res.body[0].grossAmount).toBe(200);
  });

  it('returns shape with periodId, weekStart, weekEnd, grossAmount, commissionRetained, netAmount', async () => {
    const { tech, token } = await seedTechnicianWithToken();
    const periodId = await seedPayPeriod('2026-06-23', '2026-06-29');
    await pool.query(
      `INSERT INTO pay_period_lines (id, period_id, technician_id, gross_amount, commission_retained, net_amount)
       VALUES (gen_random_uuid()::text, $1, $2, 200, 40, 160)`,
      [periodId, tech.id]
    );

    const res = await request(app)
      .get('/api/pay/mine')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const line = res.body[0];
    expect(line).toHaveProperty('periodId');
    expect(line).toHaveProperty('weekStart');
    expect(line).toHaveProperty('weekEnd');
    expect(line).toHaveProperty('grossAmount');
    expect(line).toHaveProperty('commissionRetained');
    expect(line).toHaveProperty('netAmount');
  });

  it('returns 403 for dispatcher role', async () => {
    const { token } = await seedDispatcherWithToken();
    const res = await request(app)
      .get('/api/pay/mine')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

// ── POST /api/dispatch/pay-periods/:id/adjustments ────────────────────────────

describe('POST /api/dispatch/pay-periods/:id/adjustments', () => {
  it('creates adjustment and returns updated period with adjusted netAmount', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const periodId = await seedPayPeriod('2026-06-23', '2026-06-29');

    await pool.query(
      `INSERT INTO pay_period_lines (id, period_id, technician_id, gross_amount, commission_retained, net_amount)
       VALUES (gen_random_uuid()::text, $1, $2, 300, 60, 240)`,
      [periodId, tech.id]
    );

    const res = await request(app)
      .post(`/api/dispatch/pay-periods/${periodId}/adjustments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ technicianId: tech.id, amount: -50, note: 'Late deduction' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(periodId);
    const line = res.body.lines.find(l => l.technicianId === tech.id);
    expect(line).toBeDefined();
    expect(line.netAmount).toBeCloseTo(190);
    expect(line.adjustments).toHaveLength(1);
    expect(line.adjustments[0].amount).toBeCloseTo(-50);
    expect(line.adjustments[0].note).toBe('Late deduction');
  });

  it('sums multiple adjustments correctly', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const periodId = await seedPayPeriod('2026-06-23', '2026-06-29');

    await pool.query(
      `INSERT INTO pay_period_lines (id, period_id, technician_id, gross_amount, commission_retained, net_amount)
       VALUES (gen_random_uuid()::text, $1, $2, 300, 60, 240)`,
      [periodId, tech.id]
    );

    await request(app)
      .post(`/api/dispatch/pay-periods/${periodId}/adjustments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ technicianId: tech.id, amount: 100, note: 'Bonus' });

    const res = await request(app)
      .post(`/api/dispatch/pay-periods/${periodId}/adjustments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ technicianId: tech.id, amount: -25, note: 'Deduction' });

    expect(res.status).toBe(201);
    const line = res.body.lines.find(l => l.technicianId === tech.id);
    expect(line.netAmount).toBeCloseTo(315);
    expect(line.adjustments).toHaveLength(2);
  });

  it('returns 400 when period is not open', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const periodId = await seedPayPeriod('2026-06-23', '2026-06-29');
    await pool.query(`UPDATE pay_periods SET status = 'closed' WHERE id = $1`, [periodId]);

    const res = await request(app)
      .post(`/api/dispatch/pay-periods/${periodId}/adjustments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ technicianId: tech.id, amount: -50 });

    expect(res.status).toBe(400);
  });

  it('returns 400 when technicianId or amount is missing', async () => {
    const { token } = await seedDispatcherWithToken();
    const periodId = await seedPayPeriod('2026-06-23', '2026-06-29');

    const res = await request(app)
      .post(`/api/dispatch/pay-periods/${periodId}/adjustments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: -50 });

    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown period', async () => {
    const { token } = await seedDispatcherWithToken();
    const res = await request(app)
      .post('/api/dispatch/pay-periods/nonexistent/adjustments')
      .set('Authorization', `Bearer ${token}`)
      .send({ technicianId: 'any', amount: -10 });
    expect(res.status).toBe(404);
  });

  it('returns 403 for technician role', async () => {
    const { token } = await seedTechnicianWithToken();
    const res = await request(app)
      .post('/api/dispatch/pay-periods/any-id/adjustments')
      .set('Authorization', `Bearer ${token}`)
      .send({ technicianId: 'any', amount: -10 });
    expect(res.status).toBe(403);
  });
});

// ── GET /:id includes adjustments + totalGenerated + ghostDeduction ───────────

describe('GET /api/dispatch/pay-periods/:id (extended fields)', () => {
  it('includes adjustments array (empty) and totalGenerated on lines', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const periodId = await seedPayPeriod('2026-06-23', '2026-06-29');

    await pool.query(
      `INSERT INTO pay_period_lines (id, period_id, technician_id, gross_amount, commission_retained, net_amount)
       VALUES (gen_random_uuid()::text, $1, $2, 300, 60, 240)`,
      [periodId, tech.id]
    );

    const res = await request(app)
      .get(`/api/dispatch/pay-periods/${periodId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalGenerated');
    expect(res.body).toHaveProperty('ghostDeduction');
    expect(res.body.lines[0]).toHaveProperty('adjustments');
    expect(res.body.lines[0].adjustments).toEqual([]);
  });
});

// ── POST /api/dispatch/pay-periods/:id/ghost-deduction ───────────────────────

describe('POST /api/dispatch/pay-periods/:id/ghost-deduction', () => {
  it('sets ghost deduction on a closed period and returns updated period', async () => {
    const { token } = await seedDispatcherWithToken();
    const periodId = await seedPayPeriod('2026-06-23', '2026-06-29');
    await pool.query(`UPDATE pay_periods SET status = 'closed' WHERE id = $1`, [periodId]);

    const res = await request(app)
      .post(`/api/dispatch/pay-periods/${periodId}/ghost-deduction`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 150 });

    expect(res.status).toBe(200);
    expect(res.body.ghostDeduction).toBeCloseTo(150);
  });

  it('returns 400 when period is not closed', async () => {
    const { token } = await seedDispatcherWithToken();
    const periodId = await seedPayPeriod('2026-06-23', '2026-06-29');

    const res = await request(app)
      .post(`/api/dispatch/pay-periods/${periodId}/ghost-deduction`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 100 });

    expect(res.status).toBe(400);
  });

  it('returns 400 when amount is missing', async () => {
    const { token } = await seedDispatcherWithToken();
    const periodId = await seedPayPeriod('2026-06-23', '2026-06-29');
    await pool.query(`UPDATE pay_periods SET status = 'closed' WHERE id = $1`, [periodId]);

    const res = await request(app)
      .post(`/api/dispatch/pay-periods/${periodId}/ghost-deduction`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown period', async () => {
    const { token } = await seedDispatcherWithToken();
    const res = await request(app)
      .post('/api/dispatch/pay-periods/nonexistent/ghost-deduction')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 100 });
    expect(res.status).toBe(404);
  });

  it('returns 403 for technician role', async () => {
    const { token } = await seedTechnicianWithToken();
    const res = await request(app)
      .post('/api/dispatch/pay-periods/any-id/ghost-deduction')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 100 });
    expect(res.status).toBe(403);
  });
});
