const request = require('supertest');
const { randomUUID } = require('crypto');
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
    const { visitId, token } = await seedAssignedVisit();
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
      createdAt: '2026-08-23T10:00:00.000Z',
      terminalIntent: 'completed',
      cancel: false,
      service: { serviceName: 'AC', ac: true },
      items: [{ id: 'local-item', item_name: itemName, category: 'accessory', quantity: 1, price: 10 }],
      weighInData: [], systems: [], notes: 'Submitted once',
      checklistAnswers: [], evidenceRefs: [], totalPrice: 150,
    };

    const first = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ submissionId: snapshot.submissionId, snapshot });
    const retry = await request(app)
      .post(`/api/visits/${visitId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ submissionId: snapshot.submissionId, snapshot });

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(first.body).toMatchObject({ acknowledged: true, submissionId: snapshot.submissionId, status: 'completed' });
    expect(retry.body).toMatchObject({ acknowledged: true, submissionId: snapshot.submissionId, status: 'completed' });
    expect(first.body.items).toEqual([expect.objectContaining({ itemName, price: 10 })]);
    await expect(pool.query('SELECT * FROM completion_submissions WHERE submission_id = $1', [snapshot.submissionId]))
      .resolves.toMatchObject({ rowCount: 1 });
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
      const { visitId, token } = await seedAssignedVisit();
      await addService(visitId, 'AC');
      await seedZoneBoardCatalog();

      const addRes = await request(app)
        .post(`/api/visits/${visitId}/items`)
        .set('Authorization', `Bearer ${token}`)
        .send({ category: 'accessory', itemName: 'HZ322' });
      expect(addRes.status).toBe(200);
      expect(addRes.body.addedItems).toEqual(['HZ322', 'Bypass']);
      expect(addRes.body.totalPrice).toBe(185); // 150 AC + 30 HZ322 + 5 Bypass

      // Simulate a snapshot that only lists the primary trigger item HZ322
      const snapshot = {
        version: 1,
        submissionId: 'sub-hz322-only',
        visitId,
        createdAt: '2026-08-23T10:00:00.000Z',
        terminalIntent: 'completed',
        cancel: false,
        service: { serviceName: 'AC', ac: true },
        items: [{ id: addRes.body.id, item_name: 'HZ322', category: 'accessory', quantity: 1, price: 30 }],
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
        .send({ submissionId: snapshot.submissionId, snapshot });

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
      const { visitId, token } = await seedAssignedVisit();
      await addService(visitId, 'AC');
      await seedZoneBoardCatalog();

      const addRes = await request(app)
        .post(`/api/visits/${visitId}/items`)
        .set('Authorization', `Bearer ${token}`)
        .send({ category: 'accessory', itemName: 'UT3000' });
      expect(addRes.status).toBe(200);
      expect(addRes.body.addedItems).toEqual(expect.arrayContaining(['UT3000', 'DAPC', 'eBypass', 'Ecoil Wire']));
      expect(addRes.body.totalPrice).toBe(210); // 150 AC + 30 UT3000 + 10 DAPC + 10 eBypass + 10 Ecoil Wire

      // Snapshot already includes some/all companions as reconciled by Workspace
      const snapshot = {
        version: 1,
        submissionId: 'sub-ut3000-reconciled',
        visitId,
        createdAt: '2026-08-23T10:00:00.000Z',
        terminalIntent: 'completed',
        cancel: false,
        service: { serviceName: 'AC', ac: true },
        items: [
          { id: addRes.body.id, item_name: 'UT3000', category: 'accessory', quantity: 1, price: 30 },
          { id: `${addRes.body.id}:DAPC`, item_name: 'DAPC', category: 'accessory', quantity: 1, price: 10 },
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
        .send({ submissionId: snapshot.submissionId, snapshot });
      const retry = await request(app)
        .post(`/api/visits/${visitId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .send({ submissionId: snapshot.submissionId, snapshot });

      expect(first.status).toBe(200);
      expect(retry.status).toBe(200);
      expect(first.body.totalPrice).toBe(210);
      expect(retry.body.totalPrice).toBe(210);
      expect(first.body.items.map(i => i.itemName).sort()).toEqual(['DAPC', 'Ecoil Wire', 'UT3000', 'eBypass']);

      const persistedItems = await pool.query(
        'SELECT item_name FROM visit_items WHERE visit_id = $1 ORDER BY item_name',
        [visitId]
      );
      expect(persistedItems.rows.map(r => r.item_name)).toEqual(['DAPC', 'Ecoil Wire', 'UT3000', 'eBypass']);
    });

    it('does not leave orphaned companions when a Zone Board is removed before completion', async () => {
      const { visitId, token } = await seedAssignedVisit();
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
        .send({ submissionId: snapshot.submissionId, snapshot });

      expect(completeRes.status).toBe(200);
      expect(completeRes.body.totalPrice).toBe(150);
      expect(completeRes.body.items).toEqual([]);
    });

    it('completes a visit with a NULL-price thermostat and priced accessory without coercing thermostat price to 0', async () => {
      const { visitId, token } = await seedAssignedVisit();
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
        .send({ submissionId: snapshot.submissionId, snapshot });

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
      const { visitId, addressId, token } = await seedAssignedVisit();
      await addService(visitId, 'AC');
      await pool.query(`
        INSERT INTO catalog_lineset_configs (config_key, reference_length_ft, adjust_rate_oz_per_ft)
        VALUES ('STANDARD-25', 25, 0.5)
        ON CONFLICT (config_key) DO NOTHING
      `);
      await pool.query(`
        INSERT INTO catalog_equipment (model, unit_type, brand, factory_charge_oz, revised_charge_oz)
        VALUES ('TEST-COND-WI-COMP', 'outdoor', 'TEST', 80, 70)
        ON CONFLICT (model) DO NOTHING
      `);
      await pool.query(
        `UPDATE visit_systems SET outdoor_model = 'TEST-COND-WI-COMP' WHERE visit_id = $1 AND system_number = 1`,
        [visitId]
      );

      // Server calculates factoryChargeOz=80, approxAdjustOz=5, subcoolingDeviation=8
      const putRes = await request(app)
        .put(`/api/visits/${visitId}/weigh-in/1`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          linesetLength: 35,
          factoryLineConfig: 'STANDARD-25',
          factoryChargeUsed: 'factory',
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
      expect(putRes.body.subcoolingDeviation).toBeCloseTo(8.0);

      // Snapshot omits factoryChargeOz and approxAdjustOz (null/undefined) but supplies an explicit subcoolingDeviation and updated fanSpeedCfm
      const snapshot = {
        version: 1,
        submissionId: 'sub-weighin-preserve',
        visitId,
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
        .send({ submissionId: snapshot.submissionId, snapshot });

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
      const { visitId, addressId, token } = await seedAssignedVisit();
      await addService(visitId, 'AC');
      await pool.query(`
        INSERT INTO catalog_lineset_configs (config_key, reference_length_ft, adjust_rate_oz_per_ft)
        VALUES ('STANDARD-25', 25, 0.5)
        ON CONFLICT (config_key) DO NOTHING
      `);
      await pool.query(`
        INSERT INTO catalog_equipment (model, unit_type, brand, factory_charge_oz, revised_charge_oz)
        VALUES ('TEST-COND-WI-REPEAT', 'outdoor', 'TEST', 80, 70)
        ON CONFLICT (model) DO NOTHING
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
          factoryLineConfig: 'STANDARD-25',
          factoryChargeUsed: 'factory',
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
        subcoolingDeviation: 8,
        fanSpeedCfm: 1250,
        adjustedOz: 84,
      });

      const snapshot = {
        version: 1,
        submissionId: 'sub-weighin-repeated-edits',
        visitId,
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
        .send({ submissionId: snapshot.submissionId, snapshot });

      expect(completeRes.status).toBe(200);
      expect(completeRes.body.weighInData).toEqual([
        expect.objectContaining({
          systemNumber: 1,
          factoryChargeOz: 80,
          approxAdjustOz: 5,
          subcoolingDeviation: 8,
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
        subcooling_deviation: 8,
        fan_speed_cfm: 1250,
        adjusted_oz: 84,
      });
    });
  });

  describe('submissionId validation and transaction concurrency protection', () => {
    it('accepts valid trimmed submissionId, preserves max length (120), and rejects empty or whitespace-only submissionId', async () => {
      const { visitId, token } = await seedAssignedVisit();
      await addService(visitId, 'AC');

      const baseSnapshot = {
        version: 1,
        visitId,
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
          snapshot: { ...baseSnapshot, submissionId: maxLenId },
        });
      expect(validRes.status).toBe(200);
      expect(validRes.body).toMatchObject({
        acknowledged: true,
        submissionId: maxLenId,
        status: 'completed',
      });
    });

    it('serializes concurrent completion requests with different submissionIds via row lock without duplicate side effects', async () => {
      const { visitId, token } = await seedAssignedVisit();
      await addService(visitId, 'AC');
      const { dispatcher } = await seedDispatcherWithToken();

      const makeSnapshot = (subId, note) => ({
        version: 1,
        submissionId: subId,
        visitId,
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
          .send({ submissionId: snapA.submissionId, snapshot: snapA }),
        request(app)
          .post(`/api/visits/${visitId}/complete`)
          .set('Authorization', `Bearer ${token}`)
          .send({ submissionId: snapB.submissionId, snapshot: snapB }),
      ]);

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);
      expect(resA.body.acknowledged).toBe(true);
      expect(resB.body.acknowledged).toBe(true);

      const submissionsRows = await pool.query(
        'SELECT submission_id FROM completion_submissions WHERE visit_id = $1',
        [visitId]
      );
      expect(submissionsRows.rows).toHaveLength(1);

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
