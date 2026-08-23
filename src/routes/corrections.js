const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const { createNotification } = require('../helpers/notify');
const { calculateVisitPrice, resolveServicePrice, resolveWeightInDataPrice, syncWeightInDataPrice } = require('../services/pricing');
const { computeCommission } = require('../helpers/commission');

const router = express.Router();
const TERMINAL_STATUSES = ['completed', 'temporarily', 'cancelled'];
const CHECKLIST_ANSWERS = new Set(['yes', 'no']);
const WORK_SERVICE_NAMES = new Set(['AC', 'Heat', 'AC & Heat', 'Prestart', 'Drive Run', 'Finish']);

function normalizedRequestMessage(body) {
  return typeof (body?.reason ?? body?.message) === 'string'
    ? (body.reason ?? body.message).trim()
    : '';
}

function normalizedNote(body) {
  if (typeof body?.note !== 'string') return null;
  return body.note.trim() || null;
}

function correctionShape(r) {
  return {
    id: r.id,
    visitId: r.visit_id,
    address: { street: r.street },
    initiator: { id: r.initiator_id, name: r.initiator_name },
    origin: r.origin,
    requestMessage: r.request_message,
    note: r.note,
    // Transitional aliases preserve the existing technician-request queue UI/API.
    requestedBy: { id: r.initiator_id, name: r.initiator_name },
    message: r.request_message,
    status: r.status,
    requestedAt: r.requested_at,
    appliedAt: r.applied_at,
  };
}

async function visitForCorrection(db, visitId, lock = false) {
  const result = await db.query(
    `SELECT v.id, v.address_id, v.status, v.technician_id, v.completed_at,
            v.order_number, v.date, v.scheduled_time, v.work_type, v.company_notes,
            v.contact_name, v.contact_phone, v.contact_channel, v.notes,
            v.checklist_answers, v.total_price, a.street, a.city, a.state,
            a.zip, a.subdivision, a.builder
     FROM visits v JOIN addresses a ON a.id = v.address_id
     WHERE v.id = $1${lock ? ' FOR UPDATE' : ''}`,
    [visitId]
  );
  return result.rows[0] ?? null;
}

async function correctionPeriodStatus(db, completedAt) {
  if (!completedAt) return null;
  const result = await db.query(
    `SELECT status FROM pay_periods WHERE week_start <= $1 AND week_end >= $1`,
    [completedAt]
  );
  return result.rows[0]?.status ?? null;
}

async function reconcileClosedPeriodDelta(db, { correction, visit, before, correctedTotal, actorId, now }) {
  const periodResult = await db.query(
    `SELECT * FROM pay_periods WHERE week_start <= $1 AND week_end >= $1 FOR UPDATE`,
    [visit.completed_at]
  );
  const originalPeriod = periodResult.rows[0];
  if (!originalPeriod || originalPeriod.status === 'open') return null;
  const lineResult = await db.query(
    `SELECT commission_rate_applied FROM pay_period_lines
     WHERE period_id = $1 AND technician_id = $2`,
    [originalPeriod.id, visit.technician_id]
  );
  if (!lineResult.rows[0]) {
    throw Object.assign(new Error('Closed period has no historical compensation line for this visit technician'), { status: 409 });
  }
  const techResult = await db.query('SELECT role FROM technicians WHERE id = $1', [visit.technician_id]);
  const rate = Number(lineResult.rows[0].commission_rate_applied);
  const role = techResult.rows[0]?.role;
  const originalAmount = computeCommission(Number(before.totalPrice ?? 0), role, rate).netAmount;
  const correctedAmount = computeCommission(Number(correctedTotal ?? 0), role, rate).netAmount;
  const deltaAmount = correctedAmount - originalAmount;
  const destination = await db.query(
    `SELECT id FROM pay_periods
     WHERE status = 'open' AND week_start > $1
     ORDER BY week_start ASC LIMIT 1`,
    [originalPeriod.week_end]
  );
  const destinationId = destination.rows[0]?.id ?? null;
  await db.query(
    `INSERT INTO pay_period_adjustments
       (id, correction_id, visit_id, technician_id, original_pay_period_id,
        destination_pay_period_id, reason, actor_id, original_amount,
        corrected_amount, delta_amount, status, created_at, applied_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (correction_id) DO NOTHING`,
    [crypto.randomUUID(), correction.id, visit.id, visit.technician_id, originalPeriod.id,
      destinationId, correction.note ?? correction.request_message, actorId, originalAmount, correctedAmount, deltaAmount,
      destinationId ? 'applied' : 'pending', now, destinationId ? now : null]
  );
  return { originalPayPeriodId: originalPeriod.id, destinationPayPeriodId: destinationId,
    originalAmount, correctedAmount, deltaAmount, status: destinationId ? 'applied' : 'pending' };
}

