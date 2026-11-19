const request = require('supertest');
const { randomUUID } = require('crypto');
const app = require('../src/index');
const { pool: appPool } = require('../src/db/pool');
const reportService = require('../src/services/report');
const { pool, truncateTables } = require('./helpers/db');
const { seedAssignedVisit, seedDispatcherWithToken, seedTechnicianWithToken } = require('./helpers/seeds');

beforeEach(truncateTables);
afterAll(async () => {
  await Promise.all([pool.end(), appPool.end()]);
});

function interceptTransactionClients(hook) {
  const origConnect = appPool.connect.bind(appPool);
  let clientIndex = 0;
  return jest.spyOn(appPool, 'connect').mockImplementation(function (...args) {
    if (args.length > 0) {
      return origConnect(...args);
    }
    clientIndex += 1;
    const currentClientIndex = clientIndex;
    return origConnect().then((client) => {
      const origQuery = client.query.bind(client);
      const origRelease = client.release.bind(client);
      client.query = async function (sql, params, ...rest) {
        return hook({
          clientIndex: currentClientIndex,
          client,
          origQuery,
          sql,
          params,
          rest,
        });
      };
      client.release = function (...releaseArgs) {
        client.query = origQuery;
        client.release = origRelease;
        return origRelease(...releaseArgs);
      };
      return client;
    });
  });
}

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

async function reviewedSnapshot(visitId, snapshot) {
  const report = await reportService.generateReportJSON(pool, visitId);
  const visitContext = await pool.query('SELECT address_id, work_type FROM visits WHERE id = $1', [visitId]);
  const sourceItems = snapshot.items ?? [];
  const reviewedItems = await Promise.all(sourceItems.map(async item => {
    const itemName = item.itemName ?? item.item_name;
    const result = await pool.query(
      'SELECT category, default_price, tech_supplied FROM catalog_items WHERE item_name = $1', [itemName]
    );
    const catalog = result.rows[0] ?? {};
    return {
      itemName,
      item_name: itemName,
      category: item.category ?? catalog.category,
      description: item.description ?? null,
      quantity: item.quantity ?? 1,
      price: item.price ?? catalog.default_price ?? null,
      techSupplied: item.techSupplied ?? item.tech_supplied ?? catalog.tech_supplied ?? false,
    };
  }));
  const evidence = await pool.query(
    `SELECT id, slug, tag, label, category, system_number AS "systemNumber", stored_at AS "storedAt"
     FROM visit_photos WHERE visit_id = $1 ORDER BY id`, [visitId]
  );
  const mergeRows = (submittedRows, currentRows, key) => {
    if (!Array.isArray(submittedRows) || submittedRows.length === 0) return currentRows;
    return submittedRows.map(row => ({
      ...(currentRows.find(current => current[key] === (row[key] ?? row[key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)])) ?? {}),
      ...row,
    }));
  };
  const currentService = report.services?.[0];
  const service = snapshot.service ?? {};
  return {
    ...snapshot,
    orderNumber: snapshot.orderNumber ?? report.orderNumber,
    scheduledDate: snapshot.scheduledDate ?? report.scheduledDate,
    scheduledTime: snapshot.scheduledTime ?? report.scheduledTime,
    propertyId: snapshot.propertyId ?? visitContext.rows[0].address_id,
    workType: snapshot.workType ?? visitContext.rows[0].work_type,
    hasMultipleSystems: snapshot.hasMultipleSystems ?? report.hasMultipleSystems,
    totalPrice: snapshot.totalPrice ?? report.totalPrice,
    address: snapshot.address ?? report.address,
    service: currentService ? { ...currentService, ...service } : service,
    items: mergeRows(reviewedItems, report.items ?? [], 'itemName'),
    systems: mergeRows(snapshot.systems, report.systems ?? [], 'systemNumber'),
    weighInData: mergeRows(snapshot.weighInData, report.weighInData ?? [], 'systemNumber'),
    evidenceRefs: snapshot.evidenceRefs?.length ? snapshot.evidenceRefs : evidence.rows,
    notes: snapshot.notes ?? '',
    checklistAnswers: snapshot.checklistAnswers ?? [],
  };
}

async function simulateSubmissionUniqueViolation({ visitId, token, tech, snapshot, acceptedSubmissionId }) {
  snapshot = await reviewedSnapshot(visitId, snapshot);
  const originalError = Object.assign(
    new Error('duplicate key value violates unique constraint "completion_submissions_pkey"'),
    { code: '23505' }
  );
  const connectSpy = interceptTransactionClients(async ({ clientIndex, origQuery, sql, params, rest }) => {
    if (clientIndex === 1 && typeof sql === 'string' && sql.includes('INSERT INTO completion_submissions')) {
      throw originalError;
    }
    if (clientIndex === 1 && typeof sql === 'string' && sql === 'ROLLBACK' && acceptedSubmissionId) {
      const result = await origQuery(sql, params, ...rest);
      const acceptedAt = new Date().toISOString();
      await pool.query('UPDATE visits SET status = \'completed\', completed_at = $1 WHERE id = $2', [acceptedAt, visitId]);
      const sourceSubmission = { ...snapshot, submissionId: acceptedSubmissionId };
      const acceptedSnapshot = await reportService.createCanonicalReportSnapshot(pool, visitId, {
        submissionId: acceptedSubmissionId,
        technicianId: tech.id,
        generatedAt: snapshot.createdAt,
        acceptedAt,
        sourceSubmission,
      });
      await pool.query(
        `INSERT INTO completion_submissions
           (submission_id, visit_id, technician_id, terminal_intent, snapshot, accepted_at)
         VALUES ($1, $2, $3, 'completed', $4, $5)`,
        [acceptedSubmissionId, visitId, tech.id, JSON.stringify(acceptedSnapshot), acceptedAt]
      );
      return result;
    }
    return origQuery(sql, params, ...rest);
  });

  try {
    const response = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ submissionId: snapshot.submissionId, snapshot: await reviewedSnapshot(visitId, snapshot) });
    return { response, originalError };
  } finally {
    connectSpy.mockRestore();
  }
}

// ── POST /api/visits/:id/complete ────────────────────────────────────────────

