const crypto = require('crypto');
const { pool } = require('../db/pool');
const { computeCommission } = require('../helpers/commission');

function mondayOf(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sunday ... 6 = Saturday
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

// Ensures a pay_periods row exists for the current Mon-Sun week, and backfills
// any week missed since the last row (e.g. the server was down across a Monday).
// Never touches existing rows — only inserts missing weeks, oldest first.
async function ensureCurrentPeriodExists() {
  const { rows } = await pool.query('SELECT CURRENT_DATE AS today');
  const currentMonday = mondayOf(new Date(rows[0].today));

  const lastResult = await pool.query('SELECT MAX(week_start) AS last_week_start FROM pay_periods');
  const lastWeekStart = lastResult.rows[0].last_week_start;

  let cursor = lastWeekStart ? addDays(new Date(lastWeekStart), 7) : currentMonday;

  while (cursor <= currentMonday) {
    const weekStart = toDateStr(cursor);
    const weekEnd = toDateStr(addDays(cursor, 6));
    await pool.query(
      `INSERT INTO pay_periods (id, week_start, week_end, status)
       VALUES ($1, $2, $3, 'open')
       ON CONFLICT (week_start) DO NOTHING`,
      [crypto.randomUUID(), weekStart, weekEnd]
    );
    cursor = addDays(cursor, 7);
  }
}

async function autoClosePeriods() {
  const overdue = await pool.query(
    `SELECT * FROM pay_periods
     WHERE status = 'open' AND week_end::date < CURRENT_DATE - INTERVAL '3 days'`
  );
  if (overdue.rows.length === 0) return;

  for (const period of overdue.rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const visitsResult = await client.query(
        `SELECT v.technician_id, SUM(v.total_price) AS gross_amount
         FROM visits v
         WHERE v.status IN ('completed', 'temporarily')
           AND v.completed_at >= $1 AND v.completed_at <= $2
           AND v.technician_id IS NOT NULL
         GROUP BY v.technician_id`,
        [period.week_start, period.week_end]
      );

      for (const row of visitsResult.rows) {
        const techResult = await client.query(
          'SELECT role, commission_rate FROM technicians WHERE id = $1', [row.technician_id]
        );
        const gross = parseFloat(row.gross_amount);
        const { rateApplied, commissionRetained, netAmount } = computeCommission(
          gross, techResult.rows[0]?.role, techResult.rows[0]?.commission_rate
        );
        await client.query(
          `INSERT INTO pay_period_lines
             (id, period_id, technician_id, gross_amount, commission_rate_applied, commission_retained, net_amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (period_id, technician_id)
           DO UPDATE SET gross_amount = $4, commission_rate_applied = $5, commission_retained = $6, net_amount = $7`,
          [crypto.randomUUID(), period.id, row.technician_id, gross, rateApplied, commissionRetained, netAmount]
        );
      }

      await client.query(`UPDATE pay_periods SET status = 'closed' WHERE id = $1`, [period.id]);

      await client.query(
        `UPDATE corrections SET status = 'expired'
         WHERE status = 'open' AND visit_id IN (
           SELECT id FROM visits WHERE completed_at >= $1 AND completed_at <= $2
         )`,
        [period.week_start, period.week_end]
      );

      await client.query('COMMIT');
      console.log(`Auto-closed pay period ${period.id} (${period.week_start} – ${period.week_end})`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`Auto-close failed for period ${period.id}:`, err.message);
    } finally {
      client.release();
    }
  }
}

module.exports = { autoClosePeriods, ensureCurrentPeriodExists };
