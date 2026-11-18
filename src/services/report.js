const { isDeepStrictEqual } = require('node:util');

const ITEM_REPORT_TEXT = {
  UT3000: 'UT3000 zone board',
  HZ322: 'HZ322 zone board',
  Harmony: 'Harmony zone board',
  DAPC: 'DAPC',
  eBypass: 'Electronic Bypass Damper wired',
  Bypass: 'Bypass damper controller',
  FIN180P: 'FIN180P wired and set',
  Dehum: 'Dehum Box wired',
  'Float Switch': 'Float Switch',
  'Weight-In-Data': 'weigh-in data',
  'Ecoil Wire': 'Ecoil wire to furnace wired',
  AprilAir: 'AprilAire',
  'F/A': 'Fresh Air damper wired',
  'FIN6-MD': 'FIN6-MD wired',
  'Trane Harness': 'Trane Harness wired',
  RDS: 'RDS',
  'LP Kit Lennox 1stg': 'Lennox LP Kit 1 Stage',
  'LP Kit Lennox 2stg': 'Lennox LP Kit 2 Stage',
  'LP Kit Goodman': 'Goodman LP Kit',
  'Extended Wire(Furnace)': 'extended wire to furnace',
  'Extended Wire(Cunit)': 'extended wire to cunit',
  'Out of town fee': 'Out of town fee',
  'Pressure Test': 'Pressure Test',
  'Open Ecoil': 'I had to open the ecoil to pull out the sensor wire',
  'Leaks Ecoil': 'Fixed Leaks at Ecoil',
  'Leaks Cunit': 'Fixed Leaks at Cunit',
  'Leaks Wall': 'Fixed Leaks Inside the Wall',
  'Wires Jammed': 'Compressor wires jammed, fixed them to prevent electrical short',
  'Stuck Blower': 'Fixed Stuck/Out of balance Blower',
  'Cut Sheetrock': 'I had to cut sheetrock to locate tstat wire',
};

function formatPrice(value) {
  return Number(value ?? 0).toString();
}

function formatService(service, systemCount) {
  if (!service) return null;
  const serviceName = service.service_name ?? service.serviceName;
  const isTemporarily = service.is_temporarily ?? service.isTemporarily;
  const isFinish = service.is_finish ?? service.isFinish;
  if (serviceName === 'Finish') return null;

  const temporarily = isTemporarily ? ' (Temporarily)' : '';
  const serviceText = {
    AC: `AC${temporarily} started`,
    Heat: `Heat${temporarily} started`,
    'AC & Heat': `AC & Heat${temporarily} started`,
    Prestart: 'System Prestarted',
    'Drive Run': 'Drive Run',
    Cancel: 'service canceled',
  }[serviceName];
  if (!serviceText) return null;

  const hasAcOrHeat = ['AC', 'Heat', 'AC & Heat'].includes(serviceName);
  const prefix = isFinish && hasAcOrHeat ? 'Finish/ ' : '';
  const systemSuffix = serviceName !== 'Cancel' && systemCount > 1
    ? ` (${systemCount} Systems)`
    : '';
  return `${prefix}${serviceText}${systemSuffix} $${formatPrice(service.price)}`;
}

function serviceText(name, isTemporarily) {
  const temporarily = isTemporarily ? ' (Temporarily)' : '';
  return {
    AC: `AC${temporarily} started`,
    Heat: `Heat${temporarily} started`,
    'AC & Heat': `AC & Heat${temporarily} started`,
    Prestart: 'System Prestarted',
    'Drive Run': 'Drive Run',
  }[name] ?? null;
}

