async function createVisitWithSystems(pool, { addressId, batchId, orderNumber, scheduledTime, workType, systemCount, notes, systems, isPriority, thermostat, thermostatQty, accessories }) {
  const now = new Date().toISOString();
  const systemList = (systems && systems.length > 0)
    ? systems
    : Array.from({ length: systemCount || 1 }, () => ({}));
  const hasMultipleSystems = systemList.length > 1;
  const date = scheduledTime ? scheduledTime.slice(0, 10) : null;
  const resolvedThermostatQty = (thermostatQty > 0) ? thermostatQty : 1;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const visitResult = await client.query(
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
      await client.query(
        `INSERT INTO visit_systems (id, visit_id, system_number, indoor_model, outdoor_model, coil_model)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5)`,
        [visitId, i + 1, sys.indoorModel || null, sys.outdoorModel || null, sys.coilModel || null]
      );
    }

    if (thermostat) {
      await client.query(
        `INSERT INTO catalog_items (item_name, category, default_price, tech_supplied)
         VALUES ($1, 'thermostat', 0, true) ON CONFLICT (item_name) DO NOTHING`,
        [thermostat]
      );
      const cat = await client.query(
        'SELECT default_price, tech_supplied FROM catalog_items WHERE item_name = $1',
        [thermostat]
      );
      await client.query(
        `INSERT INTO visit_items (visit_id, item_name, category, quantity, price, tech_supplied)
         VALUES ($1, $2, 'thermostat', $3, $4, $5)`,
        [visitId, thermostat, resolvedThermostatQty, cat.rows[0].default_price ?? 0, cat.rows[0].tech_supplied]
      );
    }

    const resolvedAccessories = Array.isArray(accessories) ? accessories : [];
    for (const itemName of resolvedAccessories) {
      await client.query(
        `INSERT INTO catalog_items (item_name, category, default_price, tech_supplied)
         VALUES ($1, 'accessory', 0, true) ON CONFLICT (item_name) DO NOTHING`,
        [itemName]
      );
      const cat = await client.query(
        'SELECT default_price, tech_supplied FROM catalog_items WHERE item_name = $1',
        [itemName]
      );
      await client.query(
        `INSERT INTO visit_items (visit_id, item_name, category, quantity, price, tech_supplied)
         VALUES ($1, $2, 'accessory', $3, $4, $5)`,
        [visitId, itemName, systemList.length, cat.rows[0].default_price ?? 0, cat.rows[0].tech_supplied]
      );
    }

    await client.query('COMMIT');
    return { visitId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createVisitWithSystems };
