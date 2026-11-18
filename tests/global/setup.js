// One test run at a time against the test database (QA-TRACKER CC-11): a
// second concurrent run would truncate and seed the same tables mid-test.
// The lock is held by one connection for the whole run and released in
// teardown (or by Postgres when this process exits).
const { Client } = require('pg');
require('dotenv').config({ path: '.env.test' });

const TEST_RUN_LOCK = 4_271_964_301;

module.exports = async () => {
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [TEST_RUN_LOCK]);
  if (!rows[0].locked) {
    await client.end();
    throw new Error('Another test run is using the test database (advisory lock held). Wait for it to finish or stop it.');
  }
  globalThis.__testRunLockClient = client;
};