// Report parts for the Service section, with the thermostat text placed before
// the first service price. Per-system rows: systems sharing the same service
// print one line; when every system shares it the line reads like the
// single-service format, otherwise each line names its systems.
function serviceParts(rows, systemCount, thermostatText, isCancelled) {
  const withTstat = text => thermostatText ? text.replace(/ \$[^ ]+$/, ` ${thermostatText}$&`) : text;
  const normalized = (rows ?? []).map(row => ({
    serviceName: row.serviceName ?? row.service_name,
    isFinish: row.isFinish ?? row.is_finish,
    isTemporarily: row.isTemporarily ?? row.is_temporarily,
    price: row.price,
    systemNumber: row.systemNumber ?? row.system_number ?? null,
  }));
  if (isCancelled || !normalized.some(row => row.systemNumber != null)) {
    const service = normalized[0];
    const parts = [];
    if (!isCancelled && (service?.isFinish || service?.serviceName === 'Finish')
        && !['AC', 'Heat', 'AC & Heat'].includes(service.serviceName)) {
      parts.push('Finish/');
    }
    const text = isCancelled ? 'service canceled $0' : formatService(service, systemCount);
    if (text) parts.push(withTstat(text));
    else if (thermostatText) parts.push(thermostatText);
    return parts;
  }

  const groups = new Map();
  for (const row of normalized) {
    const key = [row.serviceName, row.isFinish, row.isTemporarily].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const mixed = groups.size > 1;
  let tstatPlaced = false;
  const parts = [...groups.values()].map((group) => {
    const { serviceName, isFinish, isTemporarily } = group[0];
    const numbers = group.map(row => row.systemNumber).join(', ');
    const scope = mixed
      ? ` (${group.length === 1 ? 'System' : 'Systems'} ${numbers})`
      : (group.length > 1 ? ` (${group.length} Systems)` : '');
    if (serviceName === 'Finish') return mixed ? `Finish/${scope}` : 'Finish/';
    const price = group.reduce((sum, row) => sum + Number(row.price ?? 0), 0);
    const line = `${isFinish ? 'Finish/ ' : ''}${serviceText(serviceName, isTemporarily)}${scope} $${formatPrice(price)}`;
    if (tstatPlaced) return line;
    tstatPlaced = true;
    return withTstat(line);
  });
  if (thermostatText && !tstatPlaced) parts.push(thermostatText);
  return parts;
}

function formatItem(item) {
  const itemName = item.item_name ?? item.itemName;
  const text = (itemName === 'Other' || itemName === 'Other Fix')
    ? item.description
    : ITEM_REPORT_TEXT[itemName] ?? itemName;
  if (!text) return null;
  const quantity = item.quantity > 1 ? `${item.quantity} ` : '';
  return `${quantity}${text} $${formatPrice(item.price)}`;
}

async function generateLiveReportText(db, visitId) {
  const [visitRow, serviceRows, systemRows, itemRows] = await Promise.all([
    db.query(
      `SELECT v.status, v.total_price, v.notes, v.checklist_answers, a.street
       FROM visits v
       JOIN addresses a ON a.id = v.address_id
       WHERE v.id = $1`,
      [visitId]
    ),
    db.query(
      `SELECT service_name, is_finish, is_temporarily, price, system_number
       FROM visit_services
       WHERE visit_id = $1
       ORDER BY system_number NULLS FIRST, id`,
      [visitId]
    ),
    db.query(
      'SELECT COUNT(*)::int AS count FROM visit_systems WHERE visit_id = $1',
      [visitId]
    ),
    db.query(
      `SELECT item_name, category, description, quantity, price
       FROM visit_items
       WHERE visit_id = $1
       ORDER BY category, item_name, id`,
      [visitId]
    ),
  ]);

  const visit = visitRow.rows[0];
  const systemCount = systemRows.rows[0].count;
  const isCancelled = visit.status === 'cancelled';
  const checklistFindings = (visit.checklist_answers ?? [])
    .filter(answer => answer.answer === 'no' && typeof answer.reportText === 'string' && answer.reportText.trim())
    .map(answer => answer.reportText.trim());
  const noteParts = [visit.notes?.trim(), ...checklistFindings].filter(Boolean);
  // Cancelled visits keep their justification but never render normal work,
  // even if legacy data exists beside the terminal Cancel representation.
  const reportItems = isCancelled ? [] : itemRows.rows;
  const thermostatItems = reportItems.filter(item => item.category === 'thermostat');
  const thermostatText = thermostatItems
    .map(item => `${item.quantity} ${item.item_name} tstat${item.quantity === 1 ? '' : 's'}`)
    .join(', ');
  const accessoryItems = reportItems.filter(item => item.category === 'accessory');
  const fixItems = reportItems.filter(item => item.category === 'fix');
  const parts = [visit.street?.trim()];

  if (noteParts.length) parts.push(noteParts.join(' | '));
  parts.push(...serviceParts(serviceRows.rows, systemCount, thermostatText, isCancelled));
  parts.push(...accessoryItems.map(formatItem).filter(Boolean));
  parts.push(...fixItems.map(formatItem).filter(Boolean));
  parts.push(`total $${formatPrice(visit.total_price)}`);

  return parts.filter(Boolean).join(', ');
}

async function generateLiveReportJSON(db, visitId) {
  const visitRow = await db.query(
    `SELECT v.id, v.order_number, v.date, v.scheduled_time, v.status, v.technician_id,
            v.has_multiple_systems, v.total_price, v.completed_at,
            v.address_id, v.notes, v.checklist_answers,
            a.street, a.city, a.state, a.zip, a.subdivision, a.builder
     FROM visits v
     JOIN addresses a ON a.id = v.address_id
     WHERE v.id = $1`,
    [visitId]
  );
  const v = visitRow.rows[0];
  const isCancelled = v.status === 'cancelled';

  const [systems, services, items, photos, weighIn] = await Promise.all([
    db.query(
      'SELECT system_number, indoor_model, outdoor_model, coil_model, refrigerant FROM visit_systems WHERE visit_id = $1 ORDER BY system_number',
      [visitId]
    ),
    db.query(
      'SELECT service_name, is_finish, is_temporarily, price, system_number FROM visit_services WHERE visit_id = $1 ORDER BY system_number NULLS FIRST',
      [visitId]
    ),
    db.query(
      'SELECT item_name, category, description, quantity, price, tech_supplied FROM visit_items WHERE visit_id = $1',
      [visitId]
    ),
    db.query(
      'SELECT slug, category FROM visit_photos WHERE visit_id = $1 AND detached_reason IS NULL',
      [visitId]
    ),
    db.query(
      `SELECT system_number, lineset_length, factory_charge_oz, factory_line_config,
              approx_adjust_oz, adjusted_oz, fan_speed_cfm, liquid_line_temp,
              suction_line_temp, condenser_sat_temp, subcooling_value,
              oem_subcooling_goal, subcooling_deviation
       FROM weigh_in_data WHERE address_id = $1`,
      [v.address_id]
    ),
  ]);

  return {
    id: v.id,
    orderNumber: v.order_number,
    scheduledDate: v.date,
    scheduledTime: v.scheduled_time,
    status: v.status,
    completedAt: v.completed_at,
    technicianId: v.technician_id,
    totalPrice: v.total_price,
    hasMultipleSystems: v.has_multiple_systems,
    notes: v.notes ?? '',
    checklistAnswers: v.checklist_answers ?? [],
    address: {
      street: v.street,
      city: v.city,
      state: v.state,
      zip: v.zip,
      subdivision: v.subdivision,
      builder: v.builder,
    },
    systems: systems.rows.map((s) => ({
      systemNumber: s.system_number,
      indoorModel: s.indoor_model,
      outdoorModel: s.outdoor_model,
      coilModel: s.coil_model,
      refrigerant: s.refrigerant,
    })),
    services: (isCancelled
      ? services.rows.filter(s => s.service_name === 'Cancel')
      : services.rows
    ).map((s) => ({
      serviceName: s.service_name,
      isFinish: s.is_finish,
      isTemporarily: s.is_temporarily,
      price: s.price,
      systemNumber: s.system_number,
    })),
    items: (isCancelled ? [] : items.rows).map((i) => ({
      itemName: i.item_name,
      description: i.description,
      category: i.category,
      quantity: i.quantity,
      price: i.price,
      techSupplied: i.tech_supplied,
    })),
    photos: (isCancelled
      ? photos.rows.filter(p => !['weigh_in_scale', 'fan_speed'].includes(p.category))
      : photos.rows
    ).map((p) => ({ slug: p.slug })),
    // Weigh-In rows belong to the address; a Drive Run, like a Cancel, reports none.
    weighInData: (isCancelled || services.rows.some(s => s.service_name === 'Drive Run') ? [] : weighIn.rows).map((w) => ({
      systemNumber: w.system_number,
      linesetLength: w.lineset_length,
      factoryChargeOz: w.factory_charge_oz,
      factoryLineConfig: w.factory_line_config,
      approxAdjustOz: w.approx_adjust_oz,
      adjustedOz: w.adjusted_oz,
      fanSpeedCfm: w.fan_speed_cfm,
      liquidLineTemp: w.liquid_line_temp,
      suctionLineTemp: w.suction_line_temp,
      condenserSatTemp: w.condenser_sat_temp,
      subcoolingValue: w.subcooling_value,
      oemSubcoolingGoal: w.oem_subcooling_goal,
      subcoolingDeviation: w.subcooling_deviation,
    })),
  };
}

async function createCanonicalReportSnapshot(db, visitId, {
  submissionId,
  technicianId,
  generatedAt,
  acceptedAt,
  sourceSubmission,
}) {
  const report = await generateLiveReportJSON(db, visitId);
  const [contextResult, technicianResult, evidenceResult] = await Promise.all([
    db.query(
      `SELECT v.address_id, v.work_type, v.notes, v.checklist_answers
       FROM visits v WHERE v.id = $1`,
      [visitId]
    ),
    db.query('SELECT name FROM technicians WHERE id = $1', [technicianId]),
    db.query(
      `SELECT id, visit_id, system_number, slug, tag, label, category, stored_at
       FROM visit_photos WHERE visit_id = $1 AND detached_reason IS NULL ORDER BY id`,
      [visitId]
    ),
  ]);
  const context = contextResult.rows[0];
  const technicianName = technicianResult.rows[0]?.name;
  if (!context || !technicianName) {
    throw Object.assign(new Error('Could not resolve accepted Report identity'), { status: 409 });
  }

  return {
    version: 2,
    submissionId,
    visitId,
    technicianId,
    technicianName,
    propertyId: context.address_id,
    workType: context.work_type,
    generatedAt: generatedAt || acceptedAt,
    acceptedAt,
    terminalIntent: report.status,
    notes: context.notes ?? '',
    checklistAnswers: context.checklist_answers ?? [],
    evidenceRefs: sourceSubmission?.evidenceRefs ?? [],
    weighInWarnings: weighInWarningsFrom(sourceSubmission),
    photoEvidence: evidenceResult.rows,
    sourceSubmission,
    ...report,
  };
}

// Informational Weigh-In warnings from the device (never a rejection reason).
function weighInWarningsFrom(sourceSubmission) {
  const warnings = sourceSubmission?.weighInWarnings;
  if (!Array.isArray(warnings)) return [];
  return warnings.filter(text => typeof text === 'string' && text.trim()).slice(0, 50).map(text => text.trim().slice(0, 300));
}

function reportJSONFromSnapshot(snapshot, submission) {
  return {
    id: snapshot.id ?? submission.visit_id,
    submissionId: submission.submission_id,
    orderNumber: snapshot.orderNumber,
    scheduledDate: snapshot.scheduledDate,
    scheduledTime: snapshot.scheduledTime,
    status: snapshot.status ?? submission.terminal_intent,
    completedAt: snapshot.completedAt,
    technicianId: submission.technician_id,
    technicianName: snapshot.technicianName,
    propertyId: snapshot.propertyId,
    totalPrice: snapshot.totalPrice,
    hasMultipleSystems: snapshot.hasMultipleSystems,
    address: snapshot.address,
    systems: snapshot.systems,
    services: snapshot.services,
    items: snapshot.items,
    photos: snapshot.photos,
    weighInData: snapshot.weighInData,
    priceDiscrepancies: snapshot.priceDiscrepancies ?? [],
    notes: snapshot.notes ?? '',
    checklistAnswers: snapshot.checklistAnswers ?? [],
    weighInWarnings: snapshot.weighInWarnings ?? [],
    workType: snapshot.workType,
    generatedAt: snapshot.generatedAt ?? snapshot.createdAt,
    acceptedAt: submission.accepted_at,
  };
}

function getSubmittedValue(object, ...keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(object ?? {}, key)) return object[key];
  }
  return undefined;
}

