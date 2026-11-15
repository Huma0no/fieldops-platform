const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/index');
const { pool: appPool } = require('../src/db/pool');
const { pool, truncateTables } = require('./helpers/db');

beforeEach(truncateTables);
afterAll(async () => {
  await Promise.all([pool.end(), appPool.end()]);
});

async function seedTech({ role = 'technician', isActive = true, name = 'Alice' } = {}) {
  const r = await pool.query(
    `INSERT INTO technicians (id, name, role, is_active, created_at)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4)
     RETURNING id, name, role, is_active, created_at`,
    [name, role, isActive, new Date().toISOString()]
  );
  return r.rows[0];
}

async function seedToken(technicianId) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    'INSERT INTO auth_sessions (token_hash, technician_id, created_at, expires_at) VALUES ($1, $2, $3, \'9999-12-31T00:00:00.000Z\')',
    [crypto.createHash('sha256').update(token).digest('hex'), technicianId, new Date().toISOString()]
  );
  return token;
}

async function dispatcherToken() {
  const d = await seedTech({ role: 'owner', name: 'Dispatcher' });
  return { dispatcher: d, token: await seedToken(d.id) };
}

describe('POST /api/dispatch/technicians', () => {
  it('creates technician and returns it', async () => {
    const { token } = await dispatcherToken();
    const res = await request(app)
      .post('/api/dispatch/technicians')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bob', role: 'TECHNICIAN', username: 'bob-tech', temporaryPassword: 'TemporaryPassword123!' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('Bob');
    expect(res.body.role).toBe('TECHNICIAN');
    expect(res.body.commissionRate).toBe(20);
    expect(res.body.isActive).toBe(true);
    expect(res.body.createdAt).toBeDefined();
    expect(res.body.username).toBe('bob-tech');
    expect(res.body.mustChangePassword).toBe(true);
    expect(res.body.password_hash).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('TemporaryPassword123!');
  });

  it('returns 400 for invalid role', async () => {
    const { token } = await dispatcherToken();
    const res = await request(app)
      .post('/api/dispatch/technicians')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bob', role: 'superadmin' });
    expect(res.status).toBe(400);
  });

  it('does not let dispatchers create accounts', async () => {
    const dispatcher = await seedTech({ role: 'dispatcher', name: 'Ops Dispatcher' });
    const token = await seedToken(dispatcher.id);
    const res = await request(app).post('/api/dispatch/technicians')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bob', role: 'TECHNICIAN', username: 'bob-tech', temporaryPassword: 'TemporaryPassword123!' });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/dispatch/technicians', () => {
  it('returns only active technicians by default', async () => {
    const { token } = await dispatcherToken();
    await seedTech({ name: 'Active1' });
    await seedTech({ name: 'Inactive1', isActive: false });

    const res = await request(app)
      .get('/api/dispatch/technicians')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const names = res.body.map((t) => t.name);
    expect(names).toContain('Active1');
    expect(names).not.toContain('Dispatcher');
    expect(names).not.toContain('Inactive1');
  });

  it('returns all technicians when includeInactive=true', async () => {
    const { token } = await dispatcherToken();
    await seedTech({ name: 'Active1' });
    await seedTech({ name: 'Inactive1', isActive: false });

    const res = await request(app)
      .get('/api/dispatch/technicians?includeInactive=true')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const names = res.body.map((t) => t.name);
    expect(names).toContain('Inactive1');
  });
});

describe('PATCH /api/dispatch/technicians/:id/deactivate', () => {
  it('sets is_active to false and returns orphanedVisitIds', async () => {
    const { token } = await dispatcherToken();
    const tech = await seedTech({ name: 'TechToDeactivate' });

    const res = await request(app)
      .patch(`/api/dispatch/technicians/${tech.id}/deactivate`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
    expect(res.body.orphanedVisitIds).toEqual([]);

    const row = await pool.query('SELECT is_active FROM technicians WHERE id = $1', [tech.id]);
    expect(row.rows[0].is_active).toBe(false);
  });

  it('revokes sessions and deletes legacy credentials on deactivation so reactivation does not restore access', async () => {
    const { token: dispToken } = await dispatcherToken();
    const tech = await seedTech({ name: 'TechWithTokens' });
    const otherTech = await seedTech({ name: 'OtherActiveTech' });
    const techToken = await seedToken(tech.id);
    const otherToken = await seedToken(otherTech.id);
    await pool.query(
      'INSERT INTO device_tokens (token, technician_id, created_at) VALUES ($1, $2, $3), ($4, $5, $3)',
      ['legacy-tech', tech.id, new Date().toISOString(), 'legacy-other', otherTech.id]
    );

    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 86400_000).toISOString();
    await pool.query(
      `INSERT INTO invite_codes (code, technician_id, created_at, expires_at)
       VALUES ($1, $2, $3, $4), ($5, $6, $3, $4)`,
      ['111111', tech.id, now, expiresAt, '222222', otherTech.id]
    );

    const deactivateRes = await request(app)
      .patch(`/api/dispatch/technicians/${tech.id}/deactivate`)
      .set('Authorization', `Bearer ${dispToken}`);
    expect(deactivateRes.status).toBe(200);

    const remainingTokens = await pool.query(
      'SELECT technician_id FROM device_tokens WHERE technician_id = $1',
      [tech.id]
    );
    const remainingInvites = await pool.query(
      'SELECT technician_id FROM invite_codes WHERE technician_id = $1',
      [tech.id]
    );
    expect(remainingTokens.rowCount).toBe(0);
    const revoked = await pool.query('SELECT revoked_at FROM auth_sessions WHERE technician_id = $1', [tech.id]);
    expect(revoked.rows[0].revoked_at).toBeTruthy();
    expect(remainingInvites.rowCount).toBe(0);

    // Other technician's tokens and invitations remain intact
    const otherTokens = await pool.query(
      'SELECT technician_id FROM device_tokens WHERE technician_id = $1',
      [otherTech.id]
    );
    const otherInvites = await pool.query(
      'SELECT technician_id FROM invite_codes WHERE technician_id = $1',
      [otherTech.id]
    );
    expect(otherTokens.rowCount).toBe(1);
    const otherSessions = await pool.query('SELECT revoked_at FROM auth_sessions WHERE technician_id = $1', [otherTech.id]);
    expect(otherSessions.rows[0].revoked_at).toBeNull();
    expect(otherInvites.rowCount).toBe(1);

    // Reactivate the technician — old token must still be rejected with 401
    const reactivateRes = await request(app)
      .patch(`/api/dispatch/technicians/${tech.id}/reactivate`)
      .set('Authorization', `Bearer ${dispToken}`);
    expect(reactivateRes.status).toBe(200);

    const meRes = await request(app)
      .get('/api/visits/mine')
      .set('Authorization', `Bearer ${techToken}`);
    expect(meRes.status).toBe(401);

    const otherMeRes = await request(app)
      .get('/api/visits/mine')
      .set('Authorization', `Bearer ${otherToken}`);
    expect(otherMeRes.status).toBe(200);
  });

  it('rolls back the active flag and both credential deletions if a deactivation delete fails', async () => {
    const { token: dispToken } = await dispatcherToken();
    const tech = await seedTech({ name: 'RollbackTech' });
    const token = await seedToken(tech.id);
    await pool.query('INSERT INTO device_tokens (token, technician_id, created_at) VALUES ($1, $2, $3)', ['rollback-legacy', tech.id, new Date().toISOString()]);
    await pool.query(
      'INSERT INTO invite_codes (code, technician_id, expires_at) VALUES ($1, $2, $3)',
      ['ROLLBACK-INVITE', tech.id, new Date(Date.now() + 86400000).toISOString()]
    );

    const originalConnect = appPool.connect.bind(appPool);
    const connectSpy = jest.spyOn(appPool, 'connect').mockImplementation(function (...args) {
      if (args.length > 0) return originalConnect(...args);
      return originalConnect().then(client => {
        const originalQuery = client.query.bind(client);
        const originalRelease = client.release.bind(client);
        client.query = async function (sql, params, ...rest) {
          if (typeof sql === 'string' && sql.startsWith('DELETE FROM device_tokens')) {
            throw new Error('Injected device token deletion failure');
          }
          return originalQuery(sql, params, ...rest);
        };
        client.release = function (...releaseArgs) {
          client.query = originalQuery;
          client.release = originalRelease;
          return originalRelease(...releaseArgs);
        };
        return client;
      });
    });

    try {
      const res = await request(app)
        .patch(`/api/dispatch/technicians/${tech.id}/deactivate`)
        .set('Authorization', `Bearer ${dispToken}`);
      expect(res.status).toBe(500);

      const technician = await pool.query('SELECT is_active FROM technicians WHERE id = $1', [tech.id]);
      const tokens = await pool.query('SELECT token FROM device_tokens WHERE technician_id = $1', [tech.id]);
      const sessions = await pool.query('SELECT revoked_at FROM auth_sessions WHERE technician_id = $1', [tech.id]);
      const invites = await pool.query('SELECT code FROM invite_codes WHERE technician_id = $1', [tech.id]);
      expect(technician.rows[0].is_active).toBe(true);
      expect(tokens.rows.map(row => row.token)).toContain('rollback-legacy');
      expect(sessions.rows[0].revoked_at).toBeNull();
      expect(invites.rows.map(row => row.code)).toContain('ROLLBACK-INVITE');
    } finally {
      connectSpy.mockRestore();
    }
  });
});

describe('PATCH /api/dispatch/technicians/:id/reactivate', () => {
  it('sets is_active to true', async () => {
    const { token } = await dispatcherToken();
    const tech = await seedTech({ name: 'InactiveTech', isActive: false });

    const res = await request(app)
      .patch(`/api/dispatch/technicians/${tech.id}/reactivate`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(true);

    const row = await pool.query('SELECT is_active FROM technicians WHERE id = $1', [tech.id]);
    expect(row.rows[0].is_active).toBe(true);
  });
});

describe('account password administration', () => {
  it('provisions an existing technician identity without changing its ID or operational references', async () => {
    const { token: ownerToken } = await dispatcherToken();
    const tech = await seedTech({ name: 'LegacyTech' });
    const response = await request(app).post(`/api/dispatch/technicians/${tech.id}/provision-account`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ username: 'legacy-tech', temporaryPassword: 'TemporaryPassword123!' });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ id: tech.id, name: tech.name, role: 'TECHNICIAN', username: 'legacy-tech', mustChangePassword: true });
    const row = await pool.query('SELECT id, username, must_change_password FROM technicians WHERE id = $1', [tech.id]);
    expect(row.rows[0]).toMatchObject({ id: tech.id, username: 'legacy-tech', must_change_password: true });
  });

  it('rejects an already provisioned identity and duplicate usernames', async () => {
    const { token: ownerToken } = await dispatcherToken();
    const first = await seedTech({ name: 'Existing Account' });
    const second = await seedTech({ name: 'Second Existing Account' });
    const payload = { username: 'same-login', temporaryPassword: 'TemporaryPassword123!' };
    expect((await request(app).post(`/api/dispatch/technicians/${first.id}/provision-account`).set('Authorization', `Bearer ${ownerToken}`).send(payload)).status).toBe(201);
    expect((await request(app).post(`/api/dispatch/technicians/${first.id}/provision-account`).set('Authorization', `Bearer ${ownerToken}`).send(payload)).status).toBe(409);
    expect((await request(app).post(`/api/dispatch/technicians/${second.id}/provision-account`).set('Authorization', `Bearer ${ownerToken}`).send({ ...payload, username: 'SAME-LOGIN' })).status).toBe(409);
  });

  it('resets the password, requires replacement, and revokes every existing session', async () => {
    const { token: ownerToken } = await dispatcherToken();
    const tech = await seedTech({ name: 'ResetTech' });
    const provisioned = await request(app).post(`/api/dispatch/technicians/${tech.id}/provision-account`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ username: 'reset-tech', temporaryPassword: 'OriginalPassword123!' });
    expect(provisioned.status).toBe(201);
    const firstSession = await seedToken(tech.id);
    const secondSession = await seedToken(tech.id);
    const res = await request(app).patch(`/api/dispatch/technicians/${tech.id}/password`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ temporaryPassword: 'ResetPassword123!' });
    expect(res.status).toBe(200);
    const rows = await pool.query('SELECT revoked_at FROM auth_sessions WHERE technician_id = $1', [tech.id]);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.every(row => row.revoked_at)).toBe(true);
    expect((await request(app).get('/api/visits/mine').set('Authorization', `Bearer ${firstSession}`)).status).toBe(401);
    const account = await pool.query('SELECT must_change_password FROM technicians WHERE id = $1', [tech.id]);
    expect(account.rows[0].must_change_password).toBe(true);
    expect(secondSession).toBeTruthy();
  });

  it('revokes sessions transactionally for the selected account', async () => {
    const { token: ownerToken } = await dispatcherToken();
    const tech = await seedTech({ name: 'RevokeTech' });
    const provision = await request(app).post(`/api/dispatch/technicians/${tech.id}/provision-account`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ username: 'revoke-tech', temporaryPassword: 'TemporaryPassword123!' });
    expect(provision.status).toBe(201);
    await seedToken(tech.id);
    const response = await request(app).post(`/api/dispatch/technicians/${tech.id}/revoke-sessions`)
      .set('Authorization', `Bearer ${ownerToken}`).send({});
    expect(response.status).toBe(200);
    expect(response.body.revokedSessions).toBe(1);
    const row = await pool.query('SELECT revoked_at FROM auth_sessions WHERE technician_id = $1', [tech.id]);
    expect(row.rows[0].revoked_at).toBeTruthy();
  });
});

