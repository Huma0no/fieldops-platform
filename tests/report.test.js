const { pool, truncateTables } = require('./helpers/db');
const { seedAssignedVisit } = require('./helpers/seeds');
const { generateReportText, generateReportJSON } = require('../src/services/report');

beforeEach(truncateTables);
afterAll(() => pool.end());

async function setupVisitWithService(visitId, serviceName = 'AC', isFinish = false, isTemporarily = false) {
  await pool.query(`
    INSERT INTO catalog_services (service_name, default_price, is_bundle, multiplies_by_system_count)
    VALUES ('AC', 150, false, false), ('Heat', 100, false, false)
    ON CONFLICT (service_name) DO NOTHING
  `);
  await pool.query(
    `INSERT INTO visit_services (id, visit_id, service_name, is_finish, is_temporarily, price)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, 150)`,
    [visitId, serviceName, isFinish, isTemporarily]
  );
  await pool.query(
    `UPDATE visits SET total_price = 150, completed_at = '2026-07-01T10:00:00.000Z' WHERE id = $1`,
    [visitId]
  );
}

describe('generateReportText', () => {
  it('returns comma-separated string with all required fields', async () => {
    const { visitId } = await seedAssignedVisit();
    await setupVisitWithService(visitId);

    const text = await generateReportText(pool, visitId);
    const parts = text.split(',');

    expect(parts).toHaveLength(10);
    expect(parts[3]).toBe('DR HORTON');   // builder
    expect(parts[4]).toBe('AC');           // serviceName
    expect(parts[5]).toBe('false');        // isFinish
    expect(parts[6]).toBe('false');        // isTemporarily
    expect(parts[7]).toBe('1');            // systemCount
    expect(parts[8]).toBe('150');          // totalPrice
    expect(parts[9]).toBe('2026-07-01T10:00:00.000Z'); // completedAt
  });

  it('includes street and subdivision from address', async () => {
    const { visitId, street } = await seedAssignedVisit();
    await setupVisitWithService(visitId);

    const text = await generateReportText(pool, visitId);
    const parts = text.split(',');

    expect(parts[1]).toBe(street);        // street
    expect(parts[2]).toBe('TEST SUB');    // subdivision
  });

  it('reflects isFinish and isTemporarily flags', async () => {
    const { visitId } = await seedAssignedVisit();
    await setupVisitWithService(visitId, 'Heat', true, false);

    const text = await generateReportText(pool, visitId);
    const parts = text.split(',');

    expect(parts[4]).toBe('Heat');
    expect(parts[5]).toBe('true');
    expect(parts[6]).toBe('false');
  });
});

describe('generateReportJSON', () => {
  it('returns visit with nested address, systems, services, items, photos, weighInData', async () => {
    const { visitId, addressId } = await seedAssignedVisit();
    await setupVisitWithService(visitId);

    await pool.query(`
      INSERT INTO catalog_items (item_name, category, default_price, tech_supplied)
      VALUES ('TEST-ITEM', 'accessory', 25, false)
      ON CONFLICT (item_name) DO NOTHING
    `);
    await pool.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, 'TEST-ITEM', 'accessory', 1, 25, false)`,
      [visitId]
    );
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
    expect(report.photos).toHaveLength(1);
    expect(report.photos[0]).toEqual({ slug: 'TEST_SLUG' });
    expect(Array.isArray(report.weighInData)).toBe(true);
  });

  it('includes weighInData keyed by address_id', async () => {
    const { visitId, addressId } = await seedAssignedVisit();
    await setupVisitWithService(visitId);

    await pool.query(`
      INSERT INTO catalog_lineset_configs (config_key, reference_length_ft, adjust_rate_oz_per_ft)
      VALUES ('STANDARD', 15, 0.6)
      ON CONFLICT (config_key) DO NOTHING
    `);
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
