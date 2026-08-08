const crypto = require('crypto');
const { pool, truncateTables } = require('./helpers/db');
const { seedTechnicianWithToken, seedCompletedVisit } = require('./helpers/seeds');
const { autoClosePeriods, ensureCurrentPeriodExists } = require('../src/services/autoClose');

beforeEach(truncateTables);
afterAll(() => pool.end());

async function seedPayPeriod(weekStart, weekEnd, status = 'open') {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO pay_periods (id, week_start, week_end, status) VALUES ($1, $2, $3, $4)`,
    [id, weekStart, weekEnd, status]
  );
  return id;
}

// Independent re-implementation of the Monday-of-week math, so the tests
// verify behavior rather than mirror the implementation's internals.
function mondayOf(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

function toDateStr(date) {
  return date.toISOString().slice(0, 10);
}

async function currentMonday() {
  const { rows } = await pool.query('SELECT CURRENT_DATE AS today');
  return mondayOf(new Date(rows[0].today));
}

describe('autoClosePeriods', () => {
  it('closes overdue open periods and expires their open corrections', async () => {
    const { tech } = await seedTechnicianWithToken();
    // week_end more than 3 days in the past — overdue
    const periodId = await seedPayPeriod('2020-01-06', '2020-01-12', 'open');

    const { visitId } = await seedCompletedVisit({ technicianId: tech.id });
    await pool.query(
      `UPDATE visits SET completed_at = '2020-01-08T10:00:00Z', total_price = 200 WHERE id = $1`,
      [visitId]
    );

    const corrId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO corrections (id, visit_id, requested_by, message, status, requested_at)
       VALUES ($1, $2, $3, 'msg', 'open', $4)`,
      [corrId, visitId, tech.id, new Date().toISOString()]
    );

    await autoClosePeriods();

    const period = await pool.query('SELECT status FROM pay_periods WHERE id = $1', [periodId]);
    expect(period.rows[0].status).toBe('closed');

    const line = await pool.query('SELECT * FROM pay_period_lines WHERE period_id = $1 AND technician_id = $2', [periodId, tech.id]);
    expect(line.rows).toHaveLength(1);
    expect(line.rows[0].gross_amount).toBe(200);

    const corr = await pool.query('SELECT status FROM corrections WHERE id = $1', [corrId]);
    expect(corr.rows[0].status).toBe('expired');
  });

  it('does not touch periods that are not yet overdue', async () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const weekEnd = future.toISOString().slice(0, 10);
    const periodId = await seedPayPeriod(weekEnd, weekEnd, 'open');

    await autoClosePeriods();

    const period = await pool.query('SELECT status FROM pay_periods WHERE id = $1', [periodId]);
    expect(period.rows[0].status).toBe('open');
  });
});

describe('ensureCurrentPeriodExists', () => {
  it('creates the current week\'s row when none exists', async () => {
    await ensureCurrentPeriodExists();

    const all = await pool.query('SELECT week_start, week_end, status FROM pay_periods');
    expect(all.rows).toHaveLength(1);

    const monday = await currentMonday();
    expect(all.rows[0].week_start).toBe(toDateStr(monday));
    expect(all.rows[0].week_end).toBe(toDateStr(addDays(monday, 6)));
    expect(all.rows[0].status).toBe('open');
  });

  it('is idempotent — calling it twice in the same week creates no duplicate row', async () => {
    await ensureCurrentPeriodExists();
    await ensureCurrentPeriodExists();

    const all = await pool.query('SELECT * FROM pay_periods');
    expect(all.rows).toHaveLength(1);
  });

  it('backfills every missing week between the last existing row and the current week', async () => {
    const monday = await currentMonday();
    const threeWeeksAgo = addDays(monday, -21);
    await seedPayPeriod(toDateStr(threeWeeksAgo), toDateStr(addDays(threeWeeksAgo, 6)), 'paid');

    await ensureCurrentPeriodExists();

    const all = await pool.query('SELECT week_start, status FROM pay_periods ORDER BY week_start');
    const weekStarts = all.rows.map((r) => r.week_start);
    expect(weekStarts).toEqual([
      toDateStr(threeWeeksAgo),
      toDateStr(addDays(threeWeeksAgo, 7)),
      toDateStr(addDays(threeWeeksAgo, 14)),
      toDateStr(monday),
    ]);
    // Newly backfilled weeks are open; the pre-existing row is untouched.
    expect(all.rows.find((r) => r.week_start === toDateStr(threeWeeksAgo)).status).toBe('paid');
    expect(all.rows.find((r) => r.week_start === toDateStr(addDays(threeWeeksAgo, 7))).status).toBe('open');
    expect(all.rows.find((r) => r.week_start === toDateStr(addDays(threeWeeksAgo, 14))).status).toBe('open');
    expect(all.rows.find((r) => r.week_start === toDateStr(monday)).status).toBe('open');
  });

  it('does not modify any field on an existing row', async () => {
    const monday = await currentMonday();
    const id = await seedPayPeriod(toDateStr(monday), toDateStr(addDays(monday, 6)), 'closed');
    await pool.query('UPDATE pay_periods SET gross_total = 500, paid_at = $1 WHERE id = $2', ['2026-01-01T00:00:00Z', id]);
    const before = (await pool.query('SELECT * FROM pay_periods WHERE id = $1', [id])).rows[0];

    await ensureCurrentPeriodExists();

    const after = (await pool.query('SELECT * FROM pay_periods WHERE id = $1', [id])).rows[0];
    expect(after).toEqual(before);
  });

  it('a backfilled old week gets closed by autoClosePeriods in the same job run', async () => {
    const monday = await currentMonday();
    const threeWeeksAgo = addDays(monday, -21);
    await seedPayPeriod(toDateStr(threeWeeksAgo), toDateStr(addDays(threeWeeksAgo, 6)), 'paid');

    await ensureCurrentPeriodExists();
    await autoClosePeriods();

    const rows = (await pool.query('SELECT week_start, status FROM pay_periods ORDER BY week_start')).rows;
    // The two backfilled weeks strictly before the current week are now overdue and closed.
    expect(rows[1].status).toBe('closed');
    expect(rows[2].status).toBe('closed');
    // The current week is not yet overdue.
    expect(rows[3].week_start).toBe(toDateStr(monday));
    expect(rows[3].status).toBe('open');
  });
});
