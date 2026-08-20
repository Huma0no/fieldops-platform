const { pool, truncateTables } = require('./helpers/db');
const { seedAssignedVisit } = require('./helpers/seeds');
const { generateReportText, generateReportJSON } = require('../src/services/report');

beforeEach(truncateTables);
afterAll(() => pool.end());

async function setupVisit({ serviceName = 'AC', isFinish = false, isTemporarily = false, servicePrice = 30, totalPrice = servicePrice, systemCount = 1, notes, checklistAnswers, status = 'assigned' } = {}) {
  const { visitId, street, addressId } = await seedAssignedVisit();
  for (let systemNumber = 2; systemNumber <= systemCount; systemNumber += 1) {
    await pool.query(
      `INSERT INTO visit_systems (id, visit_id, system_number)
       VALUES (gen_random_uuid()::text, $1, $2)`,
      [visitId, systemNumber]
    );
  }
  if (serviceName) {
    await pool.query(
      `INSERT INTO catalog_services (service_name, default_price, is_bundle, multiplies_by_system_count)
       VALUES ($1, $2, false, false)
       ON CONFLICT (service_name) DO NOTHING`,
      [serviceName, servicePrice]
    );
    await pool.query(
      `INSERT INTO visit_services (id, visit_id, service_name, is_finish, is_temporarily, price)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5)`,
      [visitId, serviceName, isFinish, isTemporarily, servicePrice]
    );
  }
  await pool.query(
    `UPDATE visits
     SET total_price = $1, notes = $2, checklist_answers = $3, status = $4,
         completed_at = '2026-07-01T10:00:00.000Z'
     WHERE id = $5`,
    [totalPrice, notes ?? null, checklistAnswers ? JSON.stringify(checklistAnswers) : null, status, visitId]
  );
  return { visitId, street, addressId };
}

async function addItem(visitId, { itemName, category, price, quantity = 1, description = null }) {
  await pool.query(
    `INSERT INTO catalog_items (item_name, category, default_price, tech_supplied, custom_price)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (item_name) DO NOTHING`,
    [itemName, category, price, category === 'thermostat', itemName === 'Other' || itemName === 'Other Fix']
  );
  await pool.query(
    `INSERT INTO visit_items (id, visit_id, item_name, category, description, quantity, price, tech_supplied)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7)`,
    [visitId, itemName, category, description, quantity, price, category === 'thermostat' || itemName === 'Other']
  );
}

