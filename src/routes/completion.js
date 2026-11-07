const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const { createNotification } = require('../helpers/notify');
const { generateReportText, generateReportJSON } = require('../services/report');
const {
  calculateVisitPrice,
  resolveCompanionCascade,
  resolveServicePrice,
  resolveWeightInDataPrice,
} = require('../services/pricing');

const router = express.Router();

const TERMINAL_STATUSES = ['completed', 'temporarily', 'cancelled'];
const MAX_SUBMISSION_ID_LENGTH = 120;

async function applySnapshotWork(client, visit, snapshot) {
  const service = snapshot.service ?? {};
  const serviceName = service.serviceName;
  if (!serviceName) throw Object.assign(new Error('No service selected'), { status: 400 });

  const serviceCatalog = await client.query(
    'SELECT default_price FROM catalog_services WHERE service_name = $1', [serviceName]
  );
  if (!serviceCatalog.rows.length) throw Object.assign(new Error('Invalid service name'), { status: 400 });

  const isFinish = serviceName === 'Finish' || service.finish === true;
  const servicePrice = resolveServicePrice(serviceName, isFinish, serviceCatalog.rows[0].default_price);
  await client.query('DELETE FROM visit_services WHERE visit_id = $1', [visit.id]);
  await client.query(
    `INSERT INTO visit_services (id, visit_id, service_name, is_finish, is_temporarily, price)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5)`,
    [visit.id, serviceName, isFinish, service.temporarily === true, servicePrice]
  );

  await client.query('DELETE FROM visit_items WHERE visit_id = $1', [visit.id]);
  const itemNames = new Set();
  for (const item of snapshot.items ?? []) {
    if (!item?.item_name || itemNames.has(item.item_name)) {
      throw Object.assign(new Error('Duplicate or invalid item in completion snapshot'), { status: 400 });
    }
    itemNames.add(item.item_name);
    const catalogResult = await client.query('SELECT * FROM catalog_items WHERE item_name = $1', [item.item_name]);
    const catalog = catalogResult.rows[0];
    if (!catalog || catalog.category !== item.category) {
      throw Object.assign(new Error('Item not found in catalog'), { status: 400 });
    }
    const description = typeof item.description === 'string' ? item.description.trim() : null;
    if ((item.item_name === 'Other' || item.item_name === 'Other Fix') && !description) {
      throw Object.assign(new Error('description is required for this item'), { status: 400 });
    }
    const quantity = Number(item.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw Object.assign(new Error('Invalid item quantity'), { status: 400 });
    }
    let price = catalog.custom_price ? Number(item.price) : (catalog.default_price ?? 0);
    if (!Number.isFinite(price) || price < 0) throw Object.assign(new Error('Invalid item price'), { status: 400 });
    if (item.item_name === 'Weight-In-Data') {
      price = resolveWeightInDataPrice(catalog.default_price, catalog.finish_addon_price, isFinish);
    }
    await client.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, description, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7)`,
      [visit.id, item.item_name, catalog.category, description, quantity, price, catalog.tech_supplied]
    );
  }
  for (const itemName of itemNames) {
    await resolveCompanionCascade(client, visit.id, itemName, 'add');
  }

  // Weigh-In remains address/system structured data. Snapshot delivery may
  // update an existing measurement but never changes visit system topology.
  for (const data of snapshot.weighInData ?? []) {
    const systemNumber = Number(data.systemNumber ?? data.system_number);
    if (!Number.isInteger(systemNumber) || systemNumber < 1) continue;
    await client.query(
      `INSERT INTO weigh_in_data
        (id, address_id, system_number, lineset_length, factory_charge_oz, factory_line_config,
         approx_adjust_oz, adjusted_oz, fan_speed_cfm, liquid_line_temp, suction_line_temp,
         condenser_sat_temp, subcooling_value, oem_subcooling_goal, subcooling_deviation)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (address_id, system_number) DO UPDATE SET
         lineset_length = EXCLUDED.lineset_length,
         factory_charge_oz = COALESCE(EXCLUDED.factory_charge_oz, weigh_in_data.factory_charge_oz),
         factory_line_config = EXCLUDED.factory_line_config,
         approx_adjust_oz = COALESCE(EXCLUDED.approx_adjust_oz, weigh_in_data.approx_adjust_oz),
         adjusted_oz = EXCLUDED.adjusted_oz,
         fan_speed_cfm = EXCLUDED.fan_speed_cfm,
         liquid_line_temp = EXCLUDED.liquid_line_temp,
         suction_line_temp = EXCLUDED.suction_line_temp,
         condenser_sat_temp = EXCLUDED.condenser_sat_temp,
         subcooling_value = EXCLUDED.subcooling_value,
         oem_subcooling_goal = EXCLUDED.oem_subcooling_goal,
         subcooling_deviation = COALESCE(EXCLUDED.subcooling_deviation, weigh_in_data.subcooling_deviation)`,
      [visit.address_id, systemNumber,
        data.linesetLength ?? data.lineset_length ?? null,
        data.factoryChargeOz ?? data.factory_charge_oz ?? null,
        data.factoryLineConfig ?? data.factory_line_config ?? null,
        data.approxAdjustOz ?? data.approx_adjust_oz ?? null,
        data.adjustedOz ?? data.adjusted_oz ?? null,
        data.fanSpeedCfm ?? data.fan_speed_cfm ?? null,
        data.liquidLineTemp ?? data.liquid_line_temp ?? null,
        data.suctionLineTemp ?? data.suction_line_temp ?? null,
        data.condenserSatTemp ?? data.condenser_sat_temp ?? null,
        data.subcoolingValue ?? data.subcooling_value ?? null,
        data.oemSubcoolingGoal ?? data.oem_subcooling_goal ?? null,
        data.subcoolingDeviation ?? data.subcooling_deviation ?? null]
    );
  }
  return calculateVisitPrice(client, visit.id);
}

// POST /api/visits/:id/complete
router.post('/:id/complete', requireRole('technician'), async (req, res, next) => {
  const { id } = req.params;
  let normalizedSubmissionId = null;
  try {
    const { submissionId: rawSubmissionId, snapshot } = req.body ?? {};
    const submissionId = typeof rawSubmissionId === 'string' ? rawSubmissionId.trim() : null;
    const snapshotSubmissionId = typeof snapshot?.submissionId === 'string' ? snapshot.submissionId.trim() : null;
    if (
      rawSubmissionId != null && (
        typeof rawSubmissionId !== 'string' ||
        !submissionId ||
        submissionId.length > MAX_SUBMISSION_ID_LENGTH ||
        !snapshot ||
        snapshotSubmissionId !== submissionId ||
        snapshot.visitId !== id
      )
    ) {
      return res.status(400).json({ error: 'Invalid completion submission' });
    }
    if (rawSubmissionId == null && snapshot?.submissionId != null) {
      if (
        typeof snapshot.submissionId !== 'string' ||
        !snapshotSubmissionId ||
        snapshotSubmissionId.length > MAX_SUBMISSION_ID_LENGTH
      ) {
        return res.status(400).json({ error: 'Invalid completion submission' });
      }
    }
    normalizedSubmissionId = submissionId;

    if (submissionId) {
      const existingSubmission = await pool.query(
        'SELECT visit_id FROM completion_submissions WHERE submission_id = $1',
        [submissionId]
      );
      if (existingSubmission.rows.length > 0) {
        if (existingSubmission.rows[0].visit_id !== id) {
          return res.status(409).json({ error: 'Submission belongs to a different visit' });
        }
        const report = await generateReportJSON(pool, id);
        return res.json({ ...report, acknowledged: true, submissionId });
      }
    }
    const visitResult = await pool.query(
      `SELECT v.id, v.status, v.technician_id, v.notes, v.address_id, a.street
       FROM visits v
       JOIN addresses a ON a.id = v.address_id
       WHERE v.id = $1`,
      [id]
    );
    if (visitResult.rows.length === 0) return res.status(404).json({ error: 'Visit not found' });
    const visit = visitResult.rows[0];

    if (TERMINAL_STATUSES.includes(visit.status)) {
      return res.json({ ...(await generateReportJSON(pool, id)), acknowledged: true, submissionId: submissionId ?? null });
    }

    if (visit.technician_id !== req.technician.id) {
      return res.status(403).json({ error: 'This visit is not assigned to you' });
    }

    if (!['assigned', 'in_progress'].includes(visit.status)) {
      return res.status(400).json({ error: `Visit cannot be completed — current status: ${visit.status}` });
    }

    const completionData = snapshot ?? req.body ?? {};
    const { checklistAnswers, notes, cancel = false } = completionData;
    const now = new Date().toISOString();
    const client = await pool.connect();
    let expiredRows = [];
    let alreadyTerminal = false;
    try {
      await client.query('BEGIN');
      const lockedVisitResult = await client.query(
        `SELECT id, status, technician_id, notes, address_id
         FROM visits
         WHERE id = $1
         FOR UPDATE`,
        [id]
      );
      if (lockedVisitResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Visit not found' });
      }
      const lockedVisit = lockedVisitResult.rows[0];

      if (submissionId) {
        const existingInTx = await client.query(
          'SELECT visit_id FROM completion_submissions WHERE submission_id = $1',
          [submissionId]
        );
        if (existingInTx.rows.length > 0) {
          await client.query('ROLLBACK');
          if (existingInTx.rows[0].visit_id !== id) {
            return res.status(409).json({ error: 'Submission belongs to a different visit' });
          }
          const report = await generateReportJSON(pool, id);
          return res.json({ ...report, acknowledged: true, submissionId });
        }
      }

      if (TERMINAL_STATUSES.includes(lockedVisit.status)) {
        alreadyTerminal = true;
        await client.query('ROLLBACK');
      } else {
        if (lockedVisit.technician_id !== req.technician.id) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: 'This visit is not assigned to you' });
        }

        if (!['assigned', 'in_progress'].includes(lockedVisit.status)) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Visit cannot be completed — current status: ${lockedVisit.status}` });
        }

        const serviceResult = await client.query(
          'SELECT service_name, is_temporarily FROM visit_services WHERE visit_id = $1',
          [id]
        );
        if (serviceResult.rows.length === 0 && !cancel && !snapshot?.service?.serviceName) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'No service selected' });
        }
        const svc = serviceResult.rows[0];
        const isCancel = cancel === true || svc?.service_name === 'Cancel';
        const resolvedNotes = typeof notes === 'string' ? notes : lockedVisit.notes;
        const hasNotes = typeof resolvedNotes === 'string' && resolvedNotes.trim().length > 0;
        const hasChecklistAnswer = Array.isArray(checklistAnswers)
          && checklistAnswers.some(answer => answer?.answer === 'yes' || answer?.answer === 'no');

        if (isCancel && !hasNotes && !hasChecklistAnswer) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Cancel requires notes or a checklist answer' });
        }

        let finalStatus;
        if (isCancel) {
          finalStatus = 'cancelled';
        } else if ((snapshot?.service?.temporarily ?? svc?.is_temporarily) === true) {
          finalStatus = 'temporarily';
        } else {
          finalStatus = 'completed';
        }

        if (submissionId) {
          await client.query(
            `INSERT INTO completion_submissions
               (submission_id, visit_id, technician_id, terminal_intent, snapshot, accepted_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [submissionId, id, req.technician.id, finalStatus, JSON.stringify(snapshot), now]
          );
        }
        let resolvedTotal = null;
        if (snapshot && !isCancel) {
          resolvedTotal = await applySnapshotWork(client, lockedVisit, snapshot);
        }
        if (isCancel) {
          await client.query('DELETE FROM visit_items WHERE visit_id = $1', [id]);
          await client.query('DELETE FROM visit_services WHERE visit_id = $1', [id]);
          await client.query(
            `INSERT INTO visit_services (id, visit_id, service_name, is_finish, is_temporarily, price)
             VALUES (gen_random_uuid()::text, $1, 'Cancel', false, false, 0)`,
            [id]
          );
        }
        await client.query(
          `UPDATE visits
           SET status = $1, total_price = CASE WHEN $5 THEN 0 WHEN $7::real IS NOT NULL THEN $7::real ELSE total_price END,
               notes = COALESCE($6, notes), completed_at = $2, updated_at = $2,
               checklist_answers = $4
           WHERE id = $3`,
          [finalStatus, now, id, JSON.stringify(checklistAnswers ?? null), isCancel, typeof notes === 'string' ? notes : null, resolvedTotal]
        );
        const expiredResult = await client.query(
          `UPDATE transfers SET status = 'expired', resolved_at = $1
           WHERE visit_id = $2 AND status = 'pending'
           RETURNING to_tech_id`,
          [now, id]
        );
        expiredRows = expiredResult.rows;
        await client.query('COMMIT');
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    if (alreadyTerminal) {
      return res.json({ ...(await generateReportJSON(pool, id)), acknowledged: true, submissionId: submissionId ?? null });
    }

    // Notifications remain outside transaction (soft failures OK)
    for (const row of expiredRows) {
      await createNotification(pool, {
        recipientId: row.to_tech_id,
        type: 'transfer_expired',
        message: `A transfer request for ${visit.street} has expired — the visit was completed by the original technician`,
      });
    }

    const dispatchersResult = await pool.query(
      `SELECT id FROM technicians WHERE role IN ('dispatcher', 'owner') AND is_active = true`
    );
    for (const d of dispatchersResult.rows) {
      await createNotification(pool, {
        recipientId: d.id,
        type: 'completion_received',
        message: `${req.technician.name} completed ${visit.street}`,
      });
    }

    console.log('Drive upload pending for visit', id);

    res.json({ ...(await generateReportJSON(pool, id)), acknowledged: true, submissionId: submissionId ?? null });
  } catch (err) {
    // Two delivery attempts can cross after both preflight reads. The unique
    // submission identity is still authoritative: once the competing
    // transaction committed, return its ACK rather than treating a retry as a
    // report failure.
    if (err?.code === '23505' && normalizedSubmissionId) {
      try {
        const accepted = await pool.query(
          'SELECT visit_id FROM completion_submissions WHERE submission_id = $1 OR visit_id = $2',
          [normalizedSubmissionId, id]
        );
        if (accepted.rows.some(row => row.visit_id === id)) {
          return res.json({
            ...(await generateReportJSON(pool, id)),
            acknowledged: true,
            submissionId: normalizedSubmissionId,
          });
        }
      } catch (_) {
        // Preserve the original completion error below.
      }
    }
    next(err);
  }
});

// GET /api/visits/:id/report-preview
router.get('/:id/report-preview', async (req, res, next) => {
  const { id } = req.params;
  try {
    const visitResult = await pool.query(
      'SELECT id, technician_id FROM visits WHERE id = $1',
      [id]
    );
    if (visitResult.rows.length === 0) return res.status(404).json({ error: 'Visit not found' });
    const visit = visitResult.rows[0];

    if (req.technician.role === 'technician' && visit.technician_id !== req.technician.id) {
      return res.status(403).json({ error: 'This visit is not assigned to you' });
    }

    const reportText = await generateReportText(pool, id);
    res.json({ reportText });
  } catch (err) {
    next(err);
  }
});

// GET /api/visits/:id/download
router.get('/:id/download', async (req, res, next) => {
  const { id } = req.params;
  try {
    const visitResult = await pool.query(
      'SELECT id, technician_id FROM visits WHERE id = $1',
      [id]
    );
    if (visitResult.rows.length === 0) return res.status(404).json({ error: 'Visit not found' });
    const visit = visitResult.rows[0];

    if (req.technician.role === 'technician' && visit.technician_id !== req.technician.id) {
      return res.status(403).json({ error: 'This visit is not assigned to you' });
    }

    res.json(await generateReportJSON(pool, id));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
