const FINISH_SERVICE_NAMES = new Set(['AC', 'Heat', 'AC & Heat']);
const WEIGHT_IN_DATA = 'Weight-In-Data';

function resolveServicePrice(serviceName, isFinish, basePrice) {
  if (isFinish && FINISH_SERVICE_NAMES.has(serviceName)) return 20;
  return basePrice ?? 0;
}

function resolveWeightInDataPrice(defaultPrice, finishAddonPrice, isFinish) {
  return (defaultPrice ?? 0) + (isFinish ? (finishAddonPrice ?? 0) : 0);
}

async function syncWeightInDataPrice(db, visitId, isFinish) {
  const itemsRes = await db.query(
    `SELECT vi.id, ci.default_price, ci.finish_addon_price
     FROM visit_items vi
     JOIN catalog_items ci ON ci.item_name = vi.item_name
     WHERE vi.visit_id = $1 AND vi.item_name = $2`,
    [visitId, WEIGHT_IN_DATA]
  );
  for (const item of itemsRes.rows) {
    await db.query(
      'UPDATE visit_items SET price = $1 WHERE id = $2',
      [resolveWeightInDataPrice(item.default_price, item.finish_addon_price, isFinish), item.id]
    );
  }
}

async function calculateVisitPrice(db, visitId) {
  const servicesRes = await db.query(
    `SELECT vs.service_name, vs.is_finish, vs.price, vs.system_number,
            cs.multiplies_by_system_count
     FROM visit_services vs
     JOIN catalog_services cs ON cs.service_name = vs.service_name
     WHERE vs.visit_id = $1`,
    [visitId]
  );
  const itemsRes = await db.query(
    `SELECT vi.item_name, vi.price AS stored_price,
            ci.default_price, ci.multiplies_by_system_count,
            ci.custom_price, ci.finish_addon_price
     FROM visit_items vi
     JOIN catalog_items ci ON ci.item_name = vi.item_name
     WHERE vi.visit_id = $1`,
    [visitId]
  );
  const systemsRes = await db.query(
    `SELECT COUNT(*)::int AS cnt FROM visit_systems WHERE visit_id = $1`,
    [visitId]
  );
  const visitRes = await db.query(
    `SELECT technician_id FROM visits WHERE id = $1`,
    [visitId]
  );

  if (servicesRes.rows.some(r => r.service_name === 'Cancel')) return 0;

  const systemCount = systemsRes.rows[0].cnt || 1;
  const techId = visitRes.rows[0]?.technician_id;

  const overridesMap = new Map();
  if (techId) {
    const ovRes = await db.query(
      `SELECT item_name, override_price FROM technician_price_overrides WHERE technician_id = $1`,
      [techId]
    );
    ovRes.rows.forEach(r => overridesMap.set(r.item_name, r.override_price));
  }

  const hasFinish = servicesRes.rows.some(r => r.is_finish);
  // Per-system rows are each charged on their own; a visit-level row keeps the
  // system-count multiplier. With per-system rows, Weight-In-Data follows Finish
  // per system ($10 base, +$10 addon on each system with Finish).
  const systemRows = servicesRes.rows.filter(r => r.system_number != null);
  const finishSystems = systemRows.filter(r => r.is_finish).length;

  let serviceTotal = 0;
  for (const s of servicesRes.rows) {
    let price = s.price ?? 0;
    if (s.system_number == null && !s.is_finish && s.multiplies_by_system_count) price *= systemCount;
    serviceTotal += price;
  }

  let finishAddonTotal = 0;
  if (hasFinish) {
    for (const item of itemsRes.rows) {
      if (item.item_name !== WEIGHT_IN_DATA && item.finish_addon_price != null) {
        finishAddonTotal += item.finish_addon_price;
      }
    }
  }

  let itemTotal = 0;
  for (const item of itemsRes.rows) {
    if (item.item_name === WEIGHT_IN_DATA && systemRows.length) {
      itemTotal += (item.default_price ?? 0) * systemCount + (item.finish_addon_price ?? 0) * finishSystems;
      continue;
    }
    let price;
    if (item.item_name === WEIGHT_IN_DATA || item.custom_price) {
      price = item.stored_price ?? 0;
    } else if (overridesMap.has(item.item_name)) {
      price = overridesMap.get(item.item_name);
    } else {
      price = item.default_price ?? 0;
    }
    if (item.multiplies_by_system_count) price = (price ?? 0) * systemCount;
    itemTotal += price ?? 0;
  }

  return serviceTotal + itemTotal + finishAddonTotal;
}

async function resolveCompanionCascade(db, visitId, itemName, mode) {
  const relRes = await db.query(
    `SELECT related_item_name FROM catalog_item_relations
     WHERE item_name = $1 AND relation_type = 'companion'`,
    [itemName]
  );
  const companions = relRes.rows.map(r => r.related_item_name);
  if (companions.length === 0) return [];

  if (mode === 'remove') {
    const existingRes = await db.query(
      `SELECT item_name FROM visit_items WHERE visit_id = $1 AND item_name = ANY($2)`,
      [visitId, companions]
    );
    const actualCompanions = existingRes.rows.map(r => r.item_name);

    if (actualCompanions.length > 0) {
      await db.query(
        `DELETE FROM visit_items WHERE visit_id = $1 AND item_name = ANY($2)`,
        [visitId, actualCompanions]
      );
    }
    return actualCompanions;
  }

  const added = [];
  for (const name of companions) {
    const existing = await db.query(
      `SELECT id FROM visit_items WHERE visit_id = $1 AND item_name = $2`,
      [visitId, name]
    );
    if (existing.rows.length > 0) continue;
    const cat = await db.query(
      `SELECT default_price, tech_supplied, category FROM catalog_items WHERE item_name = $1`,
      [name]
    );
    if (cat.rows.length === 0) continue;
    const c = cat.rows[0];
    await db.query(
      `INSERT INTO visit_items (id, visit_id, item_name, category, quantity, price, tech_supplied)
       VALUES (gen_random_uuid()::text, $1, $2, $3, 1, $4, $5)`,
      [visitId, name, c.category, c.default_price ?? 0, c.tech_supplied]
    );
    added.push(name);
  }
  return added;
}

module.exports = {
  calculateVisitPrice,
  resolveCompanionCascade,
  resolveServicePrice,
  resolveWeightInDataPrice,
  syncWeightInDataPrice,
};