function sameReportNumber(submitted, accepted) {
  return Number.isFinite(Number(submitted)) && Number.isFinite(Number(accepted))
    && Math.abs(Number(submitted) - Number(accepted)) <= 0.005;
}

// Compares a submitted snapshot with the Report the server derived from it.
// PP-01: catalog-derived values (service and item prices, tech_supplied, the
// total) that differ are accepted and returned as discrepancies, keeping both
// values. Any other difference is a mismatch: it rejects the Report and names
// the field.
function compareSubmission(submitted, accepted) {
  const mismatches = [];
  const discrepancies = [];
  const same = (value, expected) => (typeof expected === 'number'
    ? sameReportNumber(value, expected)
    : value === expected);

  const exactFields = [
    ['orderNumber', accepted.orderNumber],
    ['scheduledDate', accepted.scheduledDate],
    ['scheduledTime', accepted.scheduledTime],
    ['propertyId', accepted.propertyId],
    ['workType', accepted.workType],
    ['hasMultipleSystems', accepted.hasMultipleSystems],
    ['terminalIntent', accepted.terminalIntent],
  ];
  for (const [key, expected] of exactFields) if (submitted[key] !== expected) mismatches.push(key);
  if (!sameReportNumber(submitted.totalPrice, accepted.totalPrice)) {
    discrepancies.push({ field: 'totalPrice', submitted: submitted.totalPrice ?? null, accepted: accepted.totalPrice ?? null });
  }

  const addressFields = ['street', 'city', 'state', 'zip', 'subdivision', 'builder'];
  if (!submitted.address) mismatches.push('address');
  else {
    for (const field of addressFields) {
      if (!Object.prototype.hasOwnProperty.call(submitted.address, field)
          || submitted.address[field] !== accepted.address?.[field]) mismatches.push(`address.${field}`);
    }
  }

  // keyFields must match (they identify each row); valueFields may differ as
  // discrepancies. `label` names the row in a discrepancy.
  const compareRows = (name, suppliedRows, acceptedRows, keyFields, { valueFields = [], aliases = {}, label } = {}) => {
    if (!Array.isArray(suppliedRows) || suppliedRows.length !== acceptedRows.length) {
      mismatches.push(name);
      return;
    }
    const read = (row, field) => getSubmittedValue(row, ...(aliases[field] ?? [field]));
    const sortKey = (row, reader) => keyFields.map(field => String(reader(row, field) ?? '')).join('\u0000');
    const supplied = [...suppliedRows].sort((a, b) => sortKey(a, read).localeCompare(sortKey(b, read)));
    const expected = [...acceptedRows].sort((a, b) => sortKey(a, (row, f) => row[f]).localeCompare(sortKey(b, (row, f) => row[f])));
    supplied.forEach((row, index) => {
      const acceptedRow = expected[index];
      for (const field of keyFields) {
        if (!same(read(row, field), acceptedRow[field])) mismatches.push(`${name}.${field}`);
      }
      for (const field of valueFields) {
        const value = read(row, field);
        if (!same(value, acceptedRow[field])) {
          discrepancies.push({ field: `${name}.${field}`, row: label?.(acceptedRow) ?? null, submitted: value ?? null, accepted: acceptedRow[field] ?? null });
        }
      }
    });
  };

  if (Array.isArray(submitted.services)) {
    // Per-system snapshot: one row per system, or a lone call-wide Drive Run.
    compareRows('services', submitted.services, accepted.services ?? [],
      ['systemNumber', 'serviceName', 'isFinish', 'isTemporarily'],
      { valueFields: ['price'], label: row => (row.systemNumber == null ? row.serviceName : `System ${row.systemNumber} ${row.serviceName}`) });
  } else {
    const acceptedService = accepted.services?.[0];
    const submittedService = submitted.service;
    if (!acceptedService || !submittedService || (accepted.services ?? []).length !== 1) mismatches.push('service');
    else {
      if (submittedService.serviceName !== acceptedService.serviceName) mismatches.push('service.serviceName');
      if (getSubmittedValue(submittedService, 'isFinish', 'is_finish', 'finish') !== acceptedService.isFinish) mismatches.push('service.isFinish');
      if (getSubmittedValue(submittedService, 'isTemporarily', 'is_temporarily', 'temporarily') !== acceptedService.isTemporarily) mismatches.push('service.isTemporarily');
      if (!sameReportNumber(submittedService.price, acceptedService.price)) {
        discrepancies.push({ field: 'service.price', row: acceptedService.serviceName, submitted: submittedService.price ?? null, accepted: acceptedService.price ?? null });
      }
    }
  }

  compareRows('items', submitted.items, accepted.items ?? [],
    ['itemName', 'category', 'description', 'quantity'],
    {
      valueFields: ['price', 'techSupplied'],
      aliases: { itemName: ['itemName', 'item_name'], techSupplied: ['techSupplied', 'tech_supplied'] },
      label: row => row.itemName,
    });

  compareRows('systems', submitted.systems, accepted.systems ?? [],
    ['systemNumber', 'indoorModel', 'outdoorModel', 'coilModel', 'refrigerant'],
    {
      aliases: {
        systemNumber: ['systemNumber', 'system_number'],
        indoorModel: ['indoorModel', 'indoor_model'],
        outdoorModel: ['outdoorModel', 'outdoor_model'],
        coilModel: ['coilModel', 'coil_model'],
      },
    });

  const weighInFields = [
    'systemNumber', 'linesetLength', 'factoryChargeOz', 'factoryLineConfig',
    'approxAdjustOz', 'adjustedOz', 'fanSpeedCfm', 'liquidLineTemp',
    'suctionLineTemp', 'condenserSatTemp', 'subcoolingValue',
    'oemSubcoolingGoal', 'subcoolingDeviation',
  ];
  compareRows('weighInData', submitted.weighInData, accepted.weighInData ?? [], weighInFields, {
    aliases: Object.fromEntries(weighInFields.map(field => [
      field, [field, field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)],
    ])),
  });

  if (typeof submitted.notes !== 'string'
      || submitted.notes.trim() !== String(accepted.notes ?? '').trim()) mismatches.push('notes');
  const reportFindings = answers => Array.isArray(answers)
    ? answers
      .filter(answer => answer.answer === 'no' && typeof answer.reportText === 'string' && answer.reportText.trim())
      .map(answer => answer.reportText.trim())
    : null;
  if (!Array.isArray(submitted.checklistAnswers)
      || !isDeepStrictEqual(reportFindings(submitted.checklistAnswers), reportFindings(accepted.checklistAnswers))) mismatches.push('checklistAnswers');

  const acceptedEvidence = (accepted.photoEvidence ?? []).map(photo => ({
    id: photo.id,
    slug: photo.slug,
    tag: photo.tag,
    label: photo.label,
    category: photo.category,
    systemNumber: photo.system_number,
    storedAt: photo.stored_at,
  }));
  // storedAt is not compared: a photo may reach the server after its Report.
  compareRows('evidenceRefs', submitted.evidenceRefs, acceptedEvidence,
    ['id', 'slug', 'tag', 'label', 'category', 'systemNumber']);

  return { mismatches: [...new Set(mismatches)], discrepancies };
}

