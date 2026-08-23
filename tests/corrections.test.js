const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');
const { generateReportJSON } = require('../src/services/report');
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
  it('requires a nonblank technician request message', async () => {
    const { tech, token } = await seedTechnicianWithToken();
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    const res = await request(app).post(`/api/visits/${visitId}/request-correction`)
      .set('Authorization', `Bearer ${token}`).send({ message: '  ' });
    expect(res.status).toBe(400);
  });
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
    expect(row.rows[0].initiator_id).toBe(tech.id);
    expect(row.rows[0].origin).toBe('technician_requested');
    expect(row.rows[0].status).toBe('open');
    expect(row.rows[0].request_message).toBe('Wrong total price, should be $150');
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

  it('allows a request for a closed Ledger week so Dispatch can reconcile a later adjustment', async () => {
    const { token, tech } = await seedTechnicianWithToken();
    const visitId = await seedCompletedVisitAt(tech.id, '2026-06-25T10:00:00Z');
    await seedPayPeriod('2026-06-23', '2026-06-29', 'closed');

    const res = await request(app)
      .post(`/api/visits/${visitId}/request-correction`)
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'fix' });

    expect(res.status).toBe(200);
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

describe('POST /api/dispatch/corrections and Finder', () => {
  it('creates a dispatcher-initiated correction without a Note', async () => {
    const { dispatcher, token } = await seedDispatcherWithToken();
    const { visitId } = await seedCompletedVisit();
    const res = await request(app).post('/api/dispatch/corrections').set('Authorization', `Bearer ${token}`)
      .send({ visitId });
    expect(res.status).toBe(201);
    const row = await pool.query('SELECT initiator_id, origin, request_message, note FROM corrections WHERE id = $1', [res.body.correctionId]);
    expect(row.rows[0]).toMatchObject({ initiator_id: dispatcher.id, origin: 'dispatcher_initiated', request_message: null, note: null });
  });

  it('finds terminal reports by order, address, technician, and completion date', async () => {
    const { token } = await seedDispatcherWithToken();
    const { visitId, technicianId } = await seedCompletedVisit();
    await pool.query(`UPDATE visits SET order_number = 'ORD-CORR-42', completed_at = '2026-08-20T10:00:00Z' WHERE id = $1`, [visitId]);
    const tech = await pool.query('SELECT name FROM technicians WHERE id = $1', [technicianId]);
    const address = await pool.query('SELECT a.street FROM visits v JOIN addresses a ON a.id = v.address_id WHERE v.id = $1', [visitId]);
    for (const query of ['orderNumber=ORD-CORR-42', `address=${encodeURIComponent(address.rows[0].street.slice(0, 8))}`, `technician=${encodeURIComponent(tech.rows[0].name)}`, 'date=2026-08-20', 'dateFrom=2026-08-20&dateTo=2026-08-20']) {
      const res = await request(app).get(`/api/dispatch/corrections/finder?${query}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.map(v => v.id)).toContain(visitId);
      expect(res.body.find(v => v.id === visitId).technician.name).toBe(tech.rows[0].name);
    }
  });

  it('requires at least one Finder filter', async () => {
    const { token } = await seedDispatcherWithToken();
    const res = await request(app).get('/api/dispatch/corrections/finder').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});

// ── PATCH /api/dispatch/corrections/:id/apply ──────────────────────────────────

describe('PATCH /api/dispatch/corrections/:id/apply', () => {
  async function seedOpenCorrection(visitId, techId, message = 'please fix') {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO corrections (id, visit_id, initiator_id, origin, request_message, status, requested_at)
       VALUES ($1, $2, $3, 'technician_requested', $4, 'open', $5)`,
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
      .set('Authorization', `Bearer ${token}`)
      .send({ changes: { notes: 'corrected notes' } });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('applied');
    expect(res.body.appliedAt).toBeDefined();

    const row = await pool.query('SELECT status, applied_at, applied_by, affected_domains, before_state, after_state FROM corrections WHERE id = $1', [corrId]);
    expect(row.rows[0].status).toBe('applied');
    expect(row.rows[0].applied_at).toBeDefined();
    expect(row.rows[0].applied_by).toBeDefined();
    expect(row.rows[0].affected_domains).toEqual(['notes']);
    expect(row.rows[0].before_state.notes).not.toBe('corrected notes');
    expect(row.rows[0].after_state.notes).toBe('corrected notes');
  });

  it('persists an optional administrative Note without changing technician request content', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    const corrId = await seedOpenCorrection(visitId, tech.id, 'Technician request remains intact');
    const res = await request(app).patch(`/api/dispatch/corrections/${corrId}/apply`)
      .set('Authorization', `Bearer ${token}`)
      .send({ note: 'Dispatcher verified source documents', changes: { notes: 'corrected notes' } });
    expect(res.status).toBe(200);
    const row = (await pool.query('SELECT request_message, note, actor_id FROM corrections c JOIN edit_log e ON e.correction_id = c.id WHERE c.id = $1', [corrId])).rows[0];
    expect(row).toMatchObject({ request_message: 'Technician request remains intact', note: 'Dispatcher verified source documents' });
    expect(row.actor_id).toBeTruthy();
  });

  it('updates structured source data and records linked audit data', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    const before = await pool.query('SELECT status, total_price FROM visits WHERE id = $1', [visitId]);
    const corrId = await seedOpenCorrection(visitId, tech.id);

    await request(app)
      .patch(`/api/dispatch/corrections/${corrId}/apply`)
      .set('Authorization', `Bearer ${token}`)
      .send({ changes: { notes: 'corrected notes' } });

    const after = await pool.query('SELECT notes, status, total_price FROM visits WHERE id = $1', [visitId]);
    expect(after.rows[0]).toMatchObject({ notes: 'corrected notes', status: before.rows[0].status, total_price: before.rows[0].total_price });
    const log = await pool.query('SELECT actor_id, correction_id, source FROM edit_log WHERE visit_id = $1', [visitId]);
    expect(log.rows[0]).toMatchObject({ correction_id: corrId, source: 'correction_approved' });
  });

  it('corrects report-source domains while preserving terminal state and recalculating derived values', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    const { visitId: unrelatedVisitId } = await seedCompletedVisit({ technicianId: tech.id });
    const suffix = crypto.randomUUID();
    const indoorModel = `Indoor-${suffix}`;
    const outdoorModel = `Outdoor-${suffix}`;
    const coilModel = `Coil-${suffix}`;
    const thermostat = `Thermostat-${suffix}`;
    const other = 'Other';
    const otherFix = 'Other Fix';
    const removedAccessory = `Removed-${suffix}`;
    const lineConfig = `Lineset-${suffix}`;
    await pool.query(
      `INSERT INTO catalog_equipment (model, unit_type, brand, refrigerant) VALUES
         ($1, 'furnace', 'Test', 'R-410A'),
         ($2, 'condenser', 'Test', 'R-32'),
         ($3, 'coil', 'Test', 'R-410A')`,
      [indoorModel, outdoorModel, coilModel]
    );
    await pool.query(`INSERT INTO catalog_lineset_configs (config_key, reference_length_ft, adjust_rate_oz_per_ft) VALUES ($1, 10, 0.6)`, [lineConfig]);
    await pool.query(`INSERT INTO catalog_services (service_name, default_price) VALUES ('AC', 150) ON CONFLICT (service_name) DO NOTHING`);
    await pool.query(
      `INSERT INTO catalog_items (item_name, category, default_price, tech_supplied, custom_price) VALUES
         ($1, 'thermostat', 0, true, false),
         ($2, 'accessory', 25, true, false)
       ON CONFLICT (item_name) DO NOTHING`,
      [thermostat, removedAccessory]
    );
    // The test database intentionally retains catalog data between runs. These
    // are canonical catalog entries, so create them only when a fresh test DB
    // has not been seeded yet.
    await pool.query(
      `INSERT INTO catalog_items (item_name, category, default_price, tech_supplied, custom_price) VALUES
         ('Other', 'accessory', null, true, true),
         ('Other Fix', 'fix', null, false, true)
       ON CONFLICT (item_name) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES ($1, $2, $3, 'accessory', 1, 25, true)`,
      [crypto.randomUUID(), visitId, removedAccessory]
    );
    const corrId = await seedOpenCorrection(visitId, tech.id);
    const res = await request(app).patch(`/api/dispatch/corrections/${corrId}/apply`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        note: 'Verified against field record',
        changes: {
          jobContext: { orderNumber: 'CORR-42', scheduledDate: '2026-08-22', scheduledTime: '9:30 AM', workType: 'Startup', companyNotes: 'Builder requested correction', contactName: 'Site Lead', contactPhone: '555-0100', contactChannel: 'phone' },
          propertyContext: { street: `42 ${suffix} Test Way`, city: 'Houston', state: 'TX', zip: '77001', subdivision: 'Corrected Sub', builder: 'Corrected Builder' },
          systems: [{ systemNumber: 1, indoorModel, outdoorModel, coilModel }],
          services: [{ serviceName: 'AC', isFinish: true }],
          items: [
            { itemName: thermostat, quantity: 2 },
            { itemName: other, quantity: 1, description: 'Custom accessory', price: 41 },
            { itemName: otherFix, quantity: 1, description: 'Custom repair', price: 17 },
          ],
          weighIn: [{ systemNumber: 1, factoryLineConfig: lineConfig, linesetLength: 15, factoryChargeOz: 90, adjustedOz: 93, fanSpeedCfm: 1200, liquidLineTemp: 82, suctionLineTemp: 48, condenserSatTemp: 96 }],
          checklistAnswers: [{ item: 'electric_meter', answer: 'yes' }, { item: 'gas_meter', answer: 'no' }],
          notes: 'Corrected notes',
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.totalPrice).toBe(78);
    expect(res.body.affectedDomains).toEqual(expect.arrayContaining(['job_context', 'property_context', 'systems', 'service', 'items', 'weigh_in', 'checklist', 'notes']));
    const detail = await request(app).get(`/api/dispatch/corrections/${corrId}`).set('Authorization', `Bearer ${token}`);
    expect(detail.body.beforeState.items).toEqual(expect.arrayContaining([expect.objectContaining({ item_name: removedAccessory })]));
    expect(detail.body.afterState).toMatchObject({ terminalStatus: 'completed', notes: 'Corrected notes', jobContext: { scheduledDate: '2026-08-22' } });
    expect(detail.body.afterState.propertyContext).toMatchObject({ builder: 'Corrected Builder', subdivision: 'Corrected Sub' });
    expect(detail.body.afterState.systems[0]).toMatchObject({ indoor_model: indoorModel, outdoor_model: outdoorModel, coil_model: coilModel, refrigerant: 'R-32' });
    expect(detail.body.afterState.weighIn[0]).toMatchObject({ factory_charge_oz: 90, approx_adjust_oz: 3, subcooling_value: 14, subcooling_deviation: 4 });
    expect(detail.body.afterState.items.map(item => item.item_name)).not.toContain(removedAccessory);
    const report = await generateReportJSON(pool, visitId);
    expect(report).toMatchObject({ totalPrice: 78, status: 'completed', scheduledDate: '2026-08-22', address: { builder: 'Corrected Builder' } });
    expect(report.systems[0]).toMatchObject({ indoorModel, outdoorModel, coilModel, refrigerant: 'R-32' });
    expect(report.items).toEqual(expect.arrayContaining([expect.objectContaining({ itemName: other, description: 'Custom accessory', price: 41 }), expect.objectContaining({ itemName: otherFix, description: 'Custom repair', price: 17 })]));
    expect(report.weighInData[0]).toMatchObject({ factoryChargeOz: 90, approxAdjustOz: 3, subcoolingValue: 14, subcoolingDeviation: 4 });
    const audit = await pool.query('SELECT summary FROM edit_log WHERE correction_id = $1', [corrId]);
    expect(audit.rows[0].summary).toMatch(/Service changed from/);
    expect(audit.rows[0].summary).toMatch(/Added Other\./);
    expect(audit.rows[0].summary).toMatch(/Removed/);
    expect(audit.rows[0].summary).toMatch(/System 1 indoor model changed/);
    expect(audit.rows[0].summary).toMatch(/Checklist updated/);
    expect((await pool.query('SELECT status FROM visits WHERE id = $1', [visitId])).rows[0].status).toBe('completed');
    expect((await pool.query('SELECT total_price FROM visits WHERE id = $1', [unrelatedVisitId])).rows[0].total_price).toBe(150);
  });

  it('rejects direct total input and does not permit duplicate catalog items', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    const corrId = await seedOpenCorrection(visitId, tech.id);
    const totalResult = await request(app).patch(`/api/dispatch/corrections/${corrId}/apply`)
      .set('Authorization', `Bearer ${token}`).send({ changes: { totalPrice: 999 } });
    expect(totalResult.status).toBe(400);
    const itemName = `Duplicate-${crypto.randomUUID()}`;
    await pool.query(`INSERT INTO catalog_items (item_name, category, default_price, tech_supplied) VALUES ($1, 'accessory', 10, true)`, [itemName]);
    const duplicateResult = await request(app).patch(`/api/dispatch/corrections/${corrId}/apply`)
      .set('Authorization', `Bearer ${token}`).send({ changes: { items: [{ itemName, quantity: 1 }, { itemName, quantity: 1 }] } });
    expect(duplicateResult.status).toBe(400);
    expect((await pool.query('SELECT total_price FROM visits WHERE id = $1', [visitId])).rows[0].total_price).toBe(150);
  });

  it('notifies the requesting technician', async () => {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    const corrId = await seedOpenCorrection(visitId, tech.id);

    await request(app)
      .patch(`/api/dispatch/corrections/${corrId}/apply`)
      .set('Authorization', `Bearer ${token}`)
      .send({ changes: { notes: 'corrected notes' } });

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
      .set('Authorization', `Bearer ${token}`)
      .send({ changes: { notes: 'corrected notes' } });

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
      .set('Authorization', `Bearer ${token}`)
      .send({ changes: { notes: 'corrected notes' } });

    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown correction', async () => {
    const { token } = await seedDispatcherWithToken();
    const res = await request(app)
      .patch('/api/dispatch/corrections/nonexistent-id/apply')
      .set('Authorization', `Bearer ${token}`)
      .send({ changes: { notes: 'corrected notes' } });
    expect(res.status).toBe(404);
  });

  it('returns 403 for technician role', async () => {
    const { token } = await seedTechnicianWithToken();
    const res = await request(app)
      .patch('/api/dispatch/corrections/some-id/apply')
      .set('Authorization', `Bearer ${token}`)
      .send({ changes: { notes: 'corrected notes' } });
    expect(res.status).toBe(403);
  });

  async function seedFinancialCorrection ({ sourceStatus = 'closed', itemPrice = 200, destination = true } = {}) {
    const { token } = await seedDispatcherWithToken();
    const { tech } = await seedTechnicianWithToken();
    const visitId = await seedCompletedVisitAt(tech.id, '2026-06-25T10:00:00Z');
    await pool.query('UPDATE visits SET total_price = 150 WHERE id = $1', [visitId]);
    const sourcePeriodId = await seedPayPeriod('2026-06-23', '2026-06-29', sourceStatus);
    await pool.query(
      `INSERT INTO pay_period_lines (id, period_id, technician_id, gross_amount, commission_rate_applied, commission_retained, net_amount)
       VALUES ($1, $2, $3, 150, 20, 30, 120)`, [crypto.randomUUID(), sourcePeriodId, tech.id]
    );
    const destinationPeriodId = destination ? await seedPayPeriod('2026-06-30', '2026-07-06', 'open') : null;
    const itemName = `Correction-priced-${crypto.randomUUID()}`;
    await pool.query(
      `INSERT INTO catalog_items (item_name, category, default_price, tech_supplied)
       VALUES ($1, 'accessory', $2, true)`, [itemName, itemPrice]
    );
    const correctionId = await seedOpenCorrection(visitId, tech.id, 'Correct compensation');
    return { token, tech, visitId, correctionId, sourcePeriodId, destinationPeriodId, itemName };
  }

  it('recalculates an open-period priced correction without creating an adjustment', async () => {
    const setup = await seedFinancialCorrection({ sourceStatus: 'open' });
    const res = await request(app).patch(`/api/dispatch/corrections/${setup.correctionId}/apply`)
      .set('Authorization', `Bearer ${setup.token}`)
      .send({ changes: { items: [{ itemName: setup.itemName, quantity: 1 }] } });
    expect(res.status).toBe(200);
    expect(res.body.totalPrice).toBe(200);
    expect(res.body.financialAdjustment).toBeNull();
    expect((await pool.query('SELECT * FROM pay_period_adjustments WHERE correction_id = $1', [setup.correctionId])).rowCount).toBe(0);
  });

  it('records one positive closed-period delta in a later open period and is retry-safe', async () => {
    const setup = await seedFinancialCorrection({ itemPrice: 200 });
    const apply = () => request(app).patch(`/api/dispatch/corrections/${setup.correctionId}/apply`)
      .set('Authorization', `Bearer ${setup.token}`)
      .send({ changes: { items: [{ itemName: setup.itemName, quantity: 1 }] } });
    const first = await apply();
    expect(first.status).toBe(200);
    expect(first.body.financialAdjustment).toMatchObject({ originalPayPeriodId: setup.sourcePeriodId, destinationPayPeriodId: setup.destinationPeriodId, originalAmount: 120, correctedAmount: 160, deltaAmount: 40, status: 'applied' });
    expect((await pool.query('SELECT gross_amount, net_amount FROM pay_period_lines WHERE period_id = $1', [setup.sourcePeriodId])).rows[0]).toMatchObject({ gross_amount: 150, net_amount: 120 });
    expect((await pool.query('SELECT * FROM pay_period_adjustments WHERE correction_id = $1', [setup.correctionId])).rowCount).toBe(1);
    expect((await apply()).status).toBe(400);
    expect((await pool.query('SELECT * FROM pay_period_adjustments WHERE correction_id = $1', [setup.correctionId])).rowCount).toBe(1);
  });

  it('preserves a negative closed-period delta and leaves it pending with no open destination', async () => {
    const setup = await seedFinancialCorrection({ itemPrice: 100, destination: false });
    const res = await request(app).patch(`/api/dispatch/corrections/${setup.correctionId}/apply`)
      .set('Authorization', `Bearer ${setup.token}`)
      .send({ changes: { items: [{ itemName: setup.itemName, quantity: 1 }] } });
    expect(res.status).toBe(200);
    expect(res.body.financialAdjustment).toMatchObject({ deltaAmount: -40, status: 'pending', destinationPayPeriodId: null });
    const adjustment = await pool.query('SELECT status, destination_pay_period_id, delta_amount FROM pay_period_adjustments WHERE correction_id = $1', [setup.correctionId]);
    expect(adjustment.rows[0]).toMatchObject({ status: 'pending', destination_pay_period_id: null, delta_amount: -40 });
  });

  it('keeps a paid period immutable and creates the same correction adjustment', async () => {
    const setup = await seedFinancialCorrection({ sourceStatus: 'paid', itemPrice: 200 });
    const res = await request(app).patch(`/api/dispatch/corrections/${setup.correctionId}/apply`)
      .set('Authorization', `Bearer ${setup.token}`)
      .send({ changes: { items: [{ itemName: setup.itemName, quantity: 1 }] } });
    expect(res.status).toBe(200);
    expect(res.body.financialAdjustment).toMatchObject({ originalPayPeriodId: setup.sourcePeriodId, destinationPayPeriodId: setup.destinationPeriodId, deltaAmount: 40 });
    expect((await pool.query('SELECT status FROM pay_periods WHERE id = $1', [setup.sourcePeriodId])).rows[0].status).toBe('paid');
    expect((await pool.query('SELECT net_amount FROM pay_period_lines WHERE period_id = $1', [setup.sourcePeriodId])).rows[0].net_amount).toBe(120);
  });
});

// ── GET /api/dispatch/corrections ─────────────────────────────────────────────

describe('GET /api/dispatch/corrections', () => {
  async function seedCorrection(visitId, techId, status = 'open') {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await pool.query(
      `INSERT INTO corrections (id, visit_id, initiator_id, origin, request_message, status, requested_at)
       VALUES ($1, $2, $3, 'technician_requested', 'a message', $4, $5)`,
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
    expect(entry.initiator).toHaveProperty('id', tech.id);
    expect(entry.initiator).toHaveProperty('name', tech.name);
    expect(entry.origin).toBe('technician_requested');
    expect(entry.requestMessage).toBe('a message');
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
      `INSERT INTO corrections (id, visit_id, initiator_id, origin, request_message, status, requested_at)
       VALUES ($1, $2, $3, 'technician_requested', 'detail message', 'open', $4)`,
      [corrId, visitId, tech.id, new Date().toISOString()]
    );

    const res = await request(app)
      .get(`/api/dispatch/corrections/${corrId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(corrId);
    expect(res.body.requestMessage).toBe('detail message');
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
