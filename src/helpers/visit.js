async function createVisitWithSystems(pool, { addressId, batchId, orderNumber, scheduledTime, workType, systemCount, notes }) {
  const now = new Date().toISOString();
  const count = systemCount || 1;
  const hasMultipleSystems = count > 1;
  const date = scheduledTime ? scheduledTime.slice(0, 10) : null;

  const visitResult = await pool.query(
    `INSERT INTO visits
       (id, address_id, batch_id, order_number, status, has_multiple_systems, is_deferred,
        scheduled_time, date, work_type, notes, created_at, updated_at)
     VALUES (gen_random_uuid()::text, $1, $2, $3, 'pending_review', $4, false,
             $5, $6, $7, $8, $9, $9)
     RETURNING id`,
    [addressId, batchId || null, orderNumber || null, hasMultipleSystems,
     scheduledTime || null, date, workType || null, notes || null, now]
  );

  const visitId = visitResult.rows[0].id;

  for (let i = 1; i <= count; i++) {
    await pool.query(
      `INSERT INTO visit_systems (id, visit_id, system_number)
       VALUES (gen_random_uuid()::text, $1, $2)`,
      [visitId, i]
    );
  }

  return { visitId };
}

module.exports = { createVisitWithSystems };
