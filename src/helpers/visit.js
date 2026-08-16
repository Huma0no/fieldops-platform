class CatalogInputError extends Error {
  constructor(field, itemName, expectedCategory, actualCategory = null) {
    const detail = actualCategory
      ? `must be a ${expectedCategory} catalog item, but is a ${actualCategory}`
      : 'is not an existing catalog item';
    super(`Invalid ${field} "${itemName}": ${detail}`);
    this.status = 400;
  }
}

async function validateCatalogSelections(queryable, { thermostat, accessories }) {
  const resolvedAccessories = Array.isArray(accessories) ? accessories : [];
  const selections = [
    ...(thermostat ? [{ field: 'thermostat', itemName: thermostat, category: 'thermostat' }] : []),
    ...resolvedAccessories.map((itemName) => ({ field: 'accessory', itemName, category: 'accessory' })),
  ];
  const resolved = new Map();

  for (const selection of selections) {
    const result = await queryable.query(
      'SELECT item_name, category, default_price, tech_supplied FROM catalog_items WHERE item_name = $1',
      [selection.itemName]
    );
    const item = result.rows[0];
    if (!item || item.category !== selection.category) {
      throw new CatalogInputError(selection.field, selection.itemName, selection.category, item?.category);
    }
    resolved.set(`${selection.category}:${selection.itemName}`, item);
  }

  return { resolvedAccessories, resolved };
}

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
    const { resolvedAccessories, resolved } = await validateCatalogSelections(client, { thermostat, accessories });

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
      const cat = resolved.get(`thermostat:${thermostat}`);
      await client.query(
        `INSERT INTO visit_items (visit_id, item_name, category, quantity, price, tech_supplied)
         VALUES ($1, $2, 'thermostat', $3, $4, $5)`,
        [visitId, thermostat, resolvedThermostatQty, cat.default_price, cat.tech_supplied]
      );
    }

    for (const itemName of resolvedAccessories) {
      const cat = resolved.get(`accessory:${itemName}`);
      await client.query(
        `INSERT INTO visit_items (visit_id, item_name, category, quantity, price, tech_supplied)
         VALUES ($1, $2, 'accessory', $3, $4, $5)`,
        [visitId, itemName, systemList.length, cat.default_price, cat.tech_supplied]
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

module.exports = { createVisitWithSystems, validateCatalogSelections };