describe('POST /api/visits/:id/complete', () => {
  it('completes a visit with AC service — returns report JSON and sets status=completed', async () => {
    const { visitId, token, street } = await seedAssignedVisit();
    await addService(visitId, 'AC');
    const checklistAnswers = [{ item: 'pdrain_ecoil', answer: 'yes', photoCount: 0, reportText: null }];

    const res = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ checklistAnswers });

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

    const detail = await request(app)
      .get(`/api/visits/${visitId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detail.body.checklistAnswers).toEqual(checklistAnswers);
  });

  it('completes a Finish-only visit because it has a valid zero-priced Service selection', async () => {
    const { visitId, token } = await seedAssignedVisit();
    await pool.query(
      `INSERT INTO catalog_services (service_name, default_price, is_bundle, multiplies_by_system_count)
       VALUES ('Finish', 0, false, false)
       ON CONFLICT (service_name) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO visit_services (id, visit_id, service_name, is_finish, is_temporarily, price)
       VALUES (gen_random_uuid()::text, $1, 'Finish', true, false, 0)`,
      [visitId]
    );

    const res = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.services).toEqual([expect.objectContaining({ serviceName: 'Finish', isFinish: true, price: 0 })]);
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

  it('sets status=cancelled when an existing Cancel service has a justification', async () => {
    const { visitId, token } = await seedAssignedVisit();
    await addService(visitId, 'Cancel');

    const res = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'Customer not present' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
  });

  it('rejects Cancel completion when both notes and checklist are empty', async () => {
    const { visitId, token } = await seedAssignedVisit();

    const res = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cancel: true, notes: '', checklistAnswers: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Cancel requires notes or a checklist answer');
    const visit = await pool.query('SELECT status FROM visits WHERE id = $1', [visitId]);
    expect(visit.rows[0].status).toBe('assigned');
  });

  it('finalizes Cancel only on completion, clearing work data while preserving notes and checklist', async () => {
    const { visitId, token, addressId } = await seedAssignedVisit();
    await addService(visitId, 'AC');
    await pool.query(`
      INSERT INTO catalog_items (item_name, category, default_price, tech_supplied)
      VALUES ('COMPLETE-CANCEL-ITEM', 'accessory', 10, false)
      ON CONFLICT (item_name) DO NOTHING
    `);
    await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, 'COMPLETE-CANCEL-ITEM', 'accessory', 1, 10, false)`,
      [visitId]
    );
    await pool.query(
      `INSERT INTO catalog_lineset_configs (config_key, reference_length_ft, adjust_rate_oz_per_ft)
       VALUES ('COMPLETE-CANCEL-LINESET', 15, 0.6)
       ON CONFLICT (config_key) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO weigh_in_data (id, address_id, system_number, lineset_length, factory_line_config)
       VALUES (gen_random_uuid()::text, $1, 1, 25, 'COMPLETE-CANCEL-LINESET')`,
      [addressId]
    );
    await pool.query(
      `INSERT INTO visit_photos (id, visit_id, system_number, slug, tag, label, category, stored_at)
       VALUES (gen_random_uuid()::text, $1, 1, 'CANCEL_SCALE', 'SCALE', null, 'weigh_in_scale', null),
              (gen_random_uuid()::text, $1, null, 'CANCEL_EVIDENCE', 'gas_meter', null, 'site_evidence', null)`,
      [visitId]
    );
    const checklistAnswers = [{ item: 'gas_meter', answer: 'no', photoCount: 0, reportText: 'gas meter closed/missing' }];

    const res = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cancel: true, notes: 'Customer not present', checklistAnswers });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    expect(res.body.totalPrice).toBe(0);
    expect(res.body.services).toEqual([expect.objectContaining({ serviceName: 'Cancel', price: 0 })]);
    expect(res.body.items).toEqual([]);
    expect(res.body.weighInData).toEqual([]);
    expect(res.body.photos).toEqual([{ slug: 'CANCEL_EVIDENCE' }]);
    const visit = await pool.query(
      'SELECT status, total_price, notes, checklist_answers FROM visits WHERE id = $1',
      [visitId]
    );
    expect(visit.rows[0]).toMatchObject({ status: 'cancelled', total_price: 0, notes: 'Customer not present' });
    expect(visit.rows[0].checklist_answers).toEqual(checklistAnswers);
    const detail = await request(app)
      .get(`/api/visits/${visitId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detail.body.checklistAnswers).toEqual(checklistAnswers);
    await expect(pool.query('SELECT id FROM weigh_in_data WHERE address_id = $1', [addressId])).resolves.toMatchObject({ rowCount: 1 });
    await expect(pool.query('SELECT id FROM visit_photos WHERE visit_id = $1', [visitId])).resolves.toMatchObject({ rowCount: 2 });
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

  it('acknowledges one immutable submission identity without duplicate completion effects', async () => {
    const { visitId, token, tech } = await seedAssignedVisit();
    await addService(visitId, 'AC');
    const itemName = `SUBMISSION-ITEM-${randomUUID()}`;
    await pool.query(
      `INSERT INTO catalog_items (item_name, category, default_price, tech_supplied)
       VALUES ($1, 'accessory', 10, true)`, [itemName]
    );
    const snapshot = {
      version: 1,
      submissionId: 'completion-submission-1',
      visitId,
      technicianId: tech.id,
      createdAt: '2026-08-23T10:00:00.000Z',
      terminalIntent: 'completed',
      cancel: false,
      service: { serviceName: 'AC', ac: true },
      items: [{ id: 'local-item', item_name: itemName, category: 'accessory', quantity: 1, price: 10 }],
      weighInData: [], systems: [], notes: 'Submitted once',
      checklistAnswers: [], evidenceRefs: [], totalPrice: 160,
    };

    const first = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ submissionId: snapshot.submissionId, snapshot: await reviewedSnapshot(visitId, snapshot) });
    const retry = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ submissionId: snapshot.submissionId, snapshot: await reviewedSnapshot(visitId, snapshot) });

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(first.body).toMatchObject({ acknowledged: true, submissionId: snapshot.submissionId, status: 'completed' });
    expect(retry.body).toMatchObject({ acknowledged: true, submissionId: snapshot.submissionId, status: 'completed' });
    expect(first.body.items).toEqual([expect.objectContaining({ itemName, price: 10 })]);
    await expect(pool.query('SELECT * FROM completion_submissions WHERE submission_id = $1', [snapshot.submissionId]))
      .resolves.toMatchObject({ rowCount: 1 });
  });

  it('stores a complete server-authored Report snapshot and retries it unchanged after reassignment', async () => {
    const { visitId, token, tech, addressId } = await seedAssignedVisit();
    await addService(visitId, 'AC');
    const submissionId = 'canonical-report-reassignment';
    const snapshot = {
      version: 1, submissionId, visitId, technicianId: tech.id,
      createdAt: '2026-08-23T10:00:00.000Z', terminalIntent: 'completed', cancel: false,
      service: { serviceName: 'AC', ac: true }, items: [], weighInData: [], systems: [],
      notes: 'Accepted original notes', checklistAnswers: [], evidenceRefs: [], totalPrice: 150,
    };

    const accepted = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ submissionId, snapshot: await reviewedSnapshot(visitId, snapshot) });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({
      submissionId, technicianId: tech.id, technicianName: tech.name,
      propertyId: addressId, address: { street: expect.any(String) },
      status: 'completed', totalPrice: 150,
    });
    const stored = await pool.query(
      'SELECT snapshot, technician_id, accepted_at FROM completion_submissions WHERE submission_id = $1',
      [submissionId]
    );
    const reviewed = await reviewedSnapshot(visitId, snapshot);
    expect(stored.rows[0].snapshot).toMatchObject({
      version: 2, submissionId, visitId, technicianId: tech.id, technicianName: tech.name,
      propertyId: addressId, generatedAt: snapshot.createdAt, acceptedAt: stored.rows[0].accepted_at,
      sourceSubmission: reviewed,
    });
    expect(stored.rows[0].snapshot).toHaveProperty('orderNumber');
    expect(stored.rows[0].snapshot).toHaveProperty('scheduledDate');
    expect(stored.rows[0].snapshot).toHaveProperty('scheduledTime');
    expect(stored.rows[0].snapshot).toHaveProperty('completedAt');
    expect(stored.rows[0].snapshot).toHaveProperty('hasMultipleSystems');
    expect(stored.rows[0].snapshot).toHaveProperty('photoEvidence');

    const beforeJson = await reportService.generateReportJSON(pool, visitId);
    const beforeText = await reportService.generateReportText(pool, visitId);
    const { tech: newAssignee, token: newToken } = await seedTechnicianWithToken({ name: 'New-Assignee' });
    await pool.query('UPDATE visits SET technician_id = $1 WHERE id = $2', [newAssignee.id, visitId]);
    await pool.query('UPDATE addresses SET street = $1 WHERE id = $2', ['Mutated address', addressId]);
    await pool.query('UPDATE visits SET notes = $1, total_price = 999 WHERE id = $2', ['Mutated notes', visitId]);
    await pool.query("UPDATE visit_services SET service_name = 'Heat', price = 999 WHERE visit_id = $1", [visitId]);

    await expect(reportService.generateReportJSON(pool, visitId)).resolves.toEqual(beforeJson);
    await expect(reportService.generateReportText(pool, visitId)).resolves.toBe(beforeText);

    const retry = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ submissionId, snapshot: await reviewedSnapshot(visitId, snapshot) });
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ acknowledged: true, submissionId, technicianId: tech.id, technicianName: tech.name });
    expect(retry.body.address).toEqual(beforeJson.address);
    expect(retry.body.totalPrice).toBe(beforeJson.totalPrice);

    const forgedRetry = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${newToken}`)
      .send({ submissionId, snapshot: await reviewedSnapshot(visitId, { ...snapshot, technicianId: newAssignee.id }) });
    expect(forgedRetry.status).toBe(403);
  });

  it('accepts a catalog-derived total that differs and records both values (PP-01)', async () => {
    const { visitId, token, tech } = await seedAssignedVisit();
    await addService(visitId, 'AC');
    const snapshot = {
      version: 1, submissionId: 'server-total-discrepancy', visitId, technicianId: tech.id,
      createdAt: '2026-08-23T10:00:00.000Z', terminalIntent: 'completed', cancel: false,
      service: { serviceName: 'AC', ac: true }, items: [], weighInData: [], systems: [],
      notes: 'Device total differs', checklistAnswers: [], evidenceRefs: [], totalPrice: 999,
    };

    const response = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ submissionId: snapshot.submissionId, snapshot: await reviewedSnapshot(visitId, snapshot) });
    expect(response.status).toBe(200);
    expect(response.body.priceDiscrepancies).toEqual([
      expect.objectContaining({ field: 'totalPrice', submitted: 999 }),
    ]);
    const stored = (await pool.query('SELECT snapshot FROM completion_submissions WHERE visit_id = $1', [visitId])).rows[0].snapshot;
    expect(stored.sourceSubmission.totalPrice).toBe(999);
    expect(stored.totalPrice).not.toBe(999);
  });

  it('rolls back a structural difference without accepting or finalizing the Service, naming the field', async () => {
    const { visitId, token, tech } = await seedAssignedVisit();
    await addService(visitId, 'AC');
    const snapshot = {
      version: 1, submissionId: 'server-structure-mismatch', visitId, technicianId: tech.id,
      createdAt: '2026-08-23T10:00:00.000Z', terminalIntent: 'completed', cancel: false,
      service: { serviceName: 'AC', ac: true }, items: [], weighInData: [], systems: [],
      notes: 'Must roll back', checklistAnswers: [], evidenceRefs: [], totalPrice: 150,
    };
    await pool.query(
      `INSERT INTO transfers (id, visit_id, from_tech_id, to_tech_id, status, created_at)
       VALUES (gen_random_uuid()::text, $1, $2, $3, 'pending', $4)`,
      [visitId, tech.id, tech.id, new Date().toISOString()]
    );

    const reviewed = { ...await reviewedSnapshot(visitId, snapshot), scheduledTime: 'changed on device' };
    const response = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ submissionId: snapshot.submissionId, snapshot: reviewed });
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/correct and resubmit/i);
    expect(response.body.fields).toEqual(['scheduledTime']);
    expect((await pool.query('SELECT status FROM visits WHERE id = $1', [visitId])).rows[0].status).toBe('assigned');
    expect((await pool.query('SELECT count(*)::int AS count FROM completion_submissions WHERE visit_id = $1', [visitId])).rows[0].count).toBe(0);
    expect((await pool.query('SELECT status FROM transfers WHERE visit_id = $1', [visitId])).rows[0].status).toBe('pending');
    expect((await pool.query('SELECT service_name FROM visit_services WHERE visit_id = $1', [visitId])).rows[0].service_name).toBe('AC');
  });

  it('returns 409 without generating a report for a different submission ID after the visit is terminal', async () => {
    const { visitId, token, tech } = await seedAssignedVisit();
    await addService(visitId, 'AC');
    const makeSnapshot = submissionId => ({
      version: 1, submissionId, visitId, technicianId: tech.id,
      createdAt: '2026-08-23T10:00:00.000Z', terminalIntent: 'completed', cancel: false,
      service: { serviceName: 'AC', ac: true }, items: [], weighInData: [], systems: [],
      notes: 'Terminal identity test', checklistAnswers: [], evidenceRefs: [], totalPrice: 150,
    });

    const first = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ submissionId: 'terminal-accepted-id', snapshot: await reviewedSnapshot(visitId, makeSnapshot('terminal-accepted-id')) });
    expect(first.status).toBe(200);

    const reportSpy = jest.spyOn(reportService, 'generateReportJSON');
    try {
      const conflict = await request(app)
        .post(`/api/visits/${visitId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .send({ submissionId: 'terminal-different-id', snapshot: makeSnapshot('terminal-different-id') });
      expect(conflict.status).toBe(409);
      expect(conflict.body).toEqual({ error: 'Visit already has a different accepted submission' });
      expect(reportSpy).not.toHaveBeenCalled();
    } finally {
      reportSpy.mockRestore();
    }
  });

  it('enforces visit ownership before terminal-visit idempotency — different technician gets 403 on completed visit without generating report (Case A)', async () => {
    const { visitId, token } = await seedAssignedVisit();
    await addService(visitId, 'AC');

    // Complete it with the owner technician's token
    const first = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`);
    expect(first.status).toBe(200);

    // Another technician attempts to complete or fetch the completed visit report
    const { token: otherToken } = await seedTechnicianWithToken({ name: 'Other-Tech' });
    const reportSpy = jest.spyOn(reportService, 'generateReportJSON');
    try {
      const res = await request(app)
        .post(`/api/visits/${visitId}/complete`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'This visit is not assigned to you' });
      expect(reportSpy).not.toHaveBeenCalled();
    } finally {
      reportSpy.mockRestore();
    }
  });

  it('rejects reuse of another technician submissionId with 403 without generating report (Case B)', async () => {
    const { visitId, token, tech } = await seedAssignedVisit();
    await addService(visitId, 'AC');
    const submissionId = 'tech-a-submission-id';
    const snapshot = {
      version: 1,
      submissionId,
      visitId,
      technicianId: tech.id,
      createdAt: '2026-08-23T10:00:00.000Z',
      terminalIntent: 'completed',
      cancel: false,
      service: { serviceName: 'AC', ac: true },
      items: [],
      weighInData: [],
      systems: [],
      notes: 'Tech A completion',
      checklistAnswers: [],
      evidenceRefs: [],
      totalPrice: 150,
    };

    const first = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ submissionId, snapshot: await reviewedSnapshot(visitId, snapshot) });
    expect(first.status).toBe(200);

    const { tech: otherTech, token: otherToken } = await seedTechnicianWithToken({ name: 'Other-Tech-B' });
    const reportSpy = jest.spyOn(reportService, 'generateReportJSON');
    try {
      // 1. Tech B tries to reuse Tech A's submissionId against Tech A's visit
      const resAgainstVisitA = await request(app)
        .post(`/api/visits/${visitId}/complete`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ submissionId, snapshot });

      expect(resAgainstVisitA.status).toBe(403);
      expect(resAgainstVisitA.body).toEqual({ error: 'This visit is not assigned to you' });
      expect(reportSpy).not.toHaveBeenCalled();

      // 2. Even if the visit were later reassigned to Tech B in DB, Tech B cannot claim Tech A's submissionId
      await pool.query('UPDATE visits SET technician_id = $1 WHERE id = $2', [otherTech.id, visitId]);
      const resAfterReassign = await request(app)
        .post(`/api/visits/${visitId}/complete`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ submissionId, snapshot });

      expect(resAfterReassign.status).toBe(403);
      expect(resAfterReassign.body).toEqual({ error: 'This visit is not assigned to you' });
      expect(reportSpy).not.toHaveBeenCalled();

      // The visit is now assigned to Tech B, but the accepted identity still belongs to Tech A.
      const techBSnapshot = { ...snapshot, technicianId: otherTech.id };
      const resWrongAcceptedTechnician = await request(app)
        .post(`/api/visits/${visitId}/complete`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ submissionId, snapshot: techBSnapshot });
      expect(resWrongAcceptedTechnician.status).toBe(403);
      expect(resWrongAcceptedTechnician.body).toEqual({ error: 'This visit is not assigned to you' });
      expect(reportSpy).not.toHaveBeenCalled();
    } finally {
      reportSpy.mockRestore();
    }
  });

  it('returns 403 without generating report if technician is not the assignee on a non-terminal visit (Case D)', async () => {
    const { visitId } = await seedAssignedVisit();
    const { token: otherToken } = await seedTechnicianWithToken({ name: 'Not-Assignee' });
    await addService(visitId, 'AC');

    const reportSpy = jest.spyOn(reportService, 'generateReportJSON');
    try {
      const res = await request(app)
        .post(`/api/visits/${visitId}/complete`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'This visit is not assigned to you' });
      expect(reportSpy).not.toHaveBeenCalled();
    } finally {
      reportSpy.mockRestore();
    }
  });

  it('re-verifies visit ownership inside the FOR UPDATE transaction and returns 403 if reassigned concurrently (Case E)', async () => {
    const { visitId, token, tech } = await seedAssignedVisit();
    await addService(visitId, 'AC');
    const { tech: otherTech } = await seedTechnicianWithToken({ name: 'Concurrent-Assignee' });

    const submissionId = 'sub-concurrent-reassign';
    const snapshot = {
      version: 1,
      submissionId,
      visitId,
      technicianId: tech.id,
      createdAt: '2026-08-23T10:00:00.000Z',
      terminalIntent: 'completed',
      cancel: false,
      service: { serviceName: 'AC', ac: true },
      items: [],
      weighInData: [],
      systems: [],
      notes: 'Concurrent reassignment test',
      checklistAnswers: [],
      evidenceRefs: [],
      totalPrice: 150,
    };

    let notifyReachedForUpdate;
    const reachedForUpdate = new Promise((resolve) => {
      notifyReachedForUpdate = resolve;
    });

    const lockClient = await pool.connect();
    const connectSpy = interceptTransactionClients(async ({ origQuery, sql, params, rest }) => {
      if (typeof sql === 'string' && sql.includes('FOR UPDATE')) {
        notifyReachedForUpdate();
      }
      return origQuery(sql, params, ...rest);
    });
    const reportSpy = jest.spyOn(reportService, 'generateReportJSON');

    try {
      await lockClient.query('BEGIN');
      await lockClient.query('SELECT id FROM visits WHERE id = $1 FOR UPDATE', [visitId]);

      const reqPromise = request(app)
        .post(`/api/visits/${visitId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .send({ submissionId, snapshot })
        .then(res => res);

      await reachedForUpdate;

      await lockClient.query(
        `UPDATE visits SET technician_id = $1, status = 'completed', completed_at = $2 WHERE id = $3`,
        [otherTech.id, new Date().toISOString(), visitId]
      );
      await lockClient.query('COMMIT');

      const res = await reqPromise;

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'This visit is not assigned to you' });
      expect(reportSpy).not.toHaveBeenCalled();
    } finally {
      await lockClient.query('ROLLBACK').catch(() => {});
      lockClient.release();
      connectSpy.mockRestore();
      reportSpy.mockRestore();
    }
  });

  it('returns 409 without generating report when reusing an existing submissionId for a different visit (Case F)', async () => {
    const { visitId: visitA, token, tech, addressId } = await seedAssignedVisit();
    await addService(visitA, 'AC');

    // Create a second visit assigned to the same technician
    const visitBResult = await pool.query(
      `INSERT INTO visits (id, order_number, address_id, date, scheduled_time, status, technician_id, has_multiple_systems, total_price, created_at, updated_at)
       VALUES (gen_random_uuid()::text, 'ORD-VISIT-B', $1, '2026-08-23', '10:00', 'assigned', $2, false, 150, now()::text, now()::text)
       RETURNING id`,
      [addressId, tech.id]
    );
    const visitB = visitBResult.rows[0].id;
    await addService(visitB, 'AC');

    const submissionId = 'shared-submission-id-conflict';
    const snapshotA = {
      version: 1,
      submissionId,
      visitId: visitA,
      technicianId: tech.id,
      createdAt: '2026-08-23T10:00:00.000Z',
      terminalIntent: 'completed',
      cancel: false,
      service: { serviceName: 'AC', ac: true },
      items: [],
      weighInData: [],
      systems: [],
      notes: 'Visit A completion',
      checklistAnswers: [],
      evidenceRefs: [],
      totalPrice: 150,
    };

    const first = await request(app)
      .post(`/api/visits/${visitA}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ submissionId, snapshot: await reviewedSnapshot(visitA, snapshotA) });
    expect(first.status).toBe(200);

    const reportSpy = jest.spyOn(reportService, 'generateReportJSON');
    try {
      const snapshotBWithReusedId = {
        ...snapshotA,
        visitId: visitB,
      };
      const conflictRes = await request(app)
        .post(`/api/visits/${visitB}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .send({ submissionId, snapshot: snapshotBWithReusedId });

      expect(conflictRes.status).toBe(409);
      expect(conflictRes.body).toEqual({ error: 'Submission belongs to a different visit' });
      expect(reportSpy).not.toHaveBeenCalled();
    } finally {
      reportSpy.mockRestore();
    }
  });

  it('acknowledges the exact accepted submission after reassignment before the FOR UPDATE lock (Case G)', async () => {
    const { visitId, token, tech } = await seedAssignedVisit();
    await addService(visitId, 'AC');
    const { tech: otherTech } = await seedTechnicianWithToken({ name: 'Reassigned-Tech-G' });

    const submissionId = 'sub-case-g-idempotent-reassign';
    const snapshot = {
      version: 1,
      submissionId,
      visitId,
      technicianId: tech.id,
      createdAt: '2026-08-23T10:00:00.000Z',
      terminalIntent: 'completed',
      cancel: false,
      service: { serviceName: 'AC', ac: true },
      items: [],
      weighInData: [],
      systems: [],
      notes: 'Completed by Tech A before retry race',
      checklistAnswers: [],
      evidenceRefs: [],
      totalPrice: 150,
    };
    const reviewed = await reviewedSnapshot(visitId, snapshot);

    // 1. Technician A completes the visit with submissionId
    const initialRes = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ submissionId, snapshot: reviewed });
    expect(initialRes.status).toBe(200);

    // 2. Technician A retries the same accepted submission while a concurrent reassignment occurs before FOR UPDATE
    let notifyReachedForUpdate;
    const reachedForUpdate = new Promise((resolve) => {
      notifyReachedForUpdate = resolve;
    });

    const lockClient = await pool.connect();
    const connectSpy = interceptTransactionClients(async ({ origQuery, sql, params, rest }) => {
      if (typeof sql === 'string' && sql.includes('FOR UPDATE')) {
        notifyReachedForUpdate();
      }
      return origQuery(sql, params, ...rest);
    });
    const reportSpy = jest.spyOn(reportService, 'generateReportJSON');

    try {
      await lockClient.query('BEGIN');
      await lockClient.query('SELECT id FROM visits WHERE id = $1 FOR UPDATE', [visitId]);

      const retryPromise = request(app)
        .post(`/api/visits/${visitId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .send({ submissionId, snapshot: reviewed })
        .then(res => res);

      await reachedForUpdate;

      await lockClient.query(
        'UPDATE visits SET technician_id = $1 WHERE id = $2',
        [otherTech.id, visitId]
      );
      await lockClient.query('COMMIT');

      const retryRes = await retryPromise;

      expect(retryRes.status).toBe(200);
      expect(retryRes.body).toMatchObject({ acknowledged: true, submissionId, technicianId: tech.id });
      expect(reportSpy).toHaveBeenCalledTimes(1);
    } finally {
      await lockClient.query('ROLLBACK').catch(() => {});
      lockClient.release();
      connectSpy.mockRestore();
      reportSpy.mockRestore();
    }
  });

  it('rejects terminal-status completion request with 403 if visit is concurrently reassigned before FOR UPDATE lock (Case H)', async () => {
    const { visitId, token } = await seedAssignedVisit();
    await addService(visitId, 'AC');
    const { tech: otherTech } = await seedTechnicianWithToken({ name: 'Reassigned-Tech-H' });

    // 1. Technician A completes the visit (visit is now in terminal status 'completed')
    const initialRes = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`);
    expect(initialRes.status).toBe(200);
    expect(initialRes.body.status).toBe('completed');

    // 2. Technician A sends a completion request without submissionId while visit is concurrently reassigned before FOR UPDATE
    let notifyReachedForUpdate;
    const reachedForUpdate = new Promise((resolve) => {
      notifyReachedForUpdate = resolve;
    });

    const lockClient = await pool.connect();
    const connectSpy = interceptTransactionClients(async ({ origQuery, sql, params, rest }) => {
      if (typeof sql === 'string' && sql.includes('FOR UPDATE')) {
        notifyReachedForUpdate();
      }
      return origQuery(sql, params, ...rest);
    });
    const reportSpy = jest.spyOn(reportService, 'generateReportJSON');

    try {
      await lockClient.query('BEGIN');
      await lockClient.query('SELECT id FROM visits WHERE id = $1 FOR UPDATE', [visitId]);

      const retryPromise = request(app)
        .post(`/api/visits/${visitId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .then(res => res);

      await reachedForUpdate;

      await lockClient.query(
        'UPDATE visits SET technician_id = $1 WHERE id = $2',
        [otherTech.id, visitId]
      );
      await lockClient.query('COMMIT');

      const retryRes = await retryPromise;

      expect(retryRes.status).toBe(403);
      expect(retryRes.body).toEqual({ error: 'This visit is not assigned to you' });
      expect(reportSpy).not.toHaveBeenCalled();
    } finally {
      await lockClient.query('ROLLBACK').catch(() => {});
      lockClient.release();
      connectSpy.mockRestore();
      reportSpy.mockRestore();
    }
  });

  it('acquires FOR UPDATE lock in 23505 recovery and acknowledges the original identity after reassignment (Case I)', async () => {
    const { visitId, token, tech } = await seedAssignedVisit();
    await addService(visitId, 'AC');
    const { tech: otherTech } = await seedTechnicianWithToken({ name: 'Reassigned-Tech-I' });

    const submissionId = 'sub-case-i-23505-recovery';
    const snapshot = {
      version: 1,
      submissionId,
      visitId,
      technicianId: tech.id,
      createdAt: '2026-08-23T10:00:00.000Z',
      terminalIntent: 'completed',
      cancel: false,
      service: { serviceName: 'AC', ac: true },
      items: [],
      weighInData: [],
      systems: [],
      notes: '23505 recovery race test',
      checklistAnswers: [],
      evidenceRefs: [],
      totalPrice: 150,
    };

    let notifyRecoveryReachedForUpdate;
    const recoveryReachedForUpdate = new Promise((resolve) => {
      notifyRecoveryReachedForUpdate = resolve;
    });
    let mainTxReleasedLockResolve;
    const mainTxReleasedLock = new Promise((resolve) => {
      mainTxReleasedLockResolve = resolve;
    });
    let recoveryLockReadyResolve;
    const recoveryLockReady = new Promise((resolve) => {
      recoveryLockReadyResolve = resolve;
    });

    const lockClient = await pool.connect();
    let recoveryForUpdateCalled = false;

    const connectSpy = interceptTransactionClients(async ({ clientIndex, origQuery, sql, params, rest }) => {
      // In transaction #1 (main completion tx), when INSERT INTO completion_submissions runs,
      // throw a 23505 unique_violation error to deterministically enter the 23505 recovery path.
      if (clientIndex === 1 && typeof sql === 'string' && sql.includes('INSERT INTO completion_submissions')) {
        throw Object.assign(
          new Error('duplicate key value violates unique constraint "completion_submissions_pkey"'),
          { code: '23505' }
        );
      }
      if (clientIndex === 1 && typeof sql === 'string' && sql === 'ROLLBACK') {
        const res = await origQuery(sql, params, ...rest);
        // Now that transaction #1 has rolled back and released its FOR UPDATE lock on visits,
        // seed the competing completion_submissions row before recoveryClient begins.
        const acceptedAt = new Date().toISOString();
        await pool.query('UPDATE visits SET status = \'completed\', completed_at = $1 WHERE id = $2', [acceptedAt, visitId]);
        const acceptedSnapshot = await reportService.createCanonicalReportSnapshot(pool, visitId, {
          submissionId, technicianId: tech.id, generatedAt: snapshot.createdAt, acceptedAt,
          sourceSubmission: snapshot,
        });
        await pool.query(
          `INSERT INTO completion_submissions
             (submission_id, visit_id, technician_id, terminal_intent, snapshot, accepted_at)
           VALUES ($1, $2, $3, 'completed', $4, $5)`,
          [submissionId, visitId, tech.id, JSON.stringify(acceptedSnapshot), acceptedAt]
        );
        mainTxReleasedLockResolve();
        await recoveryLockReady;
        return res;
      }
      if (clientIndex === 2 && typeof sql === 'string' && sql.includes('FOR UPDATE')) {
        recoveryForUpdateCalled = true;
        notifyRecoveryReachedForUpdate();
      }
      return origQuery(sql, params, ...rest);
    });
    const reportSpy = jest.spyOn(reportService, 'generateReportJSON');

    try {
      const reqPromise = request(app)
        .post(`/api/visits/${visitId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .send({ submissionId, snapshot })
        .then(res => res);

      // Wait until the main transaction has rolled back after hitting the real 23505 error
      await mainTxReleasedLock;

      // Acquire the visit row lock on lockClient before the 23505 recovery transaction acquires FOR UPDATE
      await lockClient.query('BEGIN');
      await lockClient.query('SELECT id FROM visits WHERE id = $1 FOR UPDATE', [visitId]);
      recoveryLockReadyResolve();

      // Wait until the 23505 recovery transaction reaches SELECT ... FOR UPDATE and blocks on lockClient
      await recoveryReachedForUpdate;

      // Reassign the visit to otherTech and commit, releasing the FOR UPDATE lock to recoveryClient
      await lockClient.query(
        `UPDATE visits SET technician_id = $1, status = 'completed', completed_at = $2 WHERE id = $3`,
        [otherTech.id, new Date().toISOString(), visitId]
      );
      await lockClient.query('COMMIT');

      const res = await reqPromise;

      expect(recoveryForUpdateCalled).toBe(true);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ acknowledged: true, submissionId, technicianId: tech.id });
      expect(reportSpy).toHaveBeenCalledTimes(1);
    } finally {
      await lockClient.query('ROLLBACK').catch(() => {});
      lockClient.release();
      connectSpy.mockRestore();
      reportSpy.mockRestore();
    }
  });

  it('23505 recovery acknowledges only an exact submission, visit, and technician identity', async () => {
    const { visitId, token, tech } = await seedAssignedVisit();
    await addService(visitId, 'AC');
    const submissionId = 'exact-23505-recovery-id';
    const snapshot = {
      version: 1, submissionId, visitId, technicianId: tech.id,
      createdAt: '2026-08-23T10:00:00.000Z', terminalIntent: 'completed', cancel: false,
      service: { serviceName: 'AC', ac: true }, items: [], weighInData: [], systems: [],
      notes: 'Exact recovery identity', checklistAnswers: [], evidenceRefs: [], totalPrice: 150,
    };

    const { response } = await simulateSubmissionUniqueViolation({
      visitId, token, tech, snapshot, acceptedSubmissionId: submissionId,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ acknowledged: true, submissionId });
  });

  it('does not acknowledge a 23505 when only visit and technician match', async () => {
    const { visitId, token, tech } = await seedAssignedVisit();
    await addService(visitId, 'AC');
    const snapshot = {
      version: 1, submissionId: 'unaccepted-23505-id', visitId, technicianId: tech.id,
      createdAt: '2026-08-23T10:00:00.000Z', terminalIntent: 'completed', cancel: false,
      service: { serviceName: 'AC', ac: true }, items: [], weighInData: [], systems: [],
      notes: 'Non matching recovery identity', checklistAnswers: [], evidenceRefs: [], totalPrice: 150,
    };

    const { response, originalError } = await simulateSubmissionUniqueViolation({
      visitId, token, tech, snapshot, acceptedSubmissionId: 'different-accepted-id',
    });

    expect(response.status).toBe(500);
    expect(response.body.error).toBe(originalError.message);
    expect(response.body.error).toContain('completion_submissions_pkey');
  });

  it('propagates an unmatched 23505 database error', async () => {
    const { visitId, token, tech } = await seedAssignedVisit();
    await addService(visitId, 'AC');
    const snapshot = {
      version: 1, submissionId: 'unmatched-23505-id', visitId, technicianId: tech.id,
      createdAt: '2026-08-23T10:00:00.000Z', terminalIntent: 'completed', cancel: false,
      service: { serviceName: 'AC', ac: true }, items: [], weighInData: [], systems: [],
      notes: 'Unmatched recovery identity', checklistAnswers: [], evidenceRefs: [], totalPrice: 150,
    };

    const { response, originalError } = await simulateSubmissionUniqueViolation({
      visitId, token, tech, snapshot,
    });

    expect(response.status).toBe(500);
    expect(response.body.error).toBe(originalError.message);
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

  describe('Zone Board companion items and snapshot reconstruction', () => {
    async function seedZoneBoardCatalog() {
      await pool.query(`
        DELETE FROM catalog_item_relations
        WHERE item_name IN ('HZ322', 'UT3000', 'Harmony')
           OR related_item_name IN ('HZ322', 'UT3000', 'Harmony', 'Bypass', 'DAPC', 'eBypass', 'Ecoil Wire')
      `);
      await pool.query(`
        INSERT INTO catalog_items
          (item_name, category, default_price, tech_supplied, multiplies_by_system_count, custom_price)
        VALUES
          ('HZ322',      'accessory', 30, true,  false, false),
          ('UT3000',     'accessory', 30, true,  false, false),
          ('Harmony',    'accessory', 40, true,  false, false),
          ('Bypass',     'accessory',  5, false, false, false),
          ('DAPC',       'accessory', 10, true,  false, false),
          ('eBypass',    'accessory', 10, false, false, false),
          ('Ecoil Wire', 'accessory', 10, false, true,  false)
        ON CONFLICT (item_name) DO UPDATE SET
          category = EXCLUDED.category,
          default_price = EXCLUDED.default_price,
          tech_supplied = EXCLUDED.tech_supplied,
          multiplies_by_system_count = EXCLUDED.multiplies_by_system_count,
          custom_price = EXCLUDED.custom_price
      `);
      await pool.query(`
        INSERT INTO catalog_item_relations (id, item_name, relation_type, related_item_name, exclusion_group_id)
        VALUES
          (gen_random_uuid()::text, 'HZ322',   'companion',       'Bypass',     null),
          (gen_random_uuid()::text, 'UT3000',  'companion',       'DAPC',       null),
          (gen_random_uuid()::text, 'UT3000',  'companion',       'eBypass',    null),
          (gen_random_uuid()::text, 'UT3000',  'companion',       'Ecoil Wire', null),
          (gen_random_uuid()::text, 'HZ322',   'exclusion_group', 'Harmony',    'zone-boards'),
          (gen_random_uuid()::text, 'HZ322',   'exclusion_group', 'UT3000',     'zone-boards'),
          (gen_random_uuid()::text, 'Harmony', 'exclusion_group', 'HZ322',      'zone-boards'),
          (gen_random_uuid()::text, 'Harmony', 'exclusion_group', 'UT3000',     'zone-boards'),
          (gen_random_uuid()::text, 'UT3000',  'exclusion_group', 'HZ322',      'zone-boards'),
          (gen_random_uuid()::text, 'UT3000',  'exclusion_group', 'Harmony',    'zone-boards')
      `);
    }

    it('reconstructs HZ322 companion (Bypass) and includes its price in final visit and report', async () => {
      const { visitId, token, tech } = await seedAssignedVisit();
      await addService(visitId, 'AC');
      await seedZoneBoardCatalog();

      const addRes = await request(app)
        .post(`/api/visits/${visitId}/items`)
        .set('Authorization', `Bearer ${token}`)
        .send({ category: 'accessory', itemName: 'HZ322' });
      expect(addRes.status).toBe(200);
      expect(addRes.body.addedItems).toEqual(['HZ322', 'Bypass']);
      expect(addRes.body.totalPrice).toBe(185); // 150 AC + 30 HZ322 + 5 Bypass

      // The submitted snapshot must include the server-reconciled companion item.
      const snapshot = {
        version: 1,
        submissionId: 'sub-hz322-only',
        visitId,
        technicianId: tech.id,
        createdAt: '2026-08-23T10:00:00.000Z',
        terminalIntent: 'completed',
        cancel: false,
        service: { serviceName: 'AC', ac: true },
        items: [
          { id: addRes.body.id, item_name: 'HZ322', category: 'accessory', quantity: 1, price: 30, tech_supplied: true },
          { id: `${addRes.body.id}:Bypass`, item_name: 'Bypass', category: 'accessory', quantity: 1, price: 5, tech_supplied: false },
        ],
        weighInData: [],
        systems: [],
        notes: 'HZ322 installed',
        checklistAnswers: [],
        evidenceRefs: [],
        totalPrice: 185,
      };

      const completeRes = await request(app)
        .post(`/api/visits/${visitId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .send({ submissionId: snapshot.submissionId, snapshot: await reviewedSnapshot(visitId, snapshot) });

      expect(completeRes.status).toBe(200);
      expect(completeRes.body.totalPrice).toBe(185);
      expect(completeRes.body.items.map(i => i.itemName).sort()).toEqual(['Bypass', 'HZ322']);

      const persistedItems = await pool.query(
        'SELECT item_name, price FROM visit_items WHERE visit_id = $1 ORDER BY item_name',
        [visitId]
      );
      expect(persistedItems.rows).toEqual([
        { item_name: 'Bypass', price: 5 },
        { item_name: 'HZ322', price: 30 },
      ]);
    });

    it('reconstructs UT3000 companions (DAPC, eBypass, Ecoil Wire) without duplicates on completion and retry', async () => {
      const { visitId, token, tech } = await seedAssignedVisit();
      await addService(visitId, 'AC');
      await seedZoneBoardCatalog();

      const addRes = await request(app)
        .post(`/api/visits/${visitId}/items`)
        .set('Authorization', `Bearer ${token}`)
        .send({ category: 'accessory', itemName: 'UT3000' });
      expect(addRes.status).toBe(200);
      expect(addRes.body.addedItems).toEqual(expect.arrayContaining(['UT3000', 'DAPC', 'eBypass', 'Ecoil Wire']));
      expect(addRes.body.totalPrice).toBe(210); // 150 AC + 30 UT3000 + 10 DAPC + 10 eBypass + 10 Ecoil Wire

      // The submitted snapshot includes all companions reconciled by Workspace.
      const snapshot = {
        version: 1,
        submissionId: 'sub-ut3000-reconciled',
        visitId,
        technicianId: tech.id,
        createdAt: '2026-08-23T10:00:00.000Z',
        terminalIntent: 'completed',
        cancel: false,
        service: { serviceName: 'AC', ac: true },
        items: [
          { id: addRes.body.id, item_name: 'UT3000', category: 'accessory', quantity: 1, price: 30 },
          { id: `${addRes.body.id}:DAPC`, item_name: 'DAPC', category: 'accessory', quantity: 1, price: 10 },
          { id: `${addRes.body.id}:eBypass`, item_name: 'eBypass', category: 'accessory', quantity: 1, price: 10 },
          { id: `${addRes.body.id}:Ecoil Wire`, item_name: 'Ecoil Wire', category: 'accessory', quantity: 1, price: 10 },
        ],
        weighInData: [],
        systems: [],
        notes: 'UT3000 installed',
        checklistAnswers: [],
        evidenceRefs: [],
        totalPrice: 210,
      };

      const first = await request(app)
        .post(`/api/visits/${visitId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .send({ submissionId: snapshot.submissionId, snapshot: await reviewedSnapshot(visitId, snapshot) });
      const retry = await request(app)
        .post(`/api/visits/${visitId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .send({ submissionId: snapshot.submissionId, snapshot: await reviewedSnapshot(visitId, snapshot) });

      expect(first.status).toBe(200);
      expect(retry.status).toBe(200);
      expect(first.body.totalPrice).toBe(210);
      expect(retry.body.totalPrice).toBe(210);
      expect(first.body.items.map(i => i.itemName).sort()).toEqual(['DAPC', 'Ecoil Wire', 'UT3000', 'eBypass']);

      const persistedItems = await pool.query(
        'SELECT item_name FROM visit_items WHERE visit_id = $1 ORDER BY item_name COLLATE "C"',
        [visitId]
      );
      expect(persistedItems.rows.map(r => r.item_name)).toEqual(['DAPC', 'Ecoil Wire', 'UT3000', 'eBypass']);
    });

    it('does not leave orphaned companions when a Zone Board is removed before completion', async () => {
      const { visitId, token, tech } = await seedAssignedVisit();
      await addService(visitId, 'AC');
      await seedZoneBoardCatalog();

      const addRes = await request(app)
        .post(`/api/visits/${visitId}/items`)
        .set('Authorization', `Bearer ${token}`)
        .send({ category: 'accessory', itemName: 'UT3000' });
      expect(addRes.status).toBe(200);

      const delRes = await request(app)
        .delete(`/api/visits/${visitId}/items/${addRes.body.id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(delRes.status).toBe(200);
      expect(delRes.body.removedItems).toEqual(expect.arrayContaining(['UT3000', 'DAPC', 'eBypass', 'Ecoil Wire']));
      expect(delRes.body.totalPrice).toBe(150);

      const snapshot = {
        version: 1,
        submissionId: 'sub-ut3000-removed',
        visitId,
        technicianId: tech.id,
        createdAt: '2026-08-23T10:00:00.000Z',
        terminalIntent: 'completed',
        cancel: false,
        service: { serviceName: 'AC', ac: true },
        items: [],
        weighInData: [],
        systems: [],
        notes: 'Zone board removed',
        checklistAnswers: [],
        evidenceRefs: [],
        totalPrice: 150,
      };

      const completeRes = await request(app)
        .post(`/api/visits/${visitId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .send({ submissionId: snapshot.submissionId, snapshot: await reviewedSnapshot(visitId, snapshot) });

      expect(completeRes.status).toBe(200);
      expect(completeRes.body.totalPrice).toBe(150);
      expect(completeRes.body.items).toEqual([]);
    });

    it('accepts several "Other" lines and still rejects a repeated catalog item (W2)', async () => {
      const { visitId, token, tech } = await seedAssignedVisit();
      await addService(visitId, 'AC');
      await pool.query(
        `INSERT INTO catalog_items (item_name, category, default_price, tech_supplied, multiplies_by_system_count, custom_price)
         VALUES ('Other', 'accessory', NULL, true, false, true),
                ('FIN180P', 'accessory', 10, false, false, false)
         ON CONFLICT (item_name) DO NOTHING`
      );
      const base = {
        version: 1, visitId, technicianId: tech.id, createdAt: '2026-11-19T10:00:00.000Z',
        terminalIntent: 'completed', cancel: false, service: { serviceName: 'AC', ac: true },
        weighInData: [], systems: [], notes: '', checklistAnswers: [], evidenceRefs: [],
      };
      const repeated = {
        ...base, submissionId: 'sub-repeated-fin', totalPrice: 170,
        items: [{ item_name: 'FIN180P', category: 'accessory', quantity: 1, price: 10 }, { item_name: 'FIN180P', category: 'accessory', quantity: 1, price: 10 }],
      };
      const rejected = await request(app).post(`/api/visits/${visitId}/complete`).set('Authorization', `Bearer ${token}`)
        .send({ submissionId: repeated.submissionId, snapshot: await reviewedSnapshot(visitId, repeated) });
      expect(rejected.status).toBe(400);

      const snapshot = {
        ...base, submissionId: 'sub-two-others', totalPrice: 161,
        items: [
          { item_name: 'Other', category: 'accessory', quantity: 1, price: 7, description: 'Clamp' },
          { item_name: 'Other', category: 'accessory', quantity: 1, price: 4, description: 'Strap' },
        ],
      };
      const res = await request(app).post(`/api/visits/${visitId}/complete`).set('Authorization', `Bearer ${token}`)
        .send({ submissionId: snapshot.submissionId, snapshot: await reviewedSnapshot(visitId, snapshot) });
      expect(res.status).toBe(200);
      expect(res.body.totalPrice).toBe(161);
      expect(res.body.items.map(item => [item.description, item.price])).toEqual(expect.arrayContaining([['Clamp', 7], ['Strap', 4]]));
    });

    it('completes a visit with a NULL-price thermostat and priced accessory without coercing thermostat price to 0', async () => {
      const { visitId, token, tech } = await seedAssignedVisit();
      await addService(visitId, 'AC');
      await pool.query(
        `INSERT INTO catalog_items (item_name, category, default_price, tech_supplied, multiplies_by_system_count, custom_price)
         VALUES ('S1200', 'thermostat', NULL, true, false, false),
                ('FIN180P', 'accessory', 10, false, false, false)
         ON CONFLICT (item_name) DO UPDATE SET default_price = EXCLUDED.default_price`
      );

      const snapshot = {
        version: 1,
        submissionId: 'sub-null-thermostat-price',
        visitId,
        technicianId: tech.id,
        createdAt: '2026-08-23T10:00:00.000Z',
        terminalIntent: 'completed',
        cancel: false,
        service: { serviceName: 'AC', ac: true },
        items: [
          { item_name: 'S1200', category: 'thermostat', quantity: 2, price: null },
          { item_name: 'FIN180P', category: 'accessory', quantity: 1, price: 10 },
        ],
        weighInData: [],
        systems: [],
        notes: 'Completed with S1200',
        checklistAnswers: [],
        evidenceRefs: [],
        totalPrice: 160,
      };

      const completeRes = await request(app)
        .post(`/api/visits/${visitId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .send({ submissionId: snapshot.submissionId, snapshot: await reviewedSnapshot(visitId, snapshot) });

      expect(completeRes.status).toBe(200);
      expect(completeRes.body.totalPrice).toBe(160);
      expect(completeRes.body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ itemName: 'S1200', category: 'thermostat', quantity: 2, price: null }),
          expect.objectContaining({ itemName: 'FIN180P', category: 'accessory', quantity: 1, price: 10 }),
        ])
      );

      const previewRes = await request(app)
        .get(`/api/visits/${visitId}/report-preview`)
        .set('Authorization', `Bearer ${token}`);
      expect(previewRes.status).toBe(200);
      expect(previewRes.body.reportText).toContain('AC started 2 S1200 tstats $150, FIN180P wired and set $10, total $160');

      const dbItems = await pool.query(
        'SELECT item_name, category, quantity, price FROM visit_items WHERE visit_id = $1 ORDER BY category',
        [visitId]
      );
      expect(dbItems.rows).toEqual([
        { item_name: 'FIN180P', category: 'accessory', quantity: 1, price: 10 },
        { item_name: 'S1200', category: 'thermostat', quantity: 2, price: null },
      ]);
    });
  });

  describe('Weigh-In derived value preservation during snapshot completion', () => {
    it('preserves existing derived weigh-in values when the completion snapshot omits them, while applying explicitly supplied values', async () => {
      const { visitId, addressId, token, tech } = await seedAssignedVisit();
      await addService(visitId, 'AC');
      await pool.query(`
        INSERT INTO catalog_lineset_configs (config_key, reference_length_ft, adjust_rate_oz_per_ft)
        VALUES ('STANDARD-25', 25, 0.5)
        ON CONFLICT (config_key) DO NOTHING
      `);
      await pool.query(`
        INSERT INTO catalog_manufacturers (name, oz_per_ft, default_length_ft)
        VALUES ('TESTMFR', 0.5, 25)
        ON CONFLICT (name) DO NOTHING
      `);
      await pool.query(`
        INSERT INTO catalog_equipment (model, unit_type, brand)
        VALUES ('TEST-COND-WI-COMP', 'outdoor', 'TESTMFR')
        ON CONFLICT (model) DO NOTHING
      `);
      await pool.query(`
        INSERT INTO catalog_equipment_charges (model, manufacturer, length_ft, charge_oz)
        VALUES ('TEST-COND-WI-COMP', 'TESTMFR', 25, 80)
        ON CONFLICT DO NOTHING
      `);
      await pool.query(
        `UPDATE visit_systems SET outdoor_model = 'TEST-COND-WI-COMP' WHERE visit_id = $1 AND system_number = 1`,
        [visitId]
      );

      // Server calculates factoryChargeOz=80, approxAdjustOz=5, subcooling 105 − 90 = 15, deviation 5
      const putRes = await request(app)
        .put(`/api/visits/${visitId}/weigh-in/1`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          linesetLength: 35,
          manufacturer: 'TESTMFR',
          factoryLengthFt: 25,
          adjustedOz: 82,
          fanSpeedCfm: 1200,
          liquidLineTemp: 90,
          suctionLineTemp: 55,
          condenserSatTemp: 105,
          subcoolingValue: 18,
          oemSubcoolingGoal: 10,
        });
      expect(putRes.status).toBe(200);
      expect(putRes.body.factoryChargeOz).toBe(80);
      expect(putRes.body.approxAdjustOz).toBeCloseTo(5.0);
      expect(putRes.body.subcoolingDeviation).toBeCloseTo(5.0);

      // Snapshot omits factoryChargeOz and approxAdjustOz (null/undefined) but supplies an explicit subcoolingDeviation and updated fanSpeedCfm
      const snapshot = {
        version: 1,
        submissionId: 'sub-weighin-preserve',
        visitId,
        technicianId: tech.id,
        createdAt: '2026-08-23T10:00:00.000Z',
        terminalIntent: 'completed',
        cancel: false,
        service: { serviceName: 'AC', ac: true },
        items: [],
        weighInData: [{
          systemNumber: 1,
          linesetLength: 35,
          factoryLineConfig: 'STANDARD-25',
          adjustedOz: 82,
          fanSpeedCfm: 1350,
          liquidLineTemp: 90,
          suctionLineTemp: 55,
          condenserSatTemp: 105,
          subcoolingValue: 16,
          oemSubcoolingGoal: 10,
          subcoolingDeviation: 6,
        }],
        systems: [],
        notes: 'Weigh-in preserved',
        checklistAnswers: [],
        evidenceRefs: [],
        totalPrice: 150,
      };

      const completeRes = await request(app)
        .post(`/api/visits/${visitId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .send({ submissionId: snapshot.submissionId, snapshot: await reviewedSnapshot(visitId, snapshot) });

      expect(completeRes.status).toBe(200);
      expect(completeRes.body.weighInData).toEqual([
        expect.objectContaining({
          systemNumber: 1,
          linesetLength: 35,
          factoryChargeOz: 80,
          approxAdjustOz: 5,
          fanSpeedCfm: 1350,
          subcoolingValue: 16,
          oemSubcoolingGoal: 10,
          subcoolingDeviation: 6,
        }),
      ]);

      const dbRow = await pool.query(
        'SELECT factory_charge_oz, approx_adjust_oz, subcooling_deviation, fan_speed_cfm FROM weigh_in_data WHERE address_id = $1 AND system_number = 1',
        [addressId]
      );
      expect(dbRow.rows[0]).toEqual({
        factory_charge_oz: 80,
        approx_adjust_oz: 5,
        subcooling_deviation: 6,
        fan_speed_cfm: 1350,
      });
    });

    it('preserves server-derived weigh-in values across repeated edits when a later edit omits derived fields before completion', async () => {
      const { visitId, addressId, token, tech } = await seedAssignedVisit();
      await addService(visitId, 'AC');
      await pool.query(`
        INSERT INTO catalog_lineset_configs (config_key, reference_length_ft, adjust_rate_oz_per_ft)
        VALUES ('STANDARD-25', 25, 0.5)
        ON CONFLICT (config_key) DO NOTHING
      `);
      await pool.query(`
        INSERT INTO catalog_manufacturers (name, oz_per_ft, default_length_ft)
        VALUES ('TESTMFR', 0.5, 25)
        ON CONFLICT (name) DO NOTHING
      `);
      await pool.query(`
        INSERT INTO catalog_equipment (model, unit_type, brand)
        VALUES ('TEST-COND-WI-REPEAT', 'outdoor', 'TESTMFR')
        ON CONFLICT (model) DO NOTHING
      `);
      await pool.query(`
        INSERT INTO catalog_equipment_charges (model, manufacturer, length_ft, charge_oz)
        VALUES ('TEST-COND-WI-REPEAT', 'TESTMFR', 25, 80)
        ON CONFLICT DO NOTHING
      `);
      await pool.query(
        `UPDATE visit_systems SET outdoor_model = 'TEST-COND-WI-REPEAT' WHERE visit_id = $1 AND system_number = 1`,
        [visitId]
      );

      // First edit returns server-derived values
      const firstSave = await request(app)
        .put(`/api/visits/${visitId}/weigh-in/1`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          linesetLength: 35,
          manufacturer: 'TESTMFR',
          factoryLengthFt: 25,
          adjustedOz: 82,
          fanSpeedCfm: 1100,
          liquidLineTemp: 90,
          suctionLineTemp: 55,
          condenserSatTemp: 105,
          subcoolingValue: 18,
          oemSubcoolingGoal: 10,
        });
      expect(firstSave.status).toBe(200);

      // Simulate repeated local edit in Workspace merging against current visit._weighInData
      let currentWeighInData = [firstSave.body];
      const applyRepeatedEdit = (patch) => {
        const current = currentWeighInData.find(d => d.systemNumber === 1);
        currentWeighInData = [
          ...currentWeighInData.filter(d => d.systemNumber !== 1),
          { ...(current ?? {}), ...patch, systemNumber: 1 },
        ];
      };
      applyRepeatedEdit({ fanSpeedCfm: 1250 });
      applyRepeatedEdit({ adjustedOz: 84 });

      expect(currentWeighInData[0]).toMatchObject({
        systemNumber: 1,
        factoryChargeOz: 80,
        approxAdjustOz: 5,
        subcoolingDeviation: 5,
        fanSpeedCfm: 1250,
        adjustedOz: 84,
      });

      const snapshot = {
        version: 1,
        submissionId: 'sub-weighin-repeated-edits',
        visitId,
        technicianId: tech.id,
        createdAt: '2026-08-23T10:00:00.000Z',
        terminalIntent: 'completed',
        cancel: false,
        service: { serviceName: 'AC', ac: true },
        items: [],
        weighInData: currentWeighInData,
        systems: [],
        notes: 'Repeated weigh-in edits preserved',
        checklistAnswers: [],
        evidenceRefs: [],
        totalPrice: 150,
      };

      const completeRes = await request(app)
        .post(`/api/visits/${visitId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .send({ submissionId: snapshot.submissionId, snapshot: await reviewedSnapshot(visitId, snapshot) });

      expect(completeRes.status).toBe(200);
      expect(completeRes.body.weighInData).toEqual([
        expect.objectContaining({
          systemNumber: 1,
          factoryChargeOz: 80,
          approxAdjustOz: 5,
          subcoolingDeviation: 5,
          fanSpeedCfm: 1250,
          adjustedOz: 84,
        }),
      ]);

      const dbRow = await pool.query(
        'SELECT factory_charge_oz, approx_adjust_oz, subcooling_deviation, fan_speed_cfm, adjusted_oz FROM weigh_in_data WHERE address_id = $1 AND system_number = 1',
        [addressId]
      );
      expect(dbRow.rows[0]).toEqual({
        factory_charge_oz: 80,
        approx_adjust_oz: 5,
        subcooling_deviation: 5,
        fan_speed_cfm: 1250,
        adjusted_oz: 84,
      });
    });
  });

  describe('submissionId validation and transaction concurrency protection', () => {
    it('accepts valid trimmed submissionId, preserves max length (120), and rejects empty or whitespace-only submissionId', async () => {
      const { visitId, token, tech } = await seedAssignedVisit();
      await addService(visitId, 'AC');

      const baseSnapshot = {
        version: 1,
        visitId,
        technicianId: tech.id,
        createdAt: '2026-08-23T10:00:00.000Z',
        terminalIntent: 'completed',
        cancel: false,
        service: { serviceName: 'AC', ac: true },
        items: [],
        weighInData: [],
        systems: [],
        notes: 'Validation test',
        checklistAnswers: [],
        evidenceRefs: [],
        totalPrice: 150,
      };

      const emptyRes = await request(app)
        .post(`/api/visits/${visitId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .send({ submissionId: '', snapshot: { ...baseSnapshot, submissionId: '' } });
      expect(emptyRes.status).toBe(400);
      expect(emptyRes.body.error).toBe('Invalid completion submission');

      const whitespaceRes = await request(app)
        .post(`/api/visits/${visitId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .send({ submissionId: '    ', snapshot: { ...baseSnapshot, submissionId: '    ' } });
      expect(whitespaceRes.status).toBe(400);
      expect(whitespaceRes.body.error).toBe('Invalid completion submission');

      const tooLongId = 'x'.repeat(121);
      const tooLongRes = await request(app)
        .post(`/api/visits/${visitId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .send({ submissionId: tooLongId, snapshot: { ...baseSnapshot, submissionId: tooLongId } });
      expect(tooLongRes.status).toBe(400);
      expect(tooLongRes.body.error).toBe('Invalid completion submission');

      const maxLenId = 's'.repeat(120);
      const validRes = await request(app)
        .post(`/api/visits/${visitId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          submissionId: `  ${maxLenId}  `,
          snapshot: await reviewedSnapshot(visitId, { ...baseSnapshot, submissionId: maxLenId }),
        });
      expect(validRes.status).toBe(200);
      expect(validRes.body).toMatchObject({
        acknowledged: true,
        submissionId: maxLenId,
        status: 'completed',
      });
    });

    it('rejects a snapshot missing top-level submissionId or containing malformed/mismatched identifiers with 400 without mutating the visit', async () => {
      const { visitId, token, tech } = await seedAssignedVisit();
      await addService(visitId, 'AC');

      const validSnapshot = {
        version: 1,
        submissionId: 'sub-malformed-test',
        visitId,
        technicianId: tech.id,
        createdAt: '2026-08-23T10:00:00.000Z',
        terminalIntent: 'completed',
        cancel: false,
        service: { serviceName: 'Heat', heat: true },
        items: [],
        weighInData: [],
        systems: [],
        notes: 'Should never be applied on 400',
        checklistAnswers: [],
        evidenceRefs: [],
        totalPrice: 150,
      };

      // 1. Missing top-level submissionId with a snapshot (rawSubmissionId == null && snapshot != null)
      const missingTopSubId = await request(app)
        .post(`/api/visits/${visitId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .send({ snapshot: validSnapshot });
      expect(missingTopSubId.status).toBe(400);
      expect(missingTopSubId.body).toEqual({ error: 'Invalid completion submission' });

      // 2. Missing snapshot.technicianId
      const { technicianId: _omitted, ...snapshotWithoutTech } = validSnapshot;
      const missingTechId = await request(app)
        .post(`/api/visits/${visitId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .send({ submissionId: validSnapshot.submissionId, snapshot: snapshotWithoutTech });
      expect(missingTechId.status).toBe(400);
      expect(missingTechId.body).toEqual({ error: 'Invalid completion submission' });

      // 3. Empty/whitespace snapshot.technicianId
      const emptyTechId = await request(app)
        .post(`/api/visits/${visitId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          submissionId: validSnapshot.submissionId,
          snapshot: { ...validSnapshot, technicianId: '   ' },
        });
      expect(emptyTechId.status).toBe(400);
      expect(emptyTechId.body).toEqual({ error: 'Invalid completion submission' });

      // 4. Mismatched body.technicianId vs snapshot.technicianId
      const mismatchedBodyTech = await request(app)
        .post(`/api/visits/${visitId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          submissionId: validSnapshot.submissionId,
          technicianId: 'different-tech-id',
          snapshot: validSnapshot,
        });
      expect(mismatchedBodyTech.status).toBe(400);
      expect(mismatchedBodyTech.body).toEqual({ error: 'Invalid completion submission' });

      // 5. Mismatched snapshot.submissionId vs submissionId
      const mismatchedSubId = await request(app)
        .post(`/api/visits/${visitId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          submissionId: validSnapshot.submissionId,
          snapshot: { ...validSnapshot, submissionId: 'other-sub-id' },
        });
      expect(mismatchedSubId.status).toBe(400);
      expect(mismatchedSubId.body).toEqual({ error: 'Invalid completion submission' });

      // 6. Mismatched snapshot.visitId vs URL :id
      const mismatchedVisitId = await request(app)
        .post(`/api/visits/${visitId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          submissionId: validSnapshot.submissionId,
          snapshot: { ...validSnapshot, visitId: 'other-visit-id' },
        });
      expect(mismatchedVisitId.status).toBe(400);
      expect(mismatchedVisitId.body).toEqual({ error: 'Invalid completion submission' });

      // Confirm visit was not mutated and service remained 'AC'
      const visitRow = await pool.query('SELECT status, notes FROM visits WHERE id = $1', [visitId]);
      const serviceRow = await pool.query('SELECT service_name FROM visit_services WHERE visit_id = $1', [visitId]);
      expect(visitRow.rows[0].status).toBe('assigned');
      expect(serviceRow.rows[0].service_name).toBe('AC');
    });

    it('rejects a submission whose declared snapshot.technicianId differs from req.technician.id with 403 even after visit reassignment or terminal status', async () => {
      const { visitId, tech: techA } = await seedAssignedVisit();
      await addService(visitId, 'AC');
      const { tech: techB, token: tokenB } = await seedTechnicianWithToken({ name: 'Reassigned-Assignee-B' });

      // Reassign the visit to Tech B on the server
      await pool.query('UPDATE visits SET technician_id = $1 WHERE id = $2', [techB.id, visitId]);

      const techASnapshot = {
        version: 1,
        submissionId: 'sub-authored-by-tech-a',
        visitId,
        technicianId: techA.id,
        createdAt: '2026-08-23T10:00:00.000Z',
        terminalIntent: 'completed',
        cancel: false,
        service: { serviceName: 'AC', ac: true },
        items: [],
        weighInData: [],
        systems: [],
        notes: 'Authored offline by Tech A before reassignment',
        checklistAnswers: [],
        evidenceRefs: [],
        totalPrice: 150,
      };

      const reportSpy = jest.spyOn(reportService, 'generateReportJSON');
      try {
        // 1. Tech B tries to submit Tech A's offline snapshot on a visit now assigned to Tech B
        const resNonTerminal = await request(app)
          .post(`/api/visits/${visitId}/complete`)
          .set('Authorization', `Bearer ${tokenB}`)
          .send({
            submissionId: techASnapshot.submissionId,
            technicianId: techA.id,
            snapshot: techASnapshot,
          });
        expect(resNonTerminal.status).toBe(403);
        expect(resNonTerminal.body).toEqual({ error: 'This visit is not assigned to you' });
        expect(reportSpy).not.toHaveBeenCalled();

        // Verify visit was not completed and no completion_submissions row was created
        const checkSub = await pool.query(
          'SELECT * FROM completion_submissions WHERE submission_id = $1',
          [techASnapshot.submissionId]
        );
        expect(checkSub.rowCount).toBe(0);

        // 2. Even if the visit is already in terminal status ('completed') under Tech B,
        // submitting Tech A's snapshot is still rejected with 403 before terminal early return
        await pool.query(
          `UPDATE visits SET status = 'completed', completed_at = $1 WHERE id = $2`,
          [new Date().toISOString(), visitId]
        );
        const resTerminal = await request(app)
          .post(`/api/visits/${visitId}/complete`)
          .set('Authorization', `Bearer ${tokenB}`)
          .send({
            submissionId: techASnapshot.submissionId,
            snapshot: techASnapshot,
          });
        expect(resTerminal.status).toBe(403);
        expect(resTerminal.body).toEqual({ error: 'This visit is not assigned to you' });
        expect(reportSpy).not.toHaveBeenCalled();
      } finally {
        reportSpy.mockRestore();
      }
    });

    it('serializes concurrent completion requests with different submissionIds and acknowledges only the accepted identity', async () => {
      const { visitId, token, tech } = await seedAssignedVisit();
      await addService(visitId, 'AC');
      const { dispatcher } = await seedDispatcherWithToken();

      const makeSnapshot = (subId, note) => ({
        version: 1,
        submissionId: subId,
        visitId,
        technicianId: tech.id,
        createdAt: '2026-08-23T10:00:00.000Z',
        terminalIntent: 'completed',
        cancel: false,
        service: { serviceName: 'AC', ac: true },
        items: [],
        weighInData: [],
        systems: [],
        notes: note,
        checklistAnswers: [],
        evidenceRefs: [],
        totalPrice: 150,
      });

      const snapA = makeSnapshot('concurrent-sub-a', 'First concurrent note');
      const snapB = makeSnapshot('concurrent-sub-b', 'Second concurrent note');

      const [resA, resB] = await Promise.all([
        request(app)
          .post(`/api/visits/${visitId}/complete`)
          .set('Authorization', `Bearer ${token}`)
          .send({ submissionId: snapA.submissionId, snapshot: await reviewedSnapshot(visitId, snapA) }),
        request(app)
          .post(`/api/visits/${visitId}/complete`)
          .set('Authorization', `Bearer ${token}`)
          .send({ submissionId: snapB.submissionId, snapshot: await reviewedSnapshot(visitId, snapB) }),
      ]);

      const acceptedResponse = resA.status === 200 ? resA : resB;
      const rejectedResponse = resA.status === 409 ? resA : resB;
      expect([resA.status, resB.status].sort()).toEqual([200, 409]);
      expect(acceptedResponse.body.acknowledged).toBe(true);
      expect(acceptedResponse.body.submissionId).toBeTruthy();
      expect(rejectedResponse.body).toEqual({ error: 'Visit already has a different accepted submission' });

      const submissionsRows = await pool.query(
        'SELECT submission_id FROM completion_submissions WHERE visit_id = $1',
        [visitId]
      );
      expect(submissionsRows.rows).toHaveLength(1);
      expect(submissionsRows.rows[0].submission_id).toBe(acceptedResponse.body.submissionId);

      const notifs = await pool.query(
        `SELECT * FROM notifications WHERE recipient_id = $1 AND type = 'completion_received'`,
        [dispatcher.id]
      );
      expect(notifs.rows).toHaveLength(1);
    });
  });
});

// ── GET /api/visits/:id/report-preview ───────────────────────────────────────

describe('GET /api/visits/:id/report-preview', () => {
  it('returns { reportText: "..." } for the assignee', async () => {
    const { visitId, token, street } = await seedAssignedVisit();
    await addService(visitId, 'AC');

    const res = await request(app)
      .get(`/api/visits/${visitId}/report-preview`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.reportText).toBe(`${street}, AC started $150, total $150`);
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
    expect(res.body.notes).toBe('');
    expect(res.body.checklistAnswers).toEqual([]);
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
