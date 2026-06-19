const { pool } = require('../db/pool');

async function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = authHeader.slice(7); // text after 'Bearer '

  try {
    const result = await pool.query(
      `SELECT t.id, t.name, t.role
       FROM device_tokens dt
       JOIN technicians t ON t.id = dt.technician_id
       WHERE dt.token = $1 AND t.is_active = true`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const { id, name, role } = result.rows[0];
    req.technician = { id, name, role };
    next();
  } catch (err) {
    next(err);
  }
}

function requireRole(...roles) {
  return function (req, res, next) {
    if (!req.technician) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!roles.includes(req.technician.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}

module.exports = { authenticate, requireRole };