async function validateChanges(db, changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    return { error: 'changes are required' };
  }
  const domains = [];
  const updates = {};
  const job = changes.jobContext;
  if (job !== undefined) {
    if (!job || typeof job !== 'object') return { error: 'jobContext must be an object' };
    if (job.orderNumber !== undefined && typeof job.orderNumber !== 'string') return { error: 'orderNumber must be text' };
    if (job.scheduledTime !== undefined && typeof job.scheduledTime !== 'string') return { error: 'scheduledTime must be text' };
    const textFields = ['orderNumber', 'scheduledDate', 'scheduledTime', 'workType', 'companyNotes', 'contactName', 'contactPhone', 'contactChannel'];
    if (textFields.some(field => job[field] !== undefined && typeof job[field] !== 'string')) return { error: 'jobContext values must be text' };
    if (job.scheduledDate && !/^\d{4}-\d{2}-\d{2}$/.test(job.scheduledDate)) return { error: 'scheduledDate must be YYYY-MM-DD' };
    if (!textFields.some(field => job[field] !== undefined)) return { error: 'jobContext requires a value' };
    updates.orderNumber = job.orderNumber;
    updates.scheduledDate = job.scheduledDate || null;
    updates.scheduledTime = job.scheduledTime;
    updates.workType = job.workType;
    updates.companyNotes = job.companyNotes;
    updates.contactName = job.contactName;
    updates.contactPhone = job.contactPhone;
    updates.contactChannel = job.contactChannel;
    domains.push('job_context');
  }
  const property = changes.propertyContext;
  if (property !== undefined) {
    if (!property || typeof property !== 'object') return { error: 'propertyContext must be an object' };
    const fields = ['street', 'city', 'state', 'zip', 'subdivision', 'builder'];
    if (fields.some(field => property[field] !== undefined && typeof property[field] !== 'string')) return { error: 'propertyContext values must be text' };
    if (!fields.some(field => property[field] !== undefined)) return { error: 'propertyContext requires a value' };
    if (property.street !== undefined && !property.street.trim()) return { error: 'property street cannot be blank' };
    updates.propertyContext = property;
    domains.push('property_context');
  }
  if (changes.notes !== undefined) {
    if (typeof changes.notes !== 'string') return { error: 'notes must be text' };
    updates.notes = changes.notes;
    domains.push('notes');
  }
  if (changes.checklistAnswers !== undefined) {
    if (!Array.isArray(changes.checklistAnswers) || !changes.checklistAnswers.every(a => a && typeof a.item === 'string' && CHECKLIST_ANSWERS.has(a.answer))) {
      return { error: 'checklistAnswers must contain Yes/No answers' };
    }
    updates.checklistAnswers = changes.checklistAnswers;
    domains.push('checklist');
  }
  if (changes.services !== undefined) {
    if (!Array.isArray(changes.services) || changes.services.length !== 1 || !changes.services.every(s => s && WORK_SERVICE_NAMES.has(s.serviceName))) {
      return { error: 'services must contain one valid Service selection' };
    }
    const names = [...new Set(changes.services.map(s => s.serviceName))];
    const catalog = await db.query('SELECT service_name, default_price FROM catalog_services WHERE service_name = ANY($1)', [names]);
    if (catalog.rows.length !== names.length) return { error: 'A Service selection is not in the catalog' };
    updates.services = changes.services.map(s => ({ serviceName: s.serviceName, isFinish: s.serviceName === 'Finish' || Boolean(s.isFinish) }));
    domains.push('service');
  }
  if (changes.items !== undefined) {
    if (!Array.isArray(changes.items)) return { error: 'items must be an array' };
    const names = [...new Set(changes.items.map(i => i?.itemName))];
    if (names.some(n => typeof n !== 'string')) return { error: 'items require catalog itemName values' };
    if (names.length !== changes.items.length) return { error: 'items cannot contain duplicate catalog entries' };
    const catalog = await db.query(`SELECT item_name, category, default_price, tech_supplied, custom_price, finish_addon_price
                                    FROM catalog_items WHERE item_name = ANY($1)`, [names]);
    if (catalog.rows.length !== names.length) return { error: 'An item is not in the catalog' };
    const byName = new Map(catalog.rows.map(r => [r.item_name, r]));
    const normalized = [];
    for (const input of changes.items) {
      const item = byName.get(input.itemName);
      const quantity = input.quantity == null ? 1 : Number(input.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) return { error: 'item quantity must be a positive integer' };
      const description = typeof input.description === 'string' ? input.description.trim() : null;
      if ((item.item_name === 'Other' || item.item_name === 'Other Fix') && !description) return { error: 'Other items require a description' };
      if (item.custom_price && !Number.isFinite(Number(input.price))) return { error: 'custom-price items require price' };
      normalized.push({ item, quantity, description, price: item.custom_price ? Number(input.price) : Number(item.default_price ?? 0) });
    }
    updates.items = normalized;
    domains.push('items');
  }
  if (changes.systems !== undefined) {
    if (!Array.isArray(changes.systems) || changes.systems.length === 0) return { error: 'systems must contain existing system entries' };
    const numbers = changes.systems.map(system => Number(system?.systemNumber));
    if (numbers.some(number => !Number.isInteger(number) || number < 1) || new Set(numbers).size !== numbers.length) return { error: 'systems require unique positive systemNumber values' };
    const models = changes.systems.flatMap(system => [system.indoorModel, system.outdoorModel, system.coilModel]).filter(model => model != null && model !== '');
    if (models.some(model => typeof model !== 'string')) return { error: 'system models must be text' };
    const catalog = models.length
      ? await db.query('SELECT model, refrigerant, unit_type FROM catalog_equipment WHERE model = ANY($1)', [[...new Set(models)]])
      : { rows: [] };
    if (catalog.rows.length !== new Set(models).size) return { error: 'A system model is not in the equipment catalog' };
    const equipmentByModel = new Map(catalog.rows.map(row => [row.model, row]));
    for (const system of changes.systems) {
      const indoor = system.indoorModel && equipmentByModel.get(system.indoorModel);
      const outdoor = system.outdoorModel && equipmentByModel.get(system.outdoorModel);
      const coil = system.coilModel && equipmentByModel.get(system.coilModel);
      if (indoor && !['furnace', 'air_handler'].includes(indoor.unit_type)) return { error: 'Indoor equipment must be a furnace or air handler' };
      if (outdoor && !['condenser', 'heat_pump'].includes(outdoor.unit_type)) return { error: 'Outdoor equipment must be a condenser or heat pump' };
      if (coil && coil.unit_type !== 'coil') return { error: 'Coil equipment must be a coil catalog entry' };
    }
    updates.systems = changes.systems.map(system => ({
      systemNumber: Number(system.systemNumber),
      indoorModel: system.indoorModel || null,
      outdoorModel: system.outdoorModel || null,
      coilModel: system.coilModel || null,
    }));
    domains.push('systems');
  }
  if (changes.weighIn !== undefined) {
    if (!Array.isArray(changes.weighIn)) return { error: 'weighIn must be an array' };
    const numbers = changes.weighIn.map(row => Number(row?.systemNumber));
    if (new Set(numbers).size !== numbers.length) return { error: 'weighIn requires unique systemNumber values' };
    for (const row of changes.weighIn) {
      if (!row || !Number.isInteger(Number(row.systemNumber)) || !row.factoryLineConfig) return { error: 'weighIn rows require systemNumber and factoryLineConfig' };
      for (const field of ['linesetLength', 'factoryChargeOz', 'adjustedOz', 'fanSpeedCfm', 'liquidLineTemp', 'suctionLineTemp', 'condenserSatTemp']) {
        if (row[field] != null && row[field] !== '' && !Number.isFinite(Number(row[field]))) return { error: `weighIn ${field} must be numeric` };
      }
    }
    updates.weighIn = changes.weighIn.map(row => ({
      systemNumber: Number(row.systemNumber),
      factoryLineConfig: row.factoryLineConfig,
      linesetLength: nullableNumber(row.linesetLength),
      factoryChargeOz: nullableNumber(row.factoryChargeOz),
      adjustedOz: nullableNumber(row.adjustedOz),
      fanSpeedCfm: nullableNumber(row.fanSpeedCfm),
      liquidLineTemp: nullableNumber(row.liquidLineTemp),
      suctionLineTemp: nullableNumber(row.suctionLineTemp),
      condenserSatTemp: nullableNumber(row.condenserSatTemp),
    }));
    domains.push('weigh_in');
  }
  if (domains.length === 0) return { error: 'No supported correction changes supplied' };
  return { domains, updates };
}

