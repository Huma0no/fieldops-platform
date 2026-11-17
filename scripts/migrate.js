// Applies pending SQL migrations from src/db/migrations in filename order.
// Each file runs in its own transaction and is recorded in schema_migrations,
// so a file never runs twice. Migration files must not contain BEGIN/COMMIT.
// Usage: npm run db:migrate                  (DATABASE_URL: apply pending files)
//        npm run db:migrate -- --baseline    (record every file as applied without
//                                             running it: once, on a database built
//                                             from schema.sql or migrated by hand)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');

function migrationFiles(dir) {
  return fs.readdirSync(dir).filter(file => /^\d+_.+\.sql$/.test(file)).sort();
}

async function migrate(client, { dir = MIGRATIONS_DIR, baseline = false, log = console.log } = {}) {
  const ledger = await client.query("SELECT to_regclass('schema_migrations') AS t");
  if (!ledger.rows[0].t && !baseline) {
    throw new Error('schema_migrations is missing: use npm run db:setup for a new database, '
      + 'or npm run db:migrate -- --baseline once for an existing one');
  }
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const { rows } = await client.query('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map(row => row.filename));
  const pending = migrationFiles(dir).filter(file => !applied.has(file));

  for (const file of pending) {
    if (baseline) {
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      continue;
    }
    await client.query('BEGIN');
    try {
      await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`${file}: ${err.message}`);
    }
    log(`applied ${file}`);
  }
  if (baseline) log(`recorded ${pending.length} migration(s) as applied`);
  else if (pending.length === 0) log('no pending migrations');
  return pending;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (copy .env.example to .env)');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await migrate(client, { baseline: process.argv.includes('--baseline') });
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}

module.exports = { migrate, migrationFiles };
