const request = require('supertest');
const app = require('../src/index');
const { pool, truncateTables } = require('./helpers/db');

beforeEach(truncateTables);
afterAll(() => pool.end());

async function seedTech({ role = 'technician', isActive = true } = {}) {
  const r = await pool.query(
    `INSERT INTO technicians (id, name, role, is_active, created_at)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4)
     RETURNING id, name, role`,
    [`Tech ${role}`, role, isActive, new Date().toISOString()]
  );
  return r.rows[0];
}

async function seedDispatcher() {
  return seedTech({ role: 'dispatcher' });
}

async function seedToken(technicianId) {
  const token = require('crypto').randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO device_tokens (token, technician_id, created_at) VALUES ($1, $2, $3)`,
    [token, technicianId, new Date().toISOString()]
  );
  return token;
}

describe('POST /api/auth/generate-invite', () => {
  it('returns 403 for technician role', async () => {
    const tech = await seedTech();
    const token = await seedToken(tech.id);
    const res = await request(app)
      .post('/api/auth/generate-invite')
      .set('Authorization', `Bearer ${token}`)
      .send({ technicianId: tech.id });
    expect(res.status).toBe(403);
  });

  it('returns 400 for inactive technician', async () => {
    const dispatcher = await seedDispatcher();
    const dispToken = await seedToken(dispatcher.id);
    const inactiveTech = await seedTech({ isActive: false });

    const res = await request(app)
      .post('/api/auth/generate-invite')
      .set('Authorization', `Bearer ${dispToken}`)
      .send({ technicianId: inactiveTech.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Technician is inactive. Reactivate before generating an invite.');
  });

  it('generates a 6-char uppercase code and returns expiresAt', async () => {
    const dispatcher = await seedDispatcher();
    const dispToken = await seedToken(dispatcher.id);
    const tech = await seedTech();

    const res = await request(app)
      .post('/api/auth/generate-invite')
      .set('Authorization', `Bearer ${dispToken}`)
      .send({ technicianId: tech.id });

    expect(res.status).toBe(200);
    expect(res.body.inviteCode).toMatch(/^[A-Z0-9]{6}$/);
    expect(res.body.expiresAt).toBeDefined();
  });

  it('replaces existing unused invite for same technician', async () => {
    const dispatcher = await seedDispatcher();
    const dispToken = await seedToken(dispatcher.id);
    const tech = await seedTech();

    await request(app)
      .post('/api/auth/generate-invite')
      .set('Authorization', `Bearer ${dispToken}`)
      .send({ technicianId: tech.id });
    await request(app)
      .post('/api/auth/generate-invite')
      .set('Authorization', `Bearer ${dispToken}`)
      .send({ technicianId: tech.id });

    const codes = await pool.query(
      'SELECT * FROM invite_codes WHERE technician_id = $1',
      [tech.id]
    );
    expect(codes.rows).toHaveLength(1);
  });
});

describe('POST /api/auth/redeem-invite', () => {
  it('returns 401 for unknown code', async () => {
    const res = await request(app)
      .post('/api/auth/redeem-invite')
      .send({ inviteCode: 'XXXXXX' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid invite code');
  });

  it('returns 401 for expired code', async () => {
    const tech = await seedTech();
    const expiredAt = new Date(Date.now() - 1000).toISOString();
    await pool.query(
      `INSERT INTO invite_codes (code, technician_id, expires_at) VALUES ('EXPIRY', $1, $2)`,
      [tech.id, expiredAt]
    );
    const res = await request(app)
      .post('/api/auth/redeem-invite')
      .send({ inviteCode: 'EXPIRY' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invite code has expired');
  });

  it('exchanges valid code for device token and deletes code', async () => {
    const tech = await seedTech();
    const expiresAt = new Date(Date.now() + 86400000).toISOString();
    await pool.query(
      `INSERT INTO invite_codes (code, technician_id, expires_at) VALUES ('VALID1', $1, $2)`,
      [tech.id, expiresAt]
    );

    const res = await request(app)
      .post('/api/auth/redeem-invite')
      .send({ inviteCode: 'VALID1' });

    expect(res.status).toBe(200);
    expect(res.body.deviceToken).toHaveLength(64);
    expect(res.body.technician.id).toBe(tech.id);
    expect(res.body.technician.name).toBe('Tech technician');
    expect(res.body.technician.role).toBe('technician');

    const remaining = await pool.query('SELECT * FROM invite_codes WHERE code = $1', ['VALID1']);
    expect(remaining.rows).toHaveLength(0);
  });
});

describe('POST /api/auth/revoke', () => {
  it('deletes all device tokens for a technician', async () => {
    const dispatcher = await seedDispatcher();
    const dispToken = await seedToken(dispatcher.id);
    const tech = await seedTech();
    await seedToken(tech.id);
    await seedToken(tech.id);

    const res = await request(app)
      .post('/api/auth/revoke')
      .set('Authorization', `Bearer ${dispToken}`)
      .send({ technicianId: tech.id });

    expect(res.status).toBe(200);
    expect(res.body.revoked).toBe(true);

    const remaining = await pool.query(
      'SELECT * FROM device_tokens WHERE technician_id = $1',
      [tech.id]
    );
    expect(remaining.rows).toHaveLength(0);
  });
});
