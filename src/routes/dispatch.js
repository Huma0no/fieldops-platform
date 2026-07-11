const express = require('express');
const multer = require('multer');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const { extractCallsFromPDF } = require('../services/ai');
const { findOrCreateAddress } = require('../helpers/address');
const { createVisitWithSystems } = require('../helpers/visit');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// In-memory cache: batchId → calls array (from AI extraction)
const batchCallsCache = new Map();

// POST /api/dispatch/parse-pdf
router.post('/parse-pdf', requireRole('owner', 'dispatcher'), upload.single('pdf'), async (req, res, next) => {
  try {
    // Displacement cleanup: delete previously released batches
    await pool.query("DELETE FROM pdf_batches WHERE status = 'released'");

    if (!req.file) {
      return res.status(400).json({ error: 'pdf file is required' });
    }

    const calls = await extractCallsFromPDF(req.file.buffer);
    const now = new Date().toISOString();

    const batchResult = await pool.query(
      `INSERT INTO pdf_batches (id, total_calls, skipped_count, status, created_at)
       VALUES (gen_random_uuid()::text, $1, 0, 'in_review', $2)
       RETURNING id`,
      [calls.length, now]
    );
    const batchId = batchResult.rows[0].id;

    batchCallsCache.set(batchId, calls);

    res.json({
      batchId,
      totalCalls: calls.length,
      calls: calls.map((call, i) => ({ index: i + 1, ...call })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/dispatch/batch/:batchId/call/:index
router.get('/batch/:batchId/call/:index', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { batchId, index } = req.params;
    const idx = parseInt(index, 10);

    const batchResult = await pool.query(
      "SELECT * FROM pdf_batches WHERE id = $1 AND status = 'in_review'",
      [batchId]
    );
    if (batchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Batch not found or not in review' });
    }

    const calls = batchCallsCache.get(batchId);
    if (!calls) {
      return res.status(404).json({ error: 'Batch call data not in memory' });
    }
    if (idx < 1 || idx > calls.length) {
      return res.status(404).json({ error: `Call index out of range (1–${calls.length})` });
    }

    res.json({
      index: idx,
      totalCalls: calls.length,
      call: calls[idx - 1],
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/dispatch/batch/:batchId/call/:index/confirm
router.post('/batch/:batchId/call/:index/confirm', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { batchId } = req.params;

    const batchResult = await pool.query(
      "SELECT * FROM pdf_batches WHERE id = $1 AND status = 'in_review'",
      [batchId]
    );
    if (batchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Batch not found or not in review' });
    }

    const { orderNumber, address, city, state, zip, subdivision, builder, scheduledTime, workType, systemCount, notes } = req.body;

    const { address: foundAddress, nearMatch } = await findOrCreateAddress(pool, {
      street: address,
      city,
      state,
      zip,
      subdivision,
      builder,
    });

    if (nearMatch) {
      return res.json({
        comparisonRequired: true,
        incomingData: req.body,
        existingAddress: nearMatch,
      });
    }

    const { visitId } = await createVisitWithSystems(pool, {
      addressId: foundAddress.id,
      batchId,
      orderNumber,
      scheduledTime,
      workType,
      systemCount,
      notes,
    });

    res.json({ created: true, visitId });
  } catch (err) {
    next(err);
  }
});

// POST /api/dispatch/batch/:batchId/call/:index/skip
router.post('/batch/:batchId/call/:index/skip', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { batchId } = req.params;

    const result = await pool.query(
      "UPDATE pdf_batches SET skipped_count = skipped_count + 1 WHERE id = $1 AND status = 'in_review' RETURNING skipped_count",
      [batchId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Batch not found or not in review' });
    }

    res.json({ skipped: true, skippedCount: result.rows[0].skipped_count });
  } catch (err) {
    next(err);
  }
});

// POST /api/dispatch/batch/:batchId/release-to-lobby
router.post('/batch/:batchId/release-to-lobby', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { batchId } = req.params;

    const batchResult = await pool.query(
      "SELECT * FROM pdf_batches WHERE id = $1 AND status = 'in_review'",
      [batchId]
    );
    if (batchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Batch not found or not in review' });
    }
    const batch = batchResult.rows[0];

    const countResult = await pool.query(
      "SELECT COUNT(*) FROM visits WHERE batch_id = $1 AND status = 'pending_review'",
      [batchId]
    );
    const actual = parseInt(countResult.rows[0].count, 10);
    const expected = batch.total_calls - batch.skipped_count;

    if (actual !== expected) {
      return res.json({ mismatch: true, expected, actual });
    }

    const now = new Date().toISOString();
    const today = new Date().toISOString().slice(0, 10);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const releaseResult = await client.query(
        `UPDATE visits SET status = 'in_lobby', updated_at = $1
         WHERE batch_id = $2 AND status = 'pending_review'
         RETURNING id`,
        [now, batchId]
      );

      await client.query(
        "UPDATE pdf_batches SET status = 'released' WHERE id = $1",
        [batchId]
      );

      // Mark all assigned visits from previous days as deferred
      await client.query(
        `UPDATE visits SET is_deferred = true, updated_at = $1
         WHERE status = 'assigned'
           AND LEFT(created_at, 10) < $2
           AND is_deferred = false`,
        [now, today]
      );

      await client.query('COMMIT');

      const visitIds = releaseResult.rows.map((r) => r.id);
      res.json({ releasedCount: visitIds.length, visitIds });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

// POST /api/dispatch/visits/create-manual
router.post('/visits/create-manual', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const {
      batchId: existingBatchId,
      orderNumber, address, city, state, zip, subdivision, builder,
      scheduledTime, workType, notes, systems, isPriority,
    } = req.body;

    const { address: foundAddress, nearMatch } = await findOrCreateAddress(pool, {
      street: address, city, state, zip, subdivision, builder,
    });

    if (nearMatch) {
      // Create the batch now if this is the first call, so batchId is in the response
      let batchId = existingBatchId || null;
      if (!batchId) {
        const batchResult = await pool.query(
          `INSERT INTO pdf_batches (id, total_calls, skipped_count, status, created_at)
           VALUES (gen_random_uuid()::text, 0, 0, 'in_review', $1) RETURNING id`,
          [new Date().toISOString()]
        );
        batchId = batchResult.rows[0].id;
      }
      return res.json({
        comparisonRequired: true,
        batchId,
        incomingData: req.body,
        existingAddress: nearMatch,
      });
    }

    let batchId = existingBatchId || null;
    if (!batchId) {
      const batchResult = await pool.query(
        `INSERT INTO pdf_batches (id, total_calls, skipped_count, status, created_at)
         VALUES (gen_random_uuid()::text, 0, 0, 'in_review', $1) RETURNING id`,
        [new Date().toISOString()]
      );
      batchId = batchResult.rows[0].id;
    }

    const { visitId } = await createVisitWithSystems(pool, {
      addressId: foundAddress.id,
      batchId,
      orderNumber,
      scheduledTime,
      workType,
      notes,
      systems,
      isPriority,
    });

    await pool.query('UPDATE pdf_batches SET total_calls = total_calls + 1 WHERE id = $1', [batchId]);

    res.json({ visitId, batchId });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/dispatch/batch/:batchId/visits/:visitId
router.delete('/batch/:batchId/visits/:visitId', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { batchId, visitId } = req.params;
    const result = await pool.query(
      `UPDATE visits SET status = 'cancelled'
       WHERE id = $1 AND batch_id = $2 AND status = 'pending_review'
       RETURNING id`,
      [visitId, batchId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Call not found or already processed' });
    }
    await pool.query('UPDATE pdf_batches SET skipped_count = skipped_count + 1 WHERE id = $1', [batchId]);
    res.json({ visitId });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/dispatch/batch/:batchId
router.delete('/batch/:batchId', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { batchId } = req.params;
    await pool.query(
      `UPDATE visits SET status = 'cancelled' WHERE batch_id = $1 AND status = 'pending_review'`,
      [batchId]
    );
    await pool.query(
      `UPDATE pdf_batches SET status = 'released' WHERE id = $1 AND status = 'in_review'`,
      [batchId]
    );
    res.json({ batchId });
  } catch (err) {
    next(err);
  }
});

// GET /api/dispatch/lobby
router.get('/lobby', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT
        v.id,
        v.work_type,
        v.is_priority,
        v.has_multiple_systems,
        a.street,
        a.subdivision,
        a.builder,
        BOOL_OR(ce.is_a2l) AS has_a2l
      FROM visits v
      JOIN addresses a ON a.id = v.address_id
      LEFT JOIN visit_systems vs ON vs.visit_id = v.id
      LEFT JOIN catalog_equipment ce ON ce.model IN (vs.indoor_model, vs.outdoor_model)
      WHERE v.status = 'in_lobby'
      GROUP BY v.id, v.work_type, v.is_priority, v.has_multiple_systems,
               a.street, a.subdivision, a.builder
      ORDER BY a.subdivision NULLS LAST, a.street
    `);

    res.json(result.rows.map(r => ({
      id: r.id,
      workType: r.work_type,
      isPriority: r.is_priority,
      hasMultipleSystems: r.has_multiple_systems,
      address: { street: r.street, subdivision: r.subdivision, builder: r.builder },
      tags: [
        r.is_priority && 'priority',
        r.has_multiple_systems && 'multiSystem',
        r.has_a2l && 'a2l',
      ].filter(Boolean),
    })));
  } catch (err) {
    next(err);
  }
});

// GET /api/dispatch/visits/unassigned/count
router.get('/visits/unassigned/count', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const result = await pool.query("SELECT COUNT(*) FROM visits WHERE status = 'in_lobby'");
    res.json({ count: parseInt(result.rows[0].count, 10) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
