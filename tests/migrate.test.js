const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { pool } = require('./helpers/db');
const { migrate } = require('../scripts/migrate');

afterAll(() => pool.end());

const quiet = () => {};
let schema;
let client;
let dir;

function writeMigrations(files) {
  for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), sql);
}

async function tables() {
  const { rows } = await client.query(
    'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name',
    [schema]
  );
  return rows.map(row => row.table_name);
}

async function recorded() {
  const { rows } = await client.query('SELECT filename FROM schema_migrations ORDER BY filename');
  return rows.map(row => row.filename);
}

beforeEach(async () => {
  const database = await pool.query('SELECT current_database() AS name');
  if (database.rows[0]?.name !== 'fieldops_test') {
    throw new Error(`Refusing migration fixture outside fieldops_test (connected to ${database.rows[0]?.name})`);
  }
  schema = `migrate_fixture_${randomUUID().replaceAll('-', '')}`;
  await pool.query(`CREATE SCHEMA ${schema}`);
  client = new Client({
    connectionString: process.env.TEST_DATABASE_URL,
    options: `-c search_path=${schema}`,
  });
  await client.connect();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldops-migrations-'));
  writeMigrations({
    '001_first.sql': 'CREATE TABLE first_table (id int);',
    '002_second.sql': 'CREATE TABLE second_table (id int);',
  });
});

afterEach(async () => {
  await client.end();
  await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('refuses to run without a ledger unless baselining', async () => {
  await expect(migrate(client, { dir, log: quiet })).rejects.toThrow('schema_migrations is missing');
  expect(await tables()).toEqual([]);
});

test('baseline records every file without running it', async () => {
  await migrate(client, { dir, baseline: true, log: quiet });
  expect(await recorded()).toEqual(['001_first.sql', '002_second.sql']);
  expect(await tables()).toEqual(['schema_migrations']);
});

test('applies pending files in order, once', async () => {
  await client.query('CREATE TABLE schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  await client.query("INSERT INTO schema_migrations (filename) VALUES ('001_first.sql')");
  writeMigrations({ '003_third.sql': 'ALTER TABLE second_table ADD COLUMN name text;' });

  expect(await migrate(client, { dir, log: quiet })).toEqual(['002_second.sql', '003_third.sql']);
  expect(await tables()).toEqual(['schema_migrations', 'second_table']);
  expect(await migrate(client, { dir, log: quiet })).toEqual([]);
  expect(await recorded()).toEqual(['001_first.sql', '002_second.sql', '003_third.sql']);
});

test('a failing file is rolled back and not recorded', async () => {
  await migrate(client, { dir, baseline: true, log: quiet });
  writeMigrations({ '003_bad.sql': 'CREATE TABLE third_table (id int); SELECT missing_column FROM third_table;' });

  await expect(migrate(client, { dir, log: quiet })).rejects.toThrow('003_bad.sql');
  expect(await tables()).toEqual(['schema_migrations']);
  expect(await recorded()).toEqual(['001_first.sql', '002_second.sql']);
});