describe('PATCH /api/dispatch/technicians/:id/commission-rate', () => {
  it('updates commission_rate independently per technician', async () => {
    const { token } = await dispatcherToken();
    const tech = await seedTech({ name: 'RateTech' });

    const res = await request(app)
      .patch(`/api/dispatch/technicians/${tech.id}/commission-rate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ commissionRate: 30 });

    expect(res.status).toBe(200);
    expect(res.body.commissionRate).toBe(30);

    const row = await pool.query('SELECT commission_rate FROM technicians WHERE id = $1', [tech.id]);
    expect(row.rows[0].commission_rate).toBe(30);
  });

  it('rejects the owner role', async () => {
    const { token } = await dispatcherToken();
    const owner = await seedTech({ name: 'Owner1', role: 'owner' });

    const res = await request(app)
      .patch(`/api/dispatch/technicians/${owner.id}/commission-rate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ commissionRate: 30 });

    expect(res.status).toBe(400);
  });

  it('rejects an out-of-range value', async () => {
    const { token } = await dispatcherToken();
    const tech = await seedTech({ name: 'RateTech2' });

    const res = await request(app)
      .patch(`/api/dispatch/technicians/${tech.id}/commission-rate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ commissionRate: 150 });

    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown technician', async () => {
    const { token } = await dispatcherToken();

    const res = await request(app)
      .patch(`/api/dispatch/technicians/nonexistent-id/commission-rate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ commissionRate: 30 });

    expect(res.status).toBe(404);
  });
});
