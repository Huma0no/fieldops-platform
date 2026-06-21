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
      batchId: null,
      orderNumber,
      scheduledTime,
      workType,
      systemCount,
      notes,
    });

    res.json({ visitId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
