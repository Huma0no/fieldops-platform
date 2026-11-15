const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/index');
const auth = require('../src/routes/auth');
const { pool: appPool } = require('../src/db/pool');
const { pool, truncateTables } = require('./helpers/db');

beforeEach(truncateTables);
afterAll(async () => Promise.all([pool.end(), appPool.end()]));

async function seedAccount({ role = 'technician', username = `user-${crypto.randomBytes(4).toString('hex')}`, password = 'TemporaryPassword123!', active = true, mustChange = false } = {}) {
  const passwordHash = await auth.hashPassword(password);
  const result = await pool.query(
    `INSERT INTO technicians (id, name, role, is_active, created_at, username, password_hash, must_change_password)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7) RETURNING id, username, role`,
    [`Test ${role}`, role, active, new Date().toISOString(), username, passwordHash, mustChange]
  );
  return { ...result.rows[0], password };
}

async function login(account) {
  return request(app).post('/api/auth/login').send({ username: account.username, password: account.password });
}

async function seedSession(technicianId) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await pool.query('INSERT INTO auth_sessions (token_hash, technician_id, created_at, expires_at) VALUES ($1, $2, $3, \'9999-12-31T00:00:00.000Z\')', [tokenHash, technicianId, new Date().toISOString()]);
  return token;
}

