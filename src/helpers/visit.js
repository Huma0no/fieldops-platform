async function createVisitWithSystems(pool, { addressId, batchId, orderNumber, scheduledTime, workType, systemCount, notes, systems, isPriority }) {
  const now = new Date().toISOString();
  const systemList = (systems && systems.length > 0)
    ? systems
    : Array.from({ length: systemCount || 1 }, () => ({}));
  const hasMultipleSystems = systemList.length > 1;
  const date = scheduledTime ? scheduledTime.slice(0, 10) : null;

  const visitResult = await pool.query(
    `INSERT INTO visits
       (id, address_id, batch_id, order_number, status, has_multiple_systems, is_deferred,
        scheduled_time, date, work_type, notes, is_priority, created_at, updated_at)
     VALUES (gen_random_uuid()::text, $1, $2, $3, 'pending_review', $4, false,
             $5, $6, $7, $8, $9, $10, $10)
     RETURNING id`,
    [addressId, batchId || null, orderNumber || null, hasMultipleSystems,
     scheduledTime || null, date, workType || null, notes || null, isPriority || false, now]
  );

  const visitId = visitResult.rows[0].id;

  for (let i = 0; i < systemList.length; i++) {
    const sys = systemList[i];
    await pool.query(
      `INSERT INTO visit_systems (id, visit_id, system_number, indoor_model, outdoor_model, coil_model)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5)`,
      [visitId, i + 1, sys.indoorModel || null, sys.outdoorModel || null, sys.coilModel || null]
    );
  }

  return { visitId };
}

module.exports = { createVisitWithSystems };
