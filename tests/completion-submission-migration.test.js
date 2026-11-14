const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { pool } = require('./helpers/db');

afterAll(() => pool.end());

async function createMigrationFixture() {
  const database = await pool.query('SELECT current_database() AS name');
  if (database.rows[0]?.name !== 'fieldops_test') {
    throw new Error(`Refusing migration fixture outside fieldops_test (connected to ${database.rows[0]?.name})`);
  }
  const schema = `migration_fixture_${randomUUID().replaceAll('-', '')}`;
  await pool.query(`CREATE SCHEMA ${schema}`);
  await pool.query(`CREATE TABLE ${schema}.completion_submissions (
    submission_id text PRIMARY KEY,
    visit_id text NOT NULL
  )`);
  await pool.query(`CREATE INDEX completion_submissions_visit_id_idx ON ${schema}.completion_submissions(visit_id)`);
  return schema;
}

function runConfiguredMigration(schema) {
  const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Migration test requires TEST_DATABASE_URL or DATABASE_URL');
  return spawnSync('npm', ['run', 'db:migrate025'], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PGOPTIONS: `-c search_path=${schema}`,
    },
  });
}

async function indexNames(schema) {
  const result = await pool.query(
    'SELECT indexname FROM pg_indexes WHERE schemaname = $1 ORDER BY indexname',
    [schema]
  );
  return result.rows.map(row => row.indexname);
}

describe('completion submission uniqueness migration', () => {
  it('runs the configured migration command and creates the unique Visit index when preflight is clear', async () => {
    const schema = await createMigrationFixture();
    try {
      await pool.query(`INSERT INTO ${schema}.completion_submissions VALUES ('one-submission', 'one-visit')`);

      const result = runConfiguredMigration(schema);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      const indexes = await indexNames(schema);
      expect(indexes).toContain('completion_submissions_visit_id_unique_idx');
      expect(indexes).not.toContain('completion_submissions_visit_id_idx');
    } finally {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    }
  });

  it('stops the configured migration command on duplicate preflight and preserves rows and indexes', async () => {
    const schema = await createMigrationFixture();
    try {
      await pool.query(
        `INSERT INTO ${schema}.completion_submissions (submission_id, visit_id)
         VALUES ('duplicate-a', 'visit-duplicate'), ('duplicate-b', 'visit-duplicate')`
      );

      const result = runConfiguredMigration(schema);

      expect(result.error).toBeUndefined();
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/visit-duplicate \(2 rows\)/);
      const rows = await pool.query(
        `SELECT submission_id, visit_id FROM ${schema}.completion_submissions ORDER BY submission_id`
      );
      expect(rows.rows).toEqual([
        { submission_id: 'duplicate-a', visit_id: 'visit-duplicate' },
        { submission_id: 'duplicate-b', visit_id: 'visit-duplicate' },
      ]);
      const indexes = await indexNames(schema);
      expect(indexes).toContain('completion_submissions_visit_id_idx');
      expect(indexes).not.toContain('completion_submissions_visit_id_unique_idx');
    } finally {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    }
  });
});
