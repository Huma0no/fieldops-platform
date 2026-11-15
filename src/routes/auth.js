const express = require('express');
const crypto = require('crypto');
const { promisify } = require('util');
const { pool } = require('../db/pool');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = 'fieldops_session';
const SESSION_COOKIE_EXPIRY = 'Fri, 31 Dec 9999 23:59:59 GMT';
const MIN_PASSWORD_LENGTH = 12;
// Verified when the username does not exist, so the response time does not reveal it.
const DUMMY_PASSWORD_HASH = `scrypt$32768$8$1$${'0'.repeat(32)}$${'0'.repeat(128)}`;

function normalizeUsername(username) {
  return typeof username === 'string' ? username.trim().toLowerCase() : '';
}

function validPassword(password) {
  return typeof password === 'string' && password.length >= MIN_PASSWORD_LENGTH && password.length <= 256;
}

function publicRole(role) {
  return { owner: 'DISPATCH_OWNER', dispatcher: 'DISPATCHER', technician: 'TECHNICIAN' }[role] ?? role;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$32768$8$1$${salt.toString('hex')}$${derived.toString('hex')}`;
}

async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 256 || typeof encoded !== 'string') return false;
  const [algorithm, n, r, p, saltHex, hashHex] = encoded.split('$');
  if (algorithm !== 'scrypt' || n !== '32768' || r !== '8' || p !== '1' || !/^[a-f0-9]{32}$/.test(saltHex) || !/^[a-f0-9]{128}$/.test(hashHex)) return false;
  try {
    const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), 64, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(actual, Buffer.from(hashHex, 'hex'));
  } catch (_) {
    return false;
  }
}

function sessionCookie(token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/api; HttpOnly; SameSite=Strict; Expires=${SESSION_COOKIE_EXPIRY}${secure}`;
}

