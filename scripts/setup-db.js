// Builds a FieldOps database from scratch: schema.sql + canonical catalog seed,
// then records every migration as applied (schema.sql already contains them).
// Usage: npm run db:setup        (DATABASE_URL: schema + catalog seed)
//        npm run db:setup:test   (TEST_DATABASE_URL: schema only; tests seed their own data)
// Refuses to run against a database that already holds visits, because
// schema.sql drops and recreates every table.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { migrate } = require('./migrate');

async function main() {
  const isTest = process.argv.includes('--test');
  const url = isTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error(`${isTest ? 'TEST_DATABASE_URL' : 'DATABASE_URL'} is not set (copy .env.example to .env)`);
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const existing = await client.query("SELECT to_regclass('public.visits') AS t");
    if (existing.rows[0].t) {
      const { rows } = await client.query('SELECT COUNT(*)::int AS n FROM visits');
      if (rows[0].n > 0) throw new Error(`Refusing to reset: database already has ${rows[0].n} visits`);
    }
    const files = isTest ? ['src/db/schema.sql'] : ['src/db/schema.sql', 'scripts/seed-catalog.sql'];
    for (const file of files) {
      await client.query(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
      console.log(`applied ${file}`);
    }
    // schema.sql already contains every migration; record them so db:migrate skips them.
    await migrate(client, { baseline: true });
    console.log(isTest ? 'Test database ready.' : 'Database ready. Start the server to create the Dispatcher account.');
  } finally {
    await client.end();
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
