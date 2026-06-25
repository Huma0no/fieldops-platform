async function calculateVisitPrice(db, visitId) {
  const [servicesRes, itemsRes, systemsRes, visitRes] = await Promise.all([
    db.query(
      `SELECT vs.service_name, vs.is_finish,
              cs.default_price, cs.multiplies_by_system_count
       FROM visit_services vs
       JOIN catalog_services cs ON cs.service_name = vs.service_name
       WHERE vs.visit_id = $1`,
      [visitId]
    ),
    db.query(
      `SELECT vi.item_name, vi.price AS stored_price,
              ci.default_price, ci.multiplies_by_system_count,
              ci.custom_price, ci.finish_addon_price
       FROM visit_items vi
       JOIN catalog_items ci ON ci.item_name = vi.item_name
       WHERE vi.visit_id = $1`,
      [visitId]
    ),
    db.query(
      `SELECT COUNT(*)::int AS cnt FROM visit_systems WHERE visit_id = $1`,
      [visitId]
    ),
    db.query(
      `SELECT technician_id FROM visits WHERE id = $1`,
      [visitId]
    ),
  ]);

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

  let serviceTotal = 0;
  for (const s of servicesRes.rows) {
    let price = s.default_price ?? 0;
    if (s.multiplies_by_system_count) price *= systemCount;
    serviceTotal += price;
  }

  let finishAddonTotal = 0;
  if (hasFinish) {
    for (const item of itemsRes.rows) {
      if (item.finish_addon_price != null) finishAddonTotal += item.finish_addon_price;
    }
  }

  let itemTotal = 0;
  for (const item of itemsRes.rows) {
    let price;
    if (item.custom_price) {
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

module.exports = { calculateVisitPrice };