describe('generateReportText', () => {
  it.each([
    ['AC', false, false, 30, 'AC started $30'],
    ['Heat', false, false, 30, 'Heat started $30'],
    ['AC & Heat', false, false, 30, 'AC & Heat started $30'],
    ['AC', true, false, 20, 'Finish/ AC started $20'],
    ['Heat', true, false, 20, 'Finish/ Heat started $20'],
    ['AC & Heat', true, false, 20, 'Finish/ AC & Heat started $20'],
    ['Prestart', false, false, 20, 'System Prestarted $20'],
    ['Drive Run', false, false, 10, 'Drive Run $10'],
    ['AC', false, true, 30, 'AC (Temporarily) started $30'],
  ])('formats %s service text from persisted data', async (serviceName, isFinish, isTemporarily, price, phrase) => {
    const { visitId, street } = await setupVisit({ serviceName, isFinish, isTemporarily, servicePrice: price });
    await expect(generateReportText(pool, visitId)).resolves.toBe(`${street}, ${phrase}, total $${price}`);
  });

  it('prints Finish as an independent marker without AC or Heat', async () => {
    const { visitId, street } = await setupVisit({ serviceName: 'Prestart', isFinish: true, servicePrice: 20 });
    await expect(generateReportText(pool, visitId)).resolves.toBe(`${street}, Finish/, System Prestarted $20, total $20`);
  });

  it('prints Finish-only without inventing a service price', async () => {
    const { visitId, street } = await setupVisit({ serviceName: 'Finish', isFinish: true, servicePrice: 0, totalPrice: 10 });
    await addItem(visitId, { itemName: 'Pressure Test', category: 'fix', price: 10 });
    await expect(generateReportText(pool, visitId)).resolves.toBe(`${street}, Finish/, Pressure Test $10, total $10`);
  });

  it('uses the actual current system count in the service phrase', async () => {
    const { visitId, street } = await setupVisit({ serviceName: 'Prestart', servicePrice: 60, totalPrice: 60, systemCount: 3 });
    await expect(generateReportText(pool, visitId)).resolves.toBe(`${street}, System Prestarted (3 Systems) $60, total $60`);
  });

  it('joins trimmed notes and No checklist findings while excluding Gas Valve', async () => {
    const { visitId, street } = await setupVisit({
      notes: '  Ready for inspection  ',
      checklistAnswers: [
        { answer: 'no', reportText: 'No/Incomplete pdrain' },
        { answer: 'no', reportText: null },
        { answer: 'yes', reportText: 'Media filter missing' },
      ],
    });
    await expect(generateReportText(pool, visitId)).resolves.toBe(
      `${street}, Ready for inspection | No/Incomplete pdrain, AC started $30, total $30`
    );
  });

  it('includes persisted thermostat model and quantity with the service price', async () => {
    const { visitId, street } = await setupVisit({ servicePrice: 30, totalPrice: 30 });
    await addItem(visitId, { itemName: 'T-6', category: 'thermostat', quantity: 2, price: 0 });
    await expect(generateReportText(pool, visitId)).resolves.toBe(`${street}, AC started 2 T-6 tstats $30, total $30`);
  });

  it('formats multiple accessories, fixes, custom descriptions, and persisted item prices', async () => {
    const { visitId, street } = await setupVisit({ servicePrice: 30, totalPrice: 145 });
    await addItem(visitId, { itemName: 'FIN180P', category: 'accessory', price: 10 });
    await addItem(visitId, { itemName: 'Weight-In-Data', category: 'accessory', price: 10 });
    await addItem(visitId, { itemName: 'Other', category: 'accessory', description: 'Thermostat adapter', price: 25 });
    await addItem(visitId, { itemName: 'Pressure Test', category: 'fix', price: 10 });
    await addItem(visitId, { itemName: 'Other Fix', category: 'fix', description: 'Repaired drain pan', price: 40 });
    await expect(generateReportText(pool, visitId)).resolves.toBe(
      `${street}, AC started $30, FIN180P wired and set $10, Thermostat adapter $25, weigh-in data $10, Repaired drain pan $40, Pressure Test $10, total $145`
    );
  });

  it('uses the persisted $20 Weight-In-Data price without recreating its Finish addon', async () => {
    const { visitId, street } = await setupVisit({ isFinish: true, servicePrice: 20, totalPrice: 40 });
    await addItem(visitId, { itemName: 'Weight-In-Data', category: 'accessory', price: 20 });
    await expect(generateReportText(pool, visitId)).resolves.toBe(`${street}, Finish/ AC started $20, weigh-in data $20, total $40`);
  });

  it('formats a cancelled visit without invalidated items and preserves notes', async () => {
    const { visitId, street } = await setupVisit({ serviceName: null, totalPrice: 0, notes: 'Customer requested cancellation', status: 'cancelled' });
    await expect(generateReportText(pool, visitId)).resolves.toBe(`${street}, Customer requested cancellation, service canceled $0, total $0`);
  });

  it('suppresses legacy normal work and address weigh-in data for a cancelled report', async () => {
    const checklistAnswers = [{ answer: 'no', reportText: 'No/Incomplete pdrain' }];
    const { visitId, street, addressId } = await setupVisit({
      serviceName: 'AC', totalPrice: 0, notes: 'Customer requested cancellation', checklistAnswers, status: 'cancelled',
    });
    await addItem(visitId, { itemName: 'Weight-In-Data', category: 'accessory', price: 20 });
    await pool.query(
      `INSERT INTO catalog_lineset_configs (config_key, reference_length_ft, adjust_rate_oz_per_ft)
       VALUES ('CANCEL-REPORT-LINESET', 15, 0.6)
       ON CONFLICT (config_key) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO weigh_in_data (id, address_id, system_number, lineset_length, factory_line_config)
       VALUES (gen_random_uuid()::text, $1, 1, 25, 'CANCEL-REPORT-LINESET')`,
      [addressId]
    );

    await expect(generateReportText(pool, visitId)).resolves.toBe(
      `${street}, Customer requested cancellation | No/Incomplete pdrain, service canceled $0, total $0`
    );
    const report = await generateReportJSON(pool, visitId);
    expect(report.services).toEqual([]);
    expect(report.items).toEqual([]);
    expect(report.weighInData).toEqual([]);
  });

  it('has no empty or duplicate separators when optional sections are absent', async () => {
    const { visitId, street } = await setupVisit({ serviceName: 'AC', servicePrice: 30, totalPrice: 30, notes: '   ' });
    const text = await generateReportText(pool, visitId);
    expect(text).toBe(`${street}, AC started $30, total $30`);
    expect(text).not.toMatch(/(^,|,\s*,|,\s*$|undefined|null)/);
  });
});

describe('generateReportJSON', () => {
  it('returns visit with nested address, systems, services, items, photos, weighInData', async () => {
    const { visitId, addressId } = await setupVisit();
    await addItem(visitId, { itemName: 'TEST-ITEM', category: 'accessory', price: 25 });
    await pool.query(
      `INSERT INTO visit_photos (id, visit_id, system_number, slug, tag, label, category, stored_at)
       VALUES (gen_random_uuid()::text, $1, 1, 'TEST_SLUG', 'scale', null, 'weigh_in_scale', null)`,
      [visitId]
    );

    const report = await generateReportJSON(pool, visitId);

    expect(report.id).toBe(visitId);
    expect(report.status).toBeDefined();
    expect(report.completedAt).toBe('2026-07-01T10:00:00.000Z');
    expect(report.address).toMatchObject({ builder: 'DR HORTON', subdivision: 'TEST SUB' });
    expect(report.systems).toHaveLength(1);
    expect(report.systems[0].systemNumber).toBe(1);
    expect(report.services).toHaveLength(1);
    expect(report.services[0].serviceName).toBe('AC');
    expect(report.items).toHaveLength(1);
    expect(report.items[0].itemName).toBe('TEST-ITEM');
    expect(report.items[0].description).toBeNull();
    expect(report.photos).toHaveLength(1);
    expect(report.photos[0]).toEqual({ slug: 'TEST_SLUG' });
    expect(Array.isArray(report.weighInData)).toBe(true);
  });

  it('includes weighInData keyed by address_id', async () => {
    const { visitId, addressId } = await setupVisit();
    await pool.query(
      `INSERT INTO catalog_lineset_configs (config_key, reference_length_ft, adjust_rate_oz_per_ft)
       VALUES ('STANDARD', 15, 0.6)
       ON CONFLICT (config_key) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO weigh_in_data
         (id, address_id, system_number, lineset_length, subcooling_value, oem_subcooling_goal, subcooling_deviation)
       VALUES (gen_random_uuid()::text, $1, 1, 25, 12, 10, 2)`,
      [addressId]
    );

    const report = await generateReportJSON(pool, visitId);

    expect(report.weighInData).toHaveLength(1);
    expect(report.weighInData[0].systemNumber).toBe(1);
    expect(report.weighInData[0].subcoolingValue).toBe(12);
  });
});