function clearSessionCookie() {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/api; HttpOnly; SameSite=Strict; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`;
}

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    role: publicRole(row.role),
    mustChangePassword: row.must_change_password,
  };
}

router.post('/login', async (req, res, next) => {
  try {
    const username = normalizeUsername(req.body?.username);
    const result = await pool.query(
      `SELECT id, name, username, role, password_hash, must_change_password, is_active
       FROM technicians WHERE lower(username) = $1`,
      [username]
    );
    const account = result.rows[0];
    // scrypt runs outside any row lock, and always runs, even for unknown usernames.
    const passwordOk = await verifyPassword(req.body?.password, account?.password_hash ?? DUMMY_PASSWORD_HASH);
    if (!account || !account.is_active || !passwordOk) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const client = await pool.connect();
    let started = false;
    try {
      // Short lock: serializes with deactivation and password changes, re-checking
      // that the account is still active with the password hash just verified.
      await client.query('BEGIN');
      started = true;
      const locked = await client.query(
        'SELECT is_active, password_hash FROM technicians WHERE id = $1 FOR UPDATE',
        [account.id]
      );
      if (!locked.rows[0]?.is_active || locked.rows[0].password_hash !== account.password_hash) {
        await client.query('ROLLBACK');
        started = false;
        return res.status(401).json({ error: 'Invalid username or password' });
      }
      const now = new Date().toISOString();
      await client.query(
        'INSERT INTO auth_sessions (token_hash, technician_id, created_at, last_used_at) VALUES ($1, $2, $3, $3)',
        [tokenHash, account.id, now]
      );
      await client.query('COMMIT');
      started = false;
    } catch (err) {
      if (started) await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    res.set('Set-Cookie', sessionCookie(token));
    res.json({ user: publicUser(account) });
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, (req, res) => {
  const user = { ...req.technician, role: publicRole(req.technician.role) };
  res.json({ user, mustChangePassword: user.mustChangePassword });
});

router.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    if (!validPassword(newPassword)) {
      return res.status(400).json({ error: `Password must be between ${MIN_PASSWORD_LENGTH} and 256 characters` });
    }
    // Verify the current password before taking the row lock (scrypt is slow).
    const current = await pool.query('SELECT is_active, password_hash FROM technicians WHERE id = $1', [req.technician.id]);
    if (!current.rows[0]?.is_active) return res.status(401).json({ error: 'Account is disabled' });
    const verifiedHash = current.rows[0].password_hash;
    if (!(await verifyPassword(currentPassword, verifiedHash))) {
      return res.status(403).json({ error: 'Current password is incorrect' });
    }
    const passwordHash = await hashPassword(newPassword);
    const client = await pool.connect();
    let started = false;
    try {
      await client.query('BEGIN');
      started = true;
      const locked = await client.query(
        'SELECT is_active, password_hash FROM technicians WHERE id = $1 FOR UPDATE',
        [req.technician.id]
      );
      if (!locked.rows[0]?.is_active) {
        await client.query('ROLLBACK');
        started = false;
        return res.status(401).json({ error: 'Account is disabled' });
      }
      // The password changed between the check and the lock: the verified one is no longer current.
      if (locked.rows[0].password_hash !== verifiedHash) {
        await client.query('ROLLBACK');
        started = false;
        return res.status(403).json({ error: 'Current password is incorrect' });
      }
      const session = await client.query(
        'SELECT token_hash FROM auth_sessions WHERE token_hash = $1 AND revoked_at IS NULL FOR UPDATE',
        [req.sessionTokenHash]
      );
      if (!session.rowCount) {
        await client.query('ROLLBACK');
        started = false;
        return res.status(401).json({ error: 'Session has been revoked' });
      }
      await client.query(
        'UPDATE technicians SET password_hash = $1, must_change_password = false WHERE id = $2',
        [passwordHash, req.technician.id]
      );
      await client.query(
        'UPDATE auth_sessions SET revoked_at = $1 WHERE technician_id = $2 AND token_hash <> $3 AND revoked_at IS NULL',
        [new Date().toISOString(), req.technician.id, req.sessionTokenHash]
      );
      await client.query('COMMIT');
      started = false;
      res.json({ changed: true });
    } catch (err) {
      if (started) await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

router.post('/logout', authenticate, async (req, res, next) => {
  try {
    await pool.query(
      'UPDATE auth_sessions SET revoked_at = $1 WHERE token_hash = $2 AND revoked_at IS NULL',
      [new Date().toISOString(), req.sessionTokenHash]
    );
    res.set('Set-Cookie', clearSessionCookie());
    res.json({ loggedOut: true });
  } catch (err) {
    next(err);
  }
});

async function bootstrapInitialOwner() {
  const client = await pool.connect();
  let started = false;
  try {
    await client.query('BEGIN');
    started = true;
    await client.query('SELECT pg_advisory_xact_lock($1)', [741992026]);

    const dispatcherAccount = await client.query(
      `SELECT id, role, is_active, password_hash FROM technicians WHERE lower(username) = 'dispatcher' FOR UPDATE`
    );
    if (dispatcherAccount.rows.length) {
      if (dispatcherAccount.rows[0].role === 'owner' && dispatcherAccount.rows[0].password_hash) {
        await client.query('COMMIT');
        started = false;
        return { initialized: false, alreadyInitialized: true };
      }
      throw new Error('Bootstrap username Dispatcher is already assigned to another or incomplete account; manual account reconciliation is required');
    }

    const existingOwners = await client.query(
      `SELECT id, username, password_hash, is_active FROM technicians WHERE role = 'owner' ORDER BY created_at FOR UPDATE`
    );
    if (existingOwners.rows.some(row => row.username || row.password_hash)) {
      throw new Error('A Dispatch Owner account already exists; bootstrap will not overwrite it');
    }
    if (existingOwners.rows.length > 1) {
      throw new Error('Multiple legacy owner identities exist; bootstrap requires manual identity selection');
    }
    if (existingOwners.rows.length === 1 && !existingOwners.rows[0].is_active) {
      throw new Error('The legacy owner identity is inactive; bootstrap requires manual account reconciliation');
    }

    const password = process.env.DISPATCH_BOOTSTRAP_PASSWORD;
    if (!validPassword(password)) {
      throw new Error(`DISPATCH_BOOTSTRAP_PASSWORD is required and must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    const passwordHash = await hashPassword(password);
    if (existingOwners.rows.length === 1) {
      await client.query(
        `UPDATE technicians SET username = 'Dispatcher', password_hash = $1, must_change_password = true WHERE id = $2`,
        [passwordHash, existingOwners.rows[0].id]
      );
    } else {
      await client.query(
        `INSERT INTO technicians (id, name, role, is_active, created_at, username, password_hash, must_change_password)
         VALUES (gen_random_uuid()::text, 'Dispatcher', 'owner', true, $1, 'Dispatcher', $2, true)`,
        [new Date().toISOString(), passwordHash]
      );
    }
    await client.query('COMMIT');
    started = false;
    return { initialized: true };
  } catch (err) {
    if (started) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = router;
module.exports.hashPassword = hashPassword;
module.exports.verifyPassword = verifyPassword;
module.exports.normalizeUsername = normalizeUsername;
module.exports.validPassword = validPassword;
module.exports.publicRole = publicRole;
module.exports.bootstrapInitialOwner = bootstrapInitialOwner;
