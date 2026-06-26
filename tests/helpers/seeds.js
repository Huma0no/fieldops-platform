const crypto = require('crypto');
const { pool } = require('./db');

async function seedTech({ role = 'technician', name, isActive = true } = {}) {
  const techName = name || `Tech-${role}`;
  const r = await pool.query(
    `INSERT INTO technicians (id, name, role, is_active, created_at)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4)
     RETURNING id, name, role`,
    [techName, role, isActive, new Date().toISOString()]
  );
  return r.rows[0];
}

async function seedToken(technicianId) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    'INSERT INTO device_tokens (token, technician_id, created_at) VALUES ($1, $2, $3)',
    [token, technicianId, new Date().toISOString()]
  );
  return token;
}

async function seedDispatcherWithToken() {
  const dispatcher = await seedTech({ role: 'dispatcher', name: 'Dispatcher' });
  const token = await seedToken(dispatcher.id);
  return { dispatcher, token };
}

async function seedTechnicianWithToken({ name } = {}) {
  const tech = await seedTech({ role: 'technician', name: name || 'Tech-1' });
  const token = await seedToken(tech.id);
  return { tech, token };
}

async function seedInLobbyVisit({ addressOverrides = {}, systemCount = 1, withA2l = false } = {}) {
  const street = addressOverrides.street || `${crypto.randomBytes(4).toString('hex')} TEST ST`;
  const addrResult = await pool.query(
    `INSERT INTO addresses (id, street, city, subdivision, builder)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4) RETURNING id`,
    [
      street,
      addressOverrides.city || 'Houston',
      addressOverrides.subdivision || 'TEST SUB',
      addressOverrides.builder || 'DR HORTON',
    ]
  );
  const addressId = addrResult.rows[0].id;

  const now = new Date().toISOString();
  const visitResult = await pool.query(
    `INSERT INTO visits
       (id, address_id, status, has_multiple_systems, is_deferred, scheduled_time, date, created_at, updated_at)
     VALUES (gen_random_uuid()::text, $1, 'in_lobby', $2, false, $3, $4, $5, $5)
     RETURNING id`,
    [addressId, systemCount > 1, '2026-07-01T09:00:00Z', '2026-07-01', now]
  );
  const visitId = visitResult.rows[0].id;

  let a2lModel = null;
  if (withA2l) {
    a2lModel = `TEST-A2L-${crypto.randomBytes(4).toString('hex')}`;
    await pool.query(
      `INSERT INTO catalog_equipment (model, unit_type, brand, is_a2l)
       VALUES ($1, 'indoor', 'TEST', true)
       ON CONFLICT (model) DO NOTHING`,
      [a2lModel]
    );
  }

  for (let i = 1; i <= systemCount; i++) {
    await pool.query(
      `INSERT INTO visit_systems (id, visit_id, system_number, indoor_model)
       VALUES (gen_random_uuid()::text, $1, $2, $3)`,
      [visitId, i, i === 1 && a2lModel ? a2lModel : null]
    );
  }

  return { visitId, addressId, street };
}

async function seedAssignedVisit() {
  const tech = await seedTech({ role: 'technician' });
  const token = await seedToken(tech.id);
  const street = `${crypto.randomBytes(4).toString('hex')} WORKSPACE ST`;
  const addrRes = await pool.query(
    `INSERT INTO addresses (id, street, city, subdivision, builder)
     VALUES (gen_random_uuid()::text, $1, 'Houston', 'TEST SUB', 'DR HORTON') RETURNING id`,
    [street]
  );
  const addressId = addrRes.rows[0].id;
  const now = new Date().toISOString();
  const visitRes = await pool.query(
    `INSERT INTO visits
       (id, address_id, technician_id, status, has_multiple_systems, is_deferred, scheduled_time, date, created_at, updated_at)
     VALUES (gen_random_uuid()::text, $1, $2, 'assigned', false, false, '2026-07-01T09:00:00Z', '2026-07-01', $3, $3)
     RETURNING id`,
    [addressId, tech.id, now]
  );
  const visitId = visitRes.rows[0].id;
  await pool.query(
    `INSERT INTO visit_systems (id, visit_id, system_number) VALUES (gen_random_uuid()::text, $1, 1)`,
    [visitId]
  );
  return { visitId, addressId, street, tech, token };
}

async function seedTransferScenario() {
  const { tech: tech1, token: token1 } = await seedTechnicianWithToken({ name: 'Transfer-Tech1' });
  const { tech: tech2, token: token2 } = await seedTechnicianWithToken({ name: 'Transfer-Tech2' });

  const street = `${crypto.randomBytes(4).toString('hex')} TRANSFER ST`;
  const addrRes = await pool.query(
    `INSERT INTO addresses (id, street, city, subdivision, builder)
     VALUES (gen_random_uuid()::text, $1, 'Houston', 'TEST SUB', 'DR HORTON') RETURNING id`,
    [street]
  );
  const addressId = addrRes.rows[0].id;

  const now = new Date().toISOString();
  const visitRes = await pool.query(
    `INSERT INTO visits
       (id, address_id, technician_id, status, has_multiple_systems, is_deferred,
        scheduled_time, date, created_at, updated_at)
     VALUES (gen_random_uuid()::text, $1, $2, 'assigned', false, false,
             '2026-07-01T09:00:00Z', '2026-07-01', $3, $3)
     RETURNING id`,
    [addressId, tech1.id, now]
  );
  const visitId = visitRes.rows[0].id;

  await pool.query(
    `INSERT INTO visit_systems (id, visit_id, system_number)
     VALUES (gen_random_uuid()::text, $1, 1)`,
    [visitId]
  );

  return { tech1, token1, tech2, token2, visitId, addressId, street };
}

module.exports = { seedTech, seedToken, seedDispatcherWithToken, seedTechnicianWithToken, seedInLobbyVisit, seedAssignedVisit, seedTransferScenario };
