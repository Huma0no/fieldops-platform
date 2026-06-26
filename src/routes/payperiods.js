const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

function periodShape(row) {
  return {
    id: row.id,
    weekStart: row.week_start,
    weekEnd: row.week_end,
    status: row.status,
    paidAt: row.paid_at,
    createdAt: row.created_at,
  };
}

function lineShape(row) {
  return {
    technicianId: row.technician_id,
    technicianName: row.technician_name,
    grossAmount: row.gross_amount,
    commissionRetained: row.commission_retained,
    netAmount: row.net_amount,
  };
}

async function fetchPeriodWithLines(periodId) {
  const pResult = await pool.query('SELECT * FROM pay_periods WHERE id = $1', [periodId]);
  if (pResult.rows.length === 0) return null;
  const period = pResult.rows[0];

  const lResult = await pool.query(
    `SELECT ppl.*, t.name AS technician_name
     FROM pay_period_lines ppl
     JOIN technicians t ON t.id = ppl.technician_id
     WHERE ppl.period_id = $1`,
    [periodId]
  );

  return { ...periodShape(period), lines: lResult.rows.map(lineShape) };
}

// GET /api/dispatch/pay-periods
router.get('/pay-periods', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM pay_periods ORDER BY week_start DESC'
    );
    res.json(result.rows.map(periodShape));
  } catch (err) {
    next(err);
  }
});

// GET /api/dispatch/pay-periods/:id
router.get('/pay-periods/:id', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const data = await fetchPeriodWithLines(req.params.id);
    if (!data) return res.status(404).json({ error: 'Pay period not found' });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// POST /api/dispatch/pay-periods/close
router.post('/pay-periods/close', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { periodId } = req.body;

    const pResult = await pool.query('SELECT * FROM pay_periods WHERE id = $1', [periodId]);
    if (pResult.rows.length === 0) return res.status(404).json({ error: 'Pay period not found' });
    const period = pResult.rows[0];

    if (period.status !== 'open') {
      return res.status(400).json({ error: 'Pay period is not open' });
    }

    // Sum total_price per technician for completed/temporarily visits within the window
    const visitsResult = await pool.query(
      `SELECT v.technician_id, SUM(v.total_price) AS gross_amount
       FROM visits v
       WHERE v.status IN ('completed', 'temporarily')
         AND v.completed_at >= $1
         AND v.completed_at <= $2
         AND v.technician_id IS NOT NULL
       GROUP BY v.technician_id`,
      [period.week_start, period.week_end]
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const row of visitsResult.rows) {
        const techResult = await client.query(
          'SELECT role FROM technicians WHERE id = $1',
          [row.technician_id]
        );
        const techRole = techResult.rows[0]?.role;
        const gross = parseFloat(row.gross_amount);
        const commission = techRole === 'owner' ? 0 : gross * 0.20;
        const net = gross - commission;

        await client.query(
          `INSERT INTO pay_period_lines
             (id, period_id, technician_id, gross_amount, commission_retained, net_amount)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (period_id, technician_id)
           DO UPDATE SET gross_amount = $4, commission_retained = $5, net_amount = $6`,
          [crypto.randomUUID(), periodId, row.technician_id, gross, commission, net]
        );
      }

      await client.query(
        `UPDATE pay_periods SET status = 'closed' WHERE id = $1`,
        [periodId]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const data = await fetchPeriodWithLines(periodId);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/dispatch/pay-periods/:id/mark-paid
router.patch('/pay-periods/:id/mark-paid', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const pResult = await pool.query('SELECT * FROM pay_periods WHERE id = $1', [id]);
    if (pResult.rows.length === 0) return res.status(404).json({ error: 'Pay period not found' });
    const period = pResult.rows[0];

    if (period.status !== 'closed') {
      return res.status(400).json({ error: 'Pay period must be closed before marking paid' });
    }

    const now = new Date().toISOString();
    await pool.query(
      `UPDATE pay_periods SET status = 'paid', paid_at = $1 WHERE id = $2`,
      [now, id]
    );

    res.json({ id, status: 'paid', paidAt: now });
  } catch (err) {
    next(err);
  }
});

// GET /api/pay/mine
router.get('/pay/mine', requireRole('technician'), async (req, res, next) => {
  try {
    const techId = req.technician.id;
    const { periodId } = req.query;

    let query, params;

    if (periodId) {
      query = `
        SELECT ppl.period_id, pp.week_start, pp.week_end,
               ppl.gross_amount, ppl.commission_retained, ppl.net_amount
        FROM pay_period_lines ppl
        JOIN pay_periods pp ON pp.id = ppl.period_id
        WHERE ppl.technician_id = $1 AND ppl.period_id = $2`;
      params = [techId, periodId];
    } else {
      query = `
        SELECT ppl.period_id, pp.week_start, pp.week_end,
               ppl.gross_amount, ppl.commission_retained, ppl.net_amount
        FROM pay_period_lines ppl
        JOIN pay_periods pp ON pp.id = ppl.period_id
        WHERE ppl.technician_id = $1
        ORDER BY pp.week_start DESC`;
      params = [techId];
    }

    const result = await pool.query(query, params);
    res.json(result.rows.map((r) => ({
      periodId: r.period_id,
      weekStart: r.week_start,
      weekEnd: r.week_end,
      grossAmount: r.gross_amount,
      commissionRetained: r.commission_retained,
      netAmount: r.net_amount,
    })));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