function nullableNumber(value) {
  return value == null || value === '' ? null : Number(value);
}

function serviceLabel(services = []) {
  const service = services[0];
  if (!service) return 'no Service';
  const name = service.service_name ?? service.serviceName;
  const finish = service.is_finish ?? service.isFinish;
  return finish && name !== 'Finish' ? `${name} with Finish` : name;
}

function itemMap(items = []) {
  return new Map(items.map(item => [item.item_name ?? item.itemName, item]));
}

function correctionSummary(before, after, domains) {
  const lines = [];
  if (domains.includes('service')) {
    const from = serviceLabel(before.services);
    const to = serviceLabel(after.services);
    if (from !== to) lines.push(`Service changed from ${from} to ${to}.`);
  }
  if (domains.includes('items')) {
    const beforeItems = itemMap(before.items); const afterItems = itemMap(after.items);
    for (const name of beforeItems.keys()) if (!afterItems.has(name)) lines.push(`Removed ${name}.`);
    for (const name of afterItems.keys()) if (!beforeItems.has(name)) lines.push(`Added ${name}.`);
    for (const [name, item] of afterItems) {
      const previous = beforeItems.get(name);
      if (previous && Number(previous.quantity) !== Number(item.quantity)) lines.push(`${name} quantity changed from ${previous.quantity} to ${item.quantity}.`);
    }
  }
  if (domains.includes('systems')) {
    const byNumber = new Map(before.systems.map(system => [system.system_number, system]));
    for (const system of after.systems) {
      const previous = byNumber.get(system.system_number);
      for (const [field, label] of [['indoor_model', 'indoor model'], ['outdoor_model', 'outdoor model'], ['coil_model', 'coil model']]) {
        if (previous && previous[field] !== system[field]) lines.push(`System ${system.system_number} ${label} changed from ${previous[field] ?? '—'} to ${system[field] ?? '—'}.`);
      }
    }
  }
  if (domains.includes('notes') && before.notes !== after.notes) lines.push('Notes updated.');
  if (domains.includes('checklist')) {
    const prior = new Map((before.checklistAnswers ?? []).map(a => [a.item, a.answer]));
    const changed = (after.checklistAnswers ?? []).filter(a => prior.get(a.item) !== a.answer).length + [...prior.keys()].filter(key => !(after.checklistAnswers ?? []).some(a => a.item === key)).length;
    lines.push(`Checklist updated (${changed} answers changed).`);
  }
  if (domains.includes('job_context')) lines.push('Job context updated.');
  if (domains.includes('property_context')) lines.push('Property context updated.');
  if (domains.includes('weigh_in')) lines.push('Weigh-In updated.');
  return lines.length ? lines.join(' ') : 'Correction applied.';
}