async function waitForLockingQuery(pattern) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await pool.query(
      `SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
       AND state = 'active' AND wait_event_type = 'Lock' AND query ILIKE $1 LIMIT 1`,
      [pattern]
    );
    if (result.rowCount) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for database lock query ${pattern}`);
}

describe('username and password authentication', () => {
  it('authenticates by case-insensitive username and issues an HttpOnly server-managed cookie', async () => {
    const account = await seedAccount({ username: 'CaseUser' });
    const response = await login(account);
    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ id: account.id, username: 'CaseUser', role: 'TECHNICIAN' });
    expect(response.body.deviceToken).toBeUndefined();
    expect(response.headers['set-cookie'][0]).toMatch(/fieldops_session=.*HttpOnly.*SameSite=Strict/);
    expect(response.headers['set-cookie'][0]).toMatch(/Path=\/api/);
    const stored = await pool.query('SELECT token_hash FROM auth_sessions WHERE technician_id = $1', [account.id]);
    expect(stored.rowCount).toBe(1);
    expect(stored.rows[0].token_hash).not.toBe(response.headers['set-cookie'][0].match(/fieldops_session=([^;]+)/)[1]);
  });

  it('rejects invalid credentials and inactive accounts', async () => {
    const account = await seedAccount({ username: 'invalid-check' });
    expect((await request(app).post('/api/auth/login').send({ username: account.username, password: 'wrong-password' })).status).toBe(401);
    const inactive = await seedAccount({ username: 'inactive-check', active: false });
    expect((await login(inactive)).status).toBe(401);
  });

  it('blocks operational routes until a temporary password is changed', async () => {
    const account = await seedAccount({ username: 'temp-account', mustChange: true });
    const response = await login(account);
    const cookie = response.headers['set-cookie'][0].split(';')[0];
    const denied = await request(app).get('/api/visits/mine').set('Cookie', cookie);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    const changed = await request(app).post('/api/auth/change-password').set('Cookie', cookie)
      .set('X-FieldOps-Request', '1').send({ currentPassword: account.password, newPassword: 'ChangedPassword456!' });
    expect(changed.status).toBe(200);
    const saved = await pool.query('SELECT must_change_password FROM technicians WHERE id = $1', [account.id]);
    expect(saved.rows[0].must_change_password).toBe(false);
    expect((await request(app).get('/api/visits/mine').set('Cookie', cookie)).status).toBe(200);
  });

  it('requires the CSRF request header for cookie-authenticated mutations', async () => {
    const account = await seedAccount({ username: 'csrf-account' });
    const response = await login(account);
    const cookie = response.headers['set-cookie'][0].split(';')[0];
    const denied = await request(app).post('/api/auth/logout').set('Cookie', cookie).send({});
    expect(denied.status).toBe(403);
    const accepted = await request(app).post('/api/auth/logout').set('Cookie', cookie).set('X-FieldOps-Request', '1').send({});
    expect(accepted.status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);
  });

  it('does not grant Dispatch endpoints to a technician account', async () => {
    const account = await seedAccount({ role: 'technician', username: 'field-user' });
    const response = await login(account);
    const cookie = response.headers['set-cookie'][0].split(';')[0];
    expect((await request(app).get('/api/dispatch/history').set('Cookie', cookie)).status).toBe(403);
  });

  it('serializes login and deactivation so a login queued first is revoked before deactivation completes', async () => {
    const tech = await seedAccount({ username: 'login-wins' });
    const owner = await seedAccount({ role: 'owner', username: 'lock-owner' });
    const ownerToken = await seedSession(owner.id);
    const blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM technicians WHERE id = $1 FOR UPDATE', [tech.id]);
    const loginPromise = login(tech).then(response => response);
    let deactivatePromise;
    try {
      await waitForLockingQuery('%password_hash FROM technicians WHERE id = $1 FOR UPDATE%');
      deactivatePromise = request(app).patch(`/api/dispatch/technicians/${tech.id}/deactivate`)
        .set('Authorization', `Bearer ${ownerToken}`).then(response => response);
      await waitForLockingQuery('%UPDATE technicians SET is_active = false%');
    } finally {
      await blocker.query('ROLLBACK').catch(() => {});
      blocker.release();
    }
    const [loginResponse, deactivateResponse] = await Promise.all([loginPromise, deactivatePromise]);
    expect(loginResponse.status).toBe(200);
    expect(deactivateResponse.status).toBe(200);
    const cookie = loginResponse.headers['set-cookie'][0].split(';')[0];
    expect((await request(app).get('/api/visits/mine').set('Cookie', cookie)).status).toBe(401);
  });

  it('rejects login queued behind deactivation', async () => {
    const tech = await seedAccount({ username: 'deactivation-wins' });
    const owner = await seedAccount({ role: 'owner', username: 'lock-owner-2' });
    const ownerToken = await seedSession(owner.id);
    const blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM technicians WHERE id = $1 FOR UPDATE', [tech.id]);
    const deactivatePromise = request(app).patch(`/api/dispatch/technicians/${tech.id}/deactivate`)
      .set('Authorization', `Bearer ${ownerToken}`).then(response => response);
    let loginPromise;
    try {
      await waitForLockingQuery('%UPDATE technicians SET is_active = false%');
      loginPromise = login(tech).then(response => response);
      await waitForLockingQuery('%password_hash FROM technicians WHERE id = $1 FOR UPDATE%');
    } finally {
      await blocker.query('ROLLBACK').catch(() => {});
      blocker.release();
    }
    const [deactivateResponse, loginResponse] = await Promise.all([deactivatePromise, loginPromise]);
    expect(deactivateResponse.status).toBe(200);
    expect(loginResponse.status).toBe(401);
  });
});

describe('session revocation and login responses', () => {
  it('revokes the other sessions when the technician changes the password', async () => {
    const tech = await seedAccount();
    const current = await seedSession(tech.id);
    const other = await seedSession(tech.id);
    const response = await request(app).post('/api/auth/change-password')
      .set('Authorization', `Bearer ${current}`)
      .send({ currentPassword: tech.password, newPassword: 'AnotherPassword456!' });
    expect(response.status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${current}`)).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${other}`)).status).toBe(401);
  });

  it('rejects unknown usernames and wrong passwords with the same response', async () => {
    const tech = await seedAccount({ username: 'known-user' });
    const unknown = await request(app).post('/api/auth/login').send({ username: 'nobody-here', password: tech.password });
    const wrong = await request(app).post('/api/auth/login').send({ username: 'known-user', password: 'WrongPassword999!' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });
});

describe('initial Dispatch Owner bootstrap', () => {
  it('is concurrency safe, creates the Dispatcher account once, and never resets it', async () => {
    const prior = process.env.DISPATCH_BOOTSTRAP_PASSWORD;
    process.env.DISPATCH_BOOTSTRAP_PASSWORD = 'BootstrapPassword123!';
    try {
      const outcomes = await Promise.all([auth.bootstrapInitialOwner(), auth.bootstrapInitialOwner()]);
      expect(outcomes.filter(result => result.initialized)).toHaveLength(1);
      expect(outcomes.filter(result => result.alreadyInitialized)).toHaveLength(1);
      const account = await pool.query("SELECT id, role, username, must_change_password, password_hash FROM technicians WHERE lower(username) = 'dispatcher'");
      expect(account.rows).toHaveLength(1);
      expect(account.rows[0]).toMatchObject({ role: 'owner', username: 'Dispatcher', must_change_password: true });
      expect(account.rows[0].password_hash).not.toContain('BootstrapPassword123!');
      process.env.DISPATCH_BOOTSTRAP_PASSWORD = '';
      expect(await auth.bootstrapInitialOwner()).toMatchObject({ alreadyInitialized: true });
    } finally {
      if (prior === undefined) delete process.env.DISPATCH_BOOTSTRAP_PASSWORD;
      else process.env.DISPATCH_BOOTSTRAP_PASSWORD = prior;
    }
  });

  it('reuses the unique legacy owner identity without changing its technician ID', async () => {
    const owner = await pool.query(
      `INSERT INTO technicians (name, role, is_active, created_at) VALUES ('Original Owner', 'owner', true, $1) RETURNING id`,
      [new Date().toISOString()]
    );
    const prior = process.env.DISPATCH_BOOTSTRAP_PASSWORD;
    process.env.DISPATCH_BOOTSTRAP_PASSWORD = 'BootstrapPassword123!';
    try {
      await auth.bootstrapInitialOwner();
      const row = await pool.query('SELECT id, name, username FROM technicians WHERE username = $1', ['Dispatcher']);
      expect(row.rows[0]).toEqual({ id: owner.rows[0].id, name: 'Original Owner', username: 'Dispatcher' });
    } finally {
      if (prior === undefined) delete process.env.DISPATCH_BOOTSTRAP_PASSWORD;
      else process.env.DISPATCH_BOOTSTRAP_PASSWORD = prior;
    }
  });
});
