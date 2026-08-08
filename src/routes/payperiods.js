const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const { computeCommission } = require('../helpers/commission');

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

  const [lResult, adjResult, tgResult] = await Promise.all([
    pool.query(
      `SELECT ppl.*, t.name AS technician_name
       FROM pay_period_lines ppl
       JOIN technicians t ON t.id = ppl.technician_id
       WHERE ppl.period_id = $1`,
      [periodId]
    ),
    pool.query(
      'SELECT * FROM pay_period_adjustments WHERE pay_period_id = $1 ORDER BY created_at',
      [periodId]
    ),
    pool.query(
      `SELECT COALESCE(SUM(v.total_price), 0) AS total_generated
       FROM visits v
       WHERE v.status IN ('completed', 'temporarily')
         AND v.completed_at >= $1 AND v.completed_at <= $2`,
      [period.week_start, period.week_end]
    ),
  ]);

  const adjByTech = {};
  for (const a of adjResult.rows) {
    if (!adjByTech[a.technician_id]) adjByTech[a.technician_id] = [];
    adjByTech[a.technician_id].push({ id: a.id, amount: Number(a.amount), note: a.note, createdAt: a.created_at });
  }

  const lines = lResult.rows.map(row => {
    const adjs = adjByTech[row.technician_id] ?? [];
    const adjustmentSum = adjs.reduce((s, a) => s + a.amount, 0);
    return {
      technicianId:         row.technician_id,
      technicianName:       row.technician_name,
      grossAmount:          row.gross_amount,
      commissionRateApplied: row.commission_rate_applied,
      commissionRetained:   row.commission_retained,
      netAmount:            row.net_amount + adjustmentSum,
      adjustments:          adjs,
    };
  });

  return {
    ...periodShape(period),
    ghostDeduction: period.ghost_deduction != null ? Number(period.ghost_deduction) : null,
    totalGenerated: Number(tgResult.rows[0].total_generated),
    lines,
  };
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
          'SELECT role, commission_rate FROM technicians WHERE id = $1',
          [row.technician_id]
        );
        const techRole = techResult.rows[0]?.role;
        const commissionRate = techResult.rows[0]?.commission_rate;
        const gross = parseFloat(row.gross_amount);
        const { rateApplied, commissionRetained, netAmount } = computeCommission(gross, techRole, commissionRate);

        await client.query(
          `INSERT INTO pay_period_lines
             (id, period_id, technician_id, gross_amount, commission_rate_applied, commission_retained, net_amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (period_id, technician_id)
           DO UPDATE SET gross_amount = $4, commission_rate_applied = $5, commission_retained = $6, net_amount = $7`,
          [crypto.randomUUID(), periodId, row.technician_id, gross, rateApplied, commissionRetained, netAmount]
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

// POST /api/dispatch/pay-periods/:id/adjustments
router.post('/pay-periods/:id/adjustments', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  const { id } = req.params;
  const { technicianId, amount, note } = req.body;
  if (!technicianId || amount == null) {
    return res.status(400).json({ error: 'technicianId and amount are required' });
  }
  try {
    const pResult = await pool.query('SELECT status FROM pay_periods WHERE id = $1', [id]);
    if (pResult.rows.length === 0) return res.status(404).json({ error: 'Pay period not found' });
    if (pResult.rows[0].status !== 'open') {
      return res.status(400).json({ error: 'Adjustments can only be added to open pay periods' });
    }
    const now = new Date().toISOString();
    await pool.query(
      `INSERT INTO pay_period_adjustments (id, pay_period_id, technician_id, amount, note, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [crypto.randomUUID(), id, technicianId, amount, note ?? null, now]
    );
    const data = await fetchPeriodWithLines(id);
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
});

// POST /api/dispatch/pay-periods/:id/ghost-deduction
router.post('/pay-periods/:id/ghost-deduction', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  const { id } = req.params;
  const { amount } = req.body;
  if (amount == null) return res.status(400).json({ error: 'amount is required' });
  try {
    const pResult = await pool.query('SELECT status FROM pay_periods WHERE id = $1', [id]);
    if (pResult.rows.length === 0) return res.status(404).json({ error: 'Pay period not found' });
    if (pResult.rows[0].status !== 'closed') {
      return res.status(400).json({ error: 'Ghost deduction can only be set on closed pay periods' });
    }
    await pool.query('UPDATE pay_periods SET ghost_deduction = $1 WHERE id = $2', [amount, id]);
    const data = await fetchPeriodWithLines(id);
    res.json(data);
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
               ppl.gross_amount, ppl.commission_rate_applied, ppl.commission_retained, ppl.net_amount
        FROM pay_period_lines ppl
        JOIN pay_periods pp ON pp.id = ppl.period_id
        WHERE ppl.technician_id = $1 AND ppl.period_id = $2`;
      params = [techId, periodId];
    } else {
      query = `
        SELECT ppl.period_id, pp.week_start, pp.week_end,
               ppl.gross_amount, ppl.commission_rate_applied, ppl.commission_retained, ppl.net_amount
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
      commissionRateApplied: r.commission_rate_applied,
      commissionRetained: r.commission_retained,
      netAmount: r.net_amount,
    })));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