async function correctionState(db, visit) {
  // This can run inside the Apply transaction, so do not issue concurrent
  // queries on the checked-out PoolClient.
  const systems = await db.query('SELECT system_number, indoor_model, outdoor_model, coil_model, refrigerant FROM visit_systems WHERE visit_id = $1 ORDER BY system_number', [visit.id]);
  const services = await db.query('SELECT service_name, is_finish, is_temporarily, price FROM visit_services WHERE visit_id = $1 ORDER BY id', [visit.id]);
  const items = await db.query('SELECT id, item_name, category, description, quantity, price, tech_supplied FROM visit_items WHERE visit_id = $1 ORDER BY id', [visit.id]);
  const weighIn = await db.query(`SELECT * FROM weigh_in_data WHERE address_id = (SELECT address_id FROM visits WHERE id = $1) ORDER BY system_number`, [visit.id]);
  const photos = await db.query('SELECT id, tag, label, category, system_number, stored_at FROM visit_photos WHERE visit_id = $1 ORDER BY stored_at', [visit.id]);
  return {
    jobContext: {
      orderNumber: visit.order_number, scheduledDate: visit.date, scheduledTime: visit.scheduled_time,
      workType: visit.work_type, companyNotes: visit.company_notes,
      contactName: visit.contact_name, contactPhone: visit.contact_phone,
      contactChannel: visit.contact_channel,
    },
    propertyContext: {
      street: visit.street, city: visit.city, state: visit.state, zip: visit.zip,
      subdivision: visit.subdivision, builder: visit.builder,
    },
    notes: visit.notes,
    checklistAnswers: visit.checklist_answers ?? [],
    terminalStatus: visit.status,
    totalPrice: visit.total_price,
    systems: systems.rows,
    services: services.rows,
    items: items.rows,
    weighIn: weighIn.rows,
    photos: visit.status === 'cancelled'
      ? photos.rows.filter(photo => !['weigh_in_scale', 'fan_speed'].includes(photo.category))
      : photos.rows,
  };
}

