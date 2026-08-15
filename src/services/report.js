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

  const temporarily = service.is_temporarily ? ' (Temporarily)' : '';
  const serviceText = {
    AC: `AC${temporarily} started`,
    Heat: `Heat${temporarily} started`,
    'AC & Heat': `AC & Heat${temporarily} started`,
    Prestart: 'System Prestarted',
    'Drive Run': 'Drive Run',
    Cancel: 'service canceled',
  }[service.service_name];
  if (!serviceText) return null;

  const hasAcOrHeat = ['AC', 'Heat', 'AC & Heat'].includes(service.service_name);
  const prefix = service.is_finish && hasAcOrHeat ? 'Finish/ ' : '';
  const systemSuffix = service.service_name !== 'Cancel' && systemCount > 1
    ? ` (${systemCount} Systems)`
    : '';
  return `${prefix}${serviceText}${systemSuffix} $${formatPrice(service.price)}`;
}

function formatItem(item) {
  const text = (item.item_name === 'Other' || item.item_name === 'Other Fix')
    ? item.description
    : ITEM_REPORT_TEXT[item.item_name] ?? item.item_name;
  if (!text) return null;
  const quantity = item.quantity > 1 ? `${item.quantity} ` : '';
  return `${quantity}${text} $${formatPrice(item.price)}`;
}

async function generateReportText(db, visitId) {
  const [visitRow, serviceRows, systemRows, itemRows] = await Promise.all([
    db.query(
      `SELECT v.status, v.total_price, v.notes, v.checklist_answers, a.street
       FROM visits v
       JOIN addresses a ON a.id = v.address_id
       WHERE v.id = $1`,
      [visitId]
    ),
    db.query(
      `SELECT service_name, is_finish, is_temporarily, price
       FROM visit_services
       WHERE visit_id = $1
       ORDER BY id`,
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
  const service = serviceRows.rows[0];
  const systemCount = systemRows.rows[0].count;
  const checklistFindings = (visit.checklist_answers ?? [])
    .filter(answer => answer.answer === 'no' && typeof answer.reportText === 'string' && answer.reportText.trim())
    .map(answer => answer.reportText.trim());
  const noteParts = [visit.notes?.trim(), ...checklistFindings].filter(Boolean);
  const thermostatItems = itemRows.rows.filter(item => item.category === 'thermostat');
  const thermostatText = thermostatItems
    .map(item => `${item.quantity} ${item.item_name} tstat${item.quantity === 1 ? '' : 's'}`)
    .join(', ');
  const accessoryItems = itemRows.rows.filter(item => item.category === 'accessory');
  const fixItems = itemRows.rows.filter(item => item.category === 'fix');
  const serviceText = visit.status === 'cancelled'
    ? 'service canceled $0'
    : formatService(service, systemCount);
  const parts = [visit.street?.trim()];

  if (noteParts.length) parts.push(noteParts.join(' | '));
  if (service?.is_finish && !['AC', 'Heat', 'AC & Heat'].includes(service.service_name)) {
    parts.push('Finish/');
  }
  if (serviceText) {
    parts.push(thermostatText ? serviceText.replace(/ \$[^ ]+$/, ` ${thermostatText}$&`) : serviceText);
  } else if (thermostatText) {
    parts.push(thermostatText);
  }
  parts.push(...accessoryItems.map(formatItem).filter(Boolean));
  parts.push(...fixItems.map(formatItem).filter(Boolean));
  parts.push(`total $${formatPrice(visit.total_price)}`);

  return parts.filter(Boolean).join(', ');
}

async function generateReportJSON(db, visitId) {
  const visitRow = await db.query(
    `SELECT v.id, v.order_number, v.scheduled_time, v.status, v.technician_id,
            v.has_multiple_systems, v.total_price, v.completed_at,
            v.address_id,
            a.street, a.city, a.state, a.zip, a.subdivision, a.builder
     FROM visits v
     JOIN addresses a ON a.id = v.address_id
     WHERE v.id = $1`,
    [visitId]
  );
  const v = visitRow.rows[0];

  const [systems, services, items, photos, weighIn] = await Promise.all([
    db.query(
      'SELECT system_number, indoor_model, outdoor_model, refrigerant FROM visit_systems WHERE visit_id = $1 ORDER BY system_number',
      [visitId]
    ),
    db.query(
      'SELECT service_name, is_finish, is_temporarily, price FROM visit_services WHERE visit_id = $1',
      [visitId]
    ),
    db.query(
      'SELECT item_name, category, description, quantity, price, tech_supplied FROM visit_items WHERE visit_id = $1',
      [visitId]
    ),
    db.query(
      'SELECT slug FROM visit_photos WHERE visit_id = $1',
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
    scheduledTime: v.scheduled_time,
    status: v.status,
    completedAt: v.completed_at,
    technicianId: v.technician_id,
    totalPrice: v.total_price,
    hasMultipleSystems: v.has_multiple_systems,
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
      refrigerant: s.refrigerant,
    })),
    services: services.rows.map((s) => ({
      serviceName: s.service_name,
      isFinish: s.is_finish,
      isTemporarily: s.is_temporarily,
      price: s.price,
    })),
    items: items.rows.map((i) => ({
      itemName: i.item_name,
      description: i.description,
      category: i.category,
      quantity: i.quantity,
      price: i.price,
      techSupplied: i.tech_supplied,
    })),
    photos: photos.rows.map((p) => ({ slug: p.slug })),
    weighInData: weighIn.rows.map((w) => ({
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

module.exports = { generateReportText, generateReportJSON };
