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

module.exports = { seedTech, seedToken, seedDispatcherWithToken };