async function notifyDispatchers(db, type, message) {
  const result = await db.query(`SELECT id FROM technicians WHERE role IN ('dispatcher', 'owner') AND is_active = true`);
  for (const row of result.rows) await createNotification(db, { recipientId: row.id, type, message });
}

async function createCorrection({ visitId, origin, initiatorId, requestMessage = null, note = null }) {
  const visit = await visitForCorrection(pool, visitId);
  if (!visit) return { error: 'Visit not found', status: 404 };
  if (!TERMINAL_STATUSES.includes(visit.status)) return { error: 'Corrections can only be created for submitted visits', status: 400 };
  const existing = await pool.query(`SELECT id FROM corrections WHERE visit_id = $1 AND status = 'open'`, [visitId]);
  if (existing.rows.length) return { error: 'An open correction already exists for this visit', status: 400 };
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO corrections (id, visit_id, initiator_id, origin, request_message, note, status, requested_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'open', $7)`,
    [id, visitId, initiatorId, origin, requestMessage, note, now]
  );
  return { id, now, visit };
}

// POST /api/visits/:id/request-correction
router.post('/visits/:id/request-correction', requireRole('technician'), async (req, res, next) => {
  try {
    const requestMessage = normalizedRequestMessage(req.body);
    if (!requestMessage) return res.status(400).json({ error: 'A correction message is required' });
    const visit = await visitForCorrection(pool, req.params.id);
    if (!visit) return res.status(404).json({ error: 'Visit not found' });
    if (visit.technician_id !== req.technician.id) return res.status(403).json({ error: 'This visit is not assigned to you' });
    const created = await createCorrection({ visitId: visit.id, origin: 'technician_requested', initiatorId: req.technician.id, requestMessage });
    if (created.error) return res.status(created.status).json({ error: created.error });
    await notifyDispatchers(pool, 'correction_requested', `${req.technician.name} requested a correction for ${visit.street}`);
    res.json({ correctionId: created.id, status: 'open' });
  } catch (err) { next(err); }
});

// POST /api/dispatch/corrections — Dispatcher-initiated correction.
router.post('/dispatch/corrections', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { visitId } = req.body ?? {};
    if (!visitId) return res.status(400).json({ error: 'visitId is required' });
    const created = await createCorrection({ visitId, origin: 'dispatcher_initiated', initiatorId: req.technician.id, note: normalizedNote(req.body) });
    if (created.error) return res.status(created.status).json({ error: created.error });
    res.status(201).json({ correctionId: created.id, status: 'open', origin: 'dispatcher_initiated' });
  } catch (err) { next(err); }
});

// GET /api/dispatch/corrections/finder — read-only terminal report lookup.
router.get('/dispatch/corrections/finder', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const { orderNumber, address, technician, date, dateFrom, dateTo } = req.query;
    const params = [];
    const where = [`v.status IN ('completed', 'temporarily', 'cancelled')`];
    for (const [value, column] of [[orderNumber, 'v.order_number'], [address, 'a.street'], [technician, 't.name']]) {
      if (value) { params.push(`%${value}%`); where.push(`${column} ILIKE $${params.length}`); }
    }
    if (date) { params.push(date); where.push(`v.completed_at::date = $${params.length}::date`); }
    if (dateFrom) { params.push(dateFrom); where.push(`v.completed_at::date >= $${params.length}::date`); }
    if (dateTo) { params.push(dateTo); where.push(`v.completed_at::date <= $${params.length}::date`); }
    if (params.length === 0) return res.status(400).json({ error: 'At least one Finder filter is required' });
    const result = await pool.query(
      `SELECT v.id, v.order_number, v.status, v.completed_at, v.total_price, v.technician_id,
              a.street, t.name AS technician_name
       FROM visits v JOIN addresses a ON a.id = v.address_id
       LEFT JOIN technicians t ON t.id = v.technician_id
       WHERE ${where.join(' AND ')} ORDER BY v.completed_at DESC LIMIT 100`,
      params
    );
    res.json(result.rows.map(r => ({ id: r.id, orderNumber: r.order_number, status: r.status, completedAt: r.completed_at, totalPrice: r.total_price, address: { street: r.street }, technician: { id: r.technician_id, name: r.technician_name } })));
  } catch (err) { next(err); }
});

// PATCH /api/dispatch/corrections/:id/apply — current safe subset: no-priced domains.
router.patch('/dispatch/corrections/:id/apply', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const corrResult = await client.query(`SELECT * FROM corrections WHERE id = $1 FOR UPDATE`, [req.params.id]);
    const correction = corrResult.rows[0];
    if (!correction) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Correction not found' }); }
    if (correction.status !== 'open') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Correction is not open' }); }
    const visit = await visitForCorrection(client, correction.visit_id, true);
    if (!visit || !TERMINAL_STATUSES.includes(visit.status)) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Visit is no longer a terminal correction target' }); }
    const validation = await validateChanges(client, req.body?.changes);
    if (validation.error) { await client.query('ROLLBACK'); return res.status(400).json({ error: validation.error }); }
    const { domains, updates } = validation;
    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'note') && typeof req.body.note !== 'string') {
      await client.query('ROLLBACK'); return res.status(400).json({ error: 'note must be text' });
    }
    const note = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'note') ? normalizedNote(req.body) : correction.note;
    if (visit.status === 'cancelled' && domains.some(d => ['service', 'items', 'weigh_in'].includes(d))) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Cancelled reports cannot reintroduce normal work through Corrections' });
    }
    const before = await correctionState(client, visit);
    const columns = [];
    const values = [];
    const visitColumns = {
      orderNumber: 'order_number', scheduledDate: 'date', scheduledTime: 'scheduled_time', workType: 'work_type',
      companyNotes: 'company_notes', contactName: 'contact_name', contactPhone: 'contact_phone',
      contactChannel: 'contact_channel', notes: 'notes',
    };
    for (const [key, column] of Object.entries(visitColumns)) {
      if (updates[key] !== undefined) { values.push(updates[key]); columns.push(`${column} = $${values.length}`); }
    }
    if (updates.checklistAnswers !== undefined) { values.push(JSON.stringify(updates.checklistAnswers)); columns.push(`checklist_answers = $${values.length}`); }
    const now = new Date().toISOString();
    if (columns.length) {
      values.push(now, visit.id);
      await client.query(
        `UPDATE visits SET ${columns.join(', ')}, updated_at = $${values.length - 1} WHERE id = $${values.length}`,
        values
      );
    }
    if (updates.propertyContext) {
      const propertyColumns = [];
      const propertyValues = [];
      const propertyFields = {
        street: 'street', city: 'city', state: 'state', zip: 'zip',
        subdivision: 'subdivision', builder: 'builder',
      };
      for (const [key, column] of Object.entries(propertyFields)) {
        if (updates.propertyContext[key] !== undefined) {
          propertyValues.push(updates.propertyContext[key].trim() || null);
          propertyColumns.push(`${column} = $${propertyValues.length}`);
        }
      }
      if (updates.propertyContext.street !== undefined) {
        const conflict = await client.query('SELECT id FROM addresses WHERE street = $1 AND id <> $2', [updates.propertyContext.street.trim(), visit.address_id]);
        if (conflict.rows.length) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Another property already uses this street' });
        }
      }
      propertyValues.push(visit.address_id);
      await client.query(`UPDATE addresses SET ${propertyColumns.join(', ')} WHERE id = $${propertyValues.length}`, propertyValues);
    }
    if (updates.services) {
      await client.query('DELETE FROM visit_services WHERE visit_id = $1', [visit.id]);
      for (const service of updates.services) {
        const catalog = await client.query('SELECT default_price FROM catalog_services WHERE service_name = $1', [service.serviceName]);
        const price = resolveServicePrice(service.serviceName, service.isFinish, catalog.rows[0].default_price);
        await client.query(
          `INSERT INTO visit_services (id, visit_id, service_name, is_finish, is_temporarily, price)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [crypto.randomUUID(), visit.id, service.serviceName, service.isFinish, visit.status === 'temporarily', price]
        );
      }
      await syncWeightInDataPrice(client, visit.id, updates.services.some(service => service.isFinish || service.serviceName === 'Finish'));
    }
    if (updates.items) {
      await client.query('DELETE FROM visit_items WHERE visit_id = $1', [visit.id]);
      const hasFinish = updates.services ? updates.services.some(s => s.isFinish || s.serviceName === 'Finish') : before.services.some(s => s.is_finish || s.service_name === 'Finish');
      for (const entry of updates.items) {
        let price = entry.price;
        if (entry.item.item_name === 'Weight-In-Data') price = resolveWeightInDataPrice(entry.item.default_price, entry.item.finish_addon_price, hasFinish);
        await client.query(
          `INSERT INTO visit_items (id, visit_id, item_name, category, description, quantity, price, tech_supplied)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [crypto.randomUUID(), visit.id, entry.item.item_name, entry.item.category, entry.description, entry.quantity, price, entry.item.tech_supplied]
        );
      }
    }
    if (updates.systems) {
      const existing = await client.query('SELECT system_number FROM visit_systems WHERE visit_id = $1', [visit.id]);
      const existingNumbers = new Set(existing.rows.map(row => row.system_number));
      if (updates.systems.length !== existingNumbers.size || updates.systems.some(system => !existingNumbers.has(system.systemNumber))) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Corrections cannot add or remove visit systems' });
      }
      for (const system of updates.systems) {
        const refrigerantResult = system.outdoorModel
          ? await client.query('SELECT refrigerant FROM catalog_equipment WHERE model = $1', [system.outdoorModel])
          : { rows: [] };
        const refrigerant = refrigerantResult.rows[0]?.refrigerant ?? null;
        await client.query(
          `UPDATE visit_systems
             SET indoor_model = $1, outdoor_model = $2, coil_model = $3, refrigerant = $4
           WHERE visit_id = $5 AND system_number = $6`,
          [system.indoorModel, system.outdoorModel, system.coilModel, refrigerant, visit.id, system.systemNumber]
        );
      }
    }
    if (updates.weighIn) {
      for (const row of updates.weighIn) {
        const config = await client.query('SELECT reference_length_ft, adjust_rate_oz_per_ft FROM catalog_lineset_configs WHERE config_key = $1', [row.factoryLineConfig]);
        if (!config.rows[0]) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Lineset config not found' }); }
        const length = Number(row.linesetLength ?? 0);
        const approximate = (length - Number(config.rows[0].reference_length_ft)) * Number(config.rows[0].adjust_rate_oz_per_ft);
        const subcoolingValue = row.condenserSatTemp != null && row.liquidLineTemp != null
          ? row.condenserSatTemp - row.liquidLineTemp
          : null;
        const oemSubcoolingGoal = 10;
        const subcoolingDeviation = subcoolingValue == null ? null : subcoolingValue - oemSubcoolingGoal;
        await client.query(
          `INSERT INTO weigh_in_data
             (id, address_id, system_number, lineset_length, factory_charge_oz,
              factory_line_config, approx_adjust_oz, adjusted_oz, fan_speed_cfm,
              liquid_line_temp, suction_line_temp, condenser_sat_temp,
              subcooling_value, oem_subcooling_goal, subcooling_deviation)
           VALUES ($1, (SELECT address_id FROM visits WHERE id = $2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           ON CONFLICT (address_id, system_number) DO UPDATE SET lineset_length = EXCLUDED.lineset_length,
             factory_charge_oz = EXCLUDED.factory_charge_oz, factory_line_config = EXCLUDED.factory_line_config,
             approx_adjust_oz = EXCLUDED.approx_adjust_oz, adjusted_oz = EXCLUDED.adjusted_oz,
             fan_speed_cfm = EXCLUDED.fan_speed_cfm, liquid_line_temp = EXCLUDED.liquid_line_temp,
             suction_line_temp = EXCLUDED.suction_line_temp, condenser_sat_temp = EXCLUDED.condenser_sat_temp,
             subcooling_value = EXCLUDED.subcooling_value, oem_subcooling_goal = EXCLUDED.oem_subcooling_goal,
             subcooling_deviation = EXCLUDED.subcooling_deviation`,
          [crypto.randomUUID(), visit.id, row.systemNumber, length, row.factoryChargeOz,
            row.factoryLineConfig, approximate, row.adjustedOz, row.fanSpeedCfm,
            row.liquidLineTemp, row.suctionLineTemp, row.condenserSatTemp,
            subcoolingValue, oemSubcoolingGoal, subcoolingDeviation]
        );
      }
    }
    let totalPrice = visit.total_price;
    if (domains.some(d => ['service', 'items'].includes(d))) {
      totalPrice = await calculateVisitPrice(client, visit.id);
      await client.query('UPDATE visits SET total_price = $1, updated_at = $2 WHERE id = $3', [totalPrice, now, visit.id]);
    }
    const updated = await visitForCorrection(client, visit.id);
    const after = await correctionState(client, updated);
    const financialAdjustment = Number(totalPrice ?? 0) === Number(before.totalPrice ?? 0)
      ? null
      : await reconcileClosedPeriodDelta(client, {
        correction, visit, before, correctedTotal: totalPrice, actorId: req.technician.id, now,
      });
    await client.query(
      `UPDATE corrections SET status = 'applied', applied_at = $1, applied_by = $2,
          affected_domains = $3, before_state = $4, after_state = $5, note = $6 WHERE id = $7`,
      [now, req.technician.id, JSON.stringify(domains), JSON.stringify(before), JSON.stringify(after), note, correction.id]
    );
    await client.query(
      `INSERT INTO edit_log (id, visit_id, changed_at, summary, source, actor_id, correction_id)
       VALUES ($1, $2, $3, $4, 'correction_approved', $5, $6)`,
      [crypto.randomUUID(), visit.id, now, correctionSummary(before, after, domains), req.technician.id, correction.id]
    );
    await client.query('COMMIT');
    if (correction.origin === 'technician_requested') await createNotification(pool, { recipientId: correction.initiator_id, type: 'correction_applied', message: 'Your correction request was applied' });
    res.json({ id: correction.id, visitId: visit.id, status: 'applied', appliedAt: now, affectedDomains: domains, totalPrice, financialAdjustment });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  } finally { client.release(); }
});

router.get('/dispatch/corrections/:id', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT c.*, a.street, t.name AS initiator_name
       FROM corrections c JOIN visits v ON v.id = c.visit_id JOIN addresses a ON a.id = v.address_id
       JOIN technicians t ON t.id = c.initiator_id WHERE c.id = $1`, [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Correction not found' });
    const r = result.rows[0];
    const visit = await visitForCorrection(pool, r.visit_id);
    res.json({ ...correctionShape(r), visitSnapshot: visit ? await correctionState(pool, visit) : null, affectedDomains: r.affected_domains, beforeState: r.before_state, afterState: r.after_state });
  } catch (err) { next(err); }
});

router.get('/dispatch/corrections', requireRole('owner', 'dispatcher'), async (req, res, next) => {
  try {
    const params = []; const where = [];
    if (req.query.status) { params.push(req.query.status); where.push(`c.status = $${params.length}`); }
    if (req.query.visitId) { params.push(req.query.visitId); where.push(`c.visit_id = $${params.length}`); }
    const result = await pool.query(
      `SELECT c.*, a.street, t.name AS initiator_name
       FROM corrections c JOIN visits v ON v.id = c.visit_id JOIN addresses a ON a.id = v.address_id
       JOIN technicians t ON t.id = c.initiator_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY CASE WHEN c.status = 'open' THEN 0 ELSE 1 END, c.requested_at DESC`, params
    );
    res.json(result.rows.map(correctionShape));
  } catch (err) { next(err); }
});

module.exports = router;
