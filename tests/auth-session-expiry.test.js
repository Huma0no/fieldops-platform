const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/index');
const auth = require('../src/routes/auth');
const { pool: appPool } = require('../src/db/pool');
const { pool, truncateTables } = require('./helpers/db');

beforeEach(truncateTables);
afterAll(async () => Promise.all([pool.end(), appPool.end()]));

async function seedAccount() {
  const password = 'TemporaryPassword123!';
  const result = await pool.query(
    `INSERT INTO technicians (id, name, role, is_active, created_at, username, password_hash, must_change_password)
     VALUES (gen_random_uuid()::text, 'Expiry tech', 'technician', true, $1, $2, $3, false) RETURNING id, username`,
    [new Date().toISOString(), `user-${crypto.randomBytes(4).toString('hex')}`, await auth.hashPassword(password)]
  );
  return { ...result.rows[0], password };
}

async function seedSession(technicianId) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await pool.query(
    'INSERT INTO auth_sessions (token_hash, technician_id, created_at, expires_at) VALUES ($1, $2, $3, $4)',
    [tokenHash, technicianId, new Date().toISOString(), '9999-12-31T00:00:00.000Z']
  );
  return token;
}

describe('session expiry', () => {
  const at = iso => new Date(iso);

  it('keeps a "Keep me signed in" session for 7 days from login', () => {
    expect(auth.sessionExpiry(true, at('2026-11-15T20:00:00.000Z')).toISOString()).toBe('2026-11-22T20:00:00.000Z');
  });

  it('otherwise ends the session at the next 03:00 company time (America/Chicago)', () => {
    // 14:00 CST → 03:00 CST next day.
    expect(auth.sessionExpiry(false, at('2026-11-15T20:00:00.000Z'), 'America/Chicago').toISOString()).toBe('2026-11-16T09:00:00.000Z');
    // 01:30 CST → 03:00 the same night (1 h 30 min left).
    expect(auth.sessionExpiry(false, at('2026-11-16T07:30:00.000Z'), 'America/Chicago').toISOString()).toBe('2026-11-16T09:00:00.000Z');
  });

  it('skips to the following 03:00 when less than an hour remains', () => {
    // 02:30 CST → 03:00 CST the next day.
    expect(auth.sessionExpiry(false, at('2026-11-16T08:30:00.000Z'), 'America/Chicago').toISOString()).toBe('2026-11-17T09:00:00.000Z');
  });

  it('follows daylight saving changes', () => {
    // Spring forward: 23:00 CST Mar 13 → 03:00 CDT Mar 14 (UTC-5).
    expect(auth.sessionExpiry(false, at('2027-03-14T05:00:00.000Z'), 'America/Chicago').toISOString()).toBe('2027-03-14T08:00:00.000Z');
    // Fall back: 23:00 CDT Oct 31 → 03:00 CST Nov 1 (UTC-6).
    expect(auth.sessionExpiry(false, at('2026-11-01T04:00:00.000Z'), 'America/Chicago').toISOString()).toBe('2026-11-01T09:00:00.000Z');
  });

  it('stores the expiry chosen at login and sets the same cookie expiry', async () => {
    const tech = await seedAccount();
    const before = Date.now();
    const kept = await request(app).post('/api/auth/login').send({ username: tech.username, password: tech.password });
    const notKept = await request(app).post('/api/auth/login').send({ username: tech.username, password: tech.password, keepSignedIn: false });
    expect(kept.status).toBe(200);
    expect(notKept.status).toBe(200);
    const keptMs = new Date(kept.body.expiresAt).getTime() - before;
    expect(keptMs).toBeGreaterThan(7 * 24 * 3600 * 1000 - 60000);
    expect(keptMs).toBeLessThan(7 * 24 * 3600 * 1000 + 60000);
    expect(new Date(notKept.body.expiresAt).getTime() - before).toBeLessThanOrEqual(25 * 3600 * 1000);
    expect(notKept.headers['set-cookie'][0]).toContain(`Expires=${new Date(notKept.body.expiresAt).toUTCString()}`);
    const stored = await pool.query('SELECT expires_at FROM auth_sessions WHERE technician_id = $1 ORDER BY expires_at', [tech.id]);
    expect(stored.rows.map(r => r.expires_at)).toEqual([notKept.body.expiresAt, kept.body.expiresAt]);
  });

  it('rejects a session after its expiry', async () => {
    const tech = await seedAccount();
    const token = await seedSession(tech.id);
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await pool.query('UPDATE auth_sessions SET expires_at = $1 WHERE token_hash = $2', [new Date(Date.now() - 1000).toISOString(), tokenHash]);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });
});
