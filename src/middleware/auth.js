const crypto = require('crypto');
const { pool } = require('../db/pool');

// Sessions expire after 30 days without use (sliding). last_used_at is refreshed
// at most once per hour so ordinary requests do not each write to the database.
const SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_TOUCH_MS = 60 * 60 * 1000;

function readCookie(req, name) {
  const cookieHeader = req.headers.cookie ?? '';
  for (const part of cookieHeader.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

function isUnsafeMethod(method) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

async function authenticate(req, res, next) {
  const cookieToken = readCookie(req, 'fieldops_session');
  const authorization = req.headers.authorization;
  const bearerToken = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
  const token = cookieToken || bearerToken;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  if (cookieToken && isUnsafeMethod(req.method) && req.headers['x-fieldops-request'] !== '1') {
    return res.status(403).json({ error: 'CSRF validation failed' });
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  try {
    const now = Date.now();
    const result = await pool.query(
      `SELECT t.id, t.name, t.username, t.role, t.must_change_password,
              COALESCE(s.last_used_at, s.created_at) AS last_used_at
       FROM auth_sessions s
       JOIN technicians t ON t.id = s.technician_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND t.is_active = true
         AND COALESCE(s.last_used_at, s.created_at) > $2`,
      [tokenHash, new Date(now - SESSION_IDLE_MS).toISOString()]
    );
    if (!result.rows.length) return res.status(401).json({ error: 'Invalid, expired or revoked session' });

    const row = result.rows[0];
    if (row.last_used_at < new Date(now - SESSION_TOUCH_MS).toISOString()) {
      await pool.query('UPDATE auth_sessions SET last_used_at = $1 WHERE token_hash = $2', [new Date(now).toISOString(), tokenHash]);
    }
    req.technician = {
      id: row.id,
      name: row.name,
      username: row.username,
      role: row.role,
      mustChangePassword: row.must_change_password,
    };
    req.sessionTokenHash = tokenHash;
    next();
  } catch (err) {
    next(err);
  }
}

function requireRole(...roles) {
  const normalized = roles.map(role => String(role).toLowerCase());
  return function (req, res, next) {
    if (!req.technician) return res.status(401).json({ error: 'Not authenticated' });
    if (!normalized.includes(req.technician.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

function requirePasswordChanged(req, res, next) {
  if (req.technician?.mustChangePassword && !req.path.startsWith('/api/auth')) {
    return res.status(403).json({ error: 'Password change required', code: 'PASSWORD_CHANGE_REQUIRED' });
  }
  next();
}

module.exports = { authenticate, requireRole, requirePasswordChanged, readCookie };
