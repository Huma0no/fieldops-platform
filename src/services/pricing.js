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

// The visit total, computed by the pricing module the PWA also uses
// (frontend/shared/pricing.mjs). resolveServicePrice and
// resolveWeightInDataPrice above repeat its two one-line rules for synchronous
// callers; tests/pricing-shared.test.js keeps them identical.
let pricingModule;
function sharedPricing() {
  pricingModule ??= import('../../frontend/shared/pricing.mjs');
  return pricingModule;
}

async function calculateVisitPrice(db, visitId) {
  const servicesRes = await db.query(
    'SELECT service_name, is_finish, is_temporarily, price, system_number FROM visit_services WHERE visit_id = $1',
    [visitId]
  );
  const itemsRes = await db.query(
    'SELECT item_name, category, description, quantity, price FROM visit_items WHERE visit_id = $1',
    [visitId]
  );
  const systemsRes = await db.query('SELECT COUNT(*)::int AS cnt FROM visit_systems WHERE visit_id = $1', [visitId]);
  const visitRes = await db.query('SELECT technician_id FROM visits WHERE id = $1', [visitId]);
  const catalogServicesRes = await db.query('SELECT * FROM catalog_services');
  const itemNames = [...new Set(itemsRes.rows.map(row => row.item_name))];
  const catalogItemsRes = await db.query('SELECT * FROM catalog_items WHERE item_name = ANY($1)', [itemNames]);
  const techId = visitRes.rows[0]?.technician_id;
  const overrides = {};
  if (techId) {
    const ovRes = await db.query(
      'SELECT item_name, override_price FROM technician_price_overrides WHERE technician_id = $1',
      [techId]
    );
    ovRes.rows.forEach(row => { overrides[row.item_name] = row.override_price; });
  }
  const { priceVisit } = await sharedPricing();
  return priceVisit({
    services: servicesRes.rows.map(row => ({
      systemNumber: row.system_number,
      serviceName: row.service_name,
      isFinish: row.is_finish,
      isTemporarily: row.is_temporarily,
      price: row.price,
    })),
    items: itemsRes.rows.map(row => ({
      itemName: row.item_name,
      category: row.category,
      description: row.description,
      quantity: row.quantity,
      price: row.price,
    })),
    systemCount: systemsRes.rows[0].cnt || 1,
    catalog: { services: catalogServicesRes.rows, items: catalogItemsRes.rows },
    overrides,
  }).total;
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
  sharedPricing,
  calculateVisitPrice,
  resolveCompanionCascade,
  resolveServicePrice,
  resolveWeightInDataPrice,
  syncWeightInDataPrice,
};
