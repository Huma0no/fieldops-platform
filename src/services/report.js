async function generateReportText(db, visitId) {
  const [visitRow, serviceRows, systemRows] = await Promise.all([
    db.query(
      `SELECT v.order_number, v.total_price, v.completed_at,
              a.street, a.subdivision, a.builder
       FROM visits v
       JOIN addresses a ON a.id = v.address_id
       WHERE v.id = $1`,
      [visitId]
    ),
    db.query(
      'SELECT service_name, is_finish, is_temporarily FROM visit_services WHERE visit_id = $1',
      [visitId]
    ),
    db.query(
      'SELECT COUNT(*) AS count FROM visit_systems WHERE visit_id = $1',
      [visitId]
    ),
  ]);

  const v = visitRow.rows[0];
  const svc = serviceRows.rows[0] || {};
  const systemCount = parseInt(systemRows.rows[0].count, 10);

  return [
    v.order_number,
    v.street,
    v.subdivision,
    v.builder,
    svc.service_name,
    svc.is_finish,
    svc.is_temporarily,
    systemCount,
    v.total_price,
    v.completed_at,
  ].join(',');
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
      'SELECT item_name, category, quantity, price, tech_supplied FROM visit_items WHERE visit_id = $1',
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
