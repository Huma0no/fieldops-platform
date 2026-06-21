const { pool: defaultPool } = require('../db/pool');

function normalizeStreet(street) {
  return street.trim().toUpperCase();
}

async function findNearMatch(pool, normalizedStreet, zip) {
  const result = await pool.query(
    `SELECT * FROM addresses
     WHERE LEFT(street, 6) = LEFT($1, 6)
       AND zip = $2
       AND street != $1
     LIMIT 1`,
    [normalizedStreet, zip || '']
  );
  return result.rows[0] || null;
}

async function findOrCreateAddress(pool, { street, city, state, zip, subdivision, builder }) {
  const normalized = normalizeStreet(street);

  // 1. Exact match
  const exact = await pool.query('SELECT * FROM addresses WHERE street = $1', [normalized]);
  if (exact.rows.length > 0) {
    return { address: exact.rows[0], nearMatch: null };
  }

  // 2. Near match
  const near = await findNearMatch(pool, normalized, zip);
  if (near) {
    return { address: null, nearMatch: near };
  }

  // 3. Insert (ON CONFLICT in case of race — returns existing row)
  const insertResult = await pool.query(
    `INSERT INTO addresses (id, street, city, state, zip, subdivision, builder)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6)
     ON CONFLICT (street) DO NOTHING
     RETURNING *`,
    [normalized, city || null, state || null, zip || null, subdivision || null, builder || null]
  );

  if (insertResult.rows.length > 0) {
    return { address: insertResult.rows[0], nearMatch: null };
  }

  // Race-condition fallback: another process inserted the same street
  const fallback = await pool.query('SELECT * FROM addresses WHERE street = $1', [normalized]);
  return { address: fallback.rows[0], nearMatch: null };
}

module.exports = { normalizeStreet, findNearMatch, findOrCreateAddress };