function reportContentMatchesSubmission(submitted, accepted) {
  return compareSubmission(submitted, accepted).mismatches.length === 0;
}

async function findAcceptedSubmission(db, visitId) {
  const result = await db.query(
    `SELECT submission_id, visit_id, technician_id, terminal_intent, snapshot, accepted_at
     FROM completion_submissions WHERE visit_id = $1`,
    [visitId]
  );
  if (result.rows.length > 1) {
    throw new Error(`Multiple accepted submissions found for visit ${visitId}`);
  }
  return result.rows[0] ?? null;
}

function reportTextFromSnapshot(snapshot) {
  const isCancelled = snapshot.status === 'cancelled';
  const checklistFindings = (snapshot.checklistAnswers ?? [])
    .filter(answer => answer.answer === 'no' && typeof answer.reportText === 'string' && answer.reportText.trim())
    .map(answer => answer.reportText.trim());
  const noteParts = [snapshot.notes?.trim(), ...checklistFindings].filter(Boolean);
  const services = snapshot.services ?? [];
  const systemCount = (snapshot.systems ?? []).length;
  const items = isCancelled ? [] : (snapshot.items ?? []);
  const thermostatItems = items.filter(item => item.category === 'thermostat');
  const thermostatText = thermostatItems
    .map(item => `${item.quantity} ${item.itemName} tstat${item.quantity === 1 ? '' : 's'}`)
    .join(', ');
  const accessoryItems = items.filter(item => item.category === 'accessory');
  const fixItems = items.filter(item => item.category === 'fix');
  const parts = [snapshot.address?.street?.trim()];

  if (noteParts.length) parts.push(noteParts.join(' | '));
  parts.push(...serviceParts(services, systemCount, thermostatText, isCancelled));
  parts.push(...accessoryItems.map(formatItem).filter(Boolean));
  parts.push(...fixItems.map(formatItem).filter(Boolean));
  parts.push(`total $${formatPrice(snapshot.totalPrice)}`);
  return parts.filter(Boolean).join(', ');
}

async function generateReportJSON(db, visitId) {
  const accepted = await findAcceptedSubmission(db, visitId);
  if (!accepted) return generateLiveReportJSON(db, visitId);
  return reportJSONFromSnapshot(accepted.snapshot, accepted);
}

async function generateReportText(db, visitId) {
  const accepted = await findAcceptedSubmission(db, visitId);
  if (!accepted) return generateLiveReportText(db, visitId);
  return reportTextFromSnapshot(accepted.snapshot);
}

module.exports = {
  createCanonicalReportSnapshot,
  findAcceptedSubmission,
  compareSubmission,
  reportContentMatchesSubmission,
  generateReportText,
  generateReportJSON,
};
