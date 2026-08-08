const crypto = require('crypto');
const { pool } = require('../db/pool');
const { computeCommission } = require('../helpers/commission');

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

module.exports = { autoClosePeriods };
