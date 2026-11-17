// Visit pricing — the one implementation shared by the FieldOps Workspace
// (local-first, offline) and the server (recompute on Report submission).
// Rules: docs/shared/CATALOG.md and docs/fieldops/workspace/SERVICE-TSTAT-SPEC.md.

export const WEIGHT_IN_DATA = 'Weight-In-Data'
const FINISH_SERVICES = new Set(['AC', 'Heat', 'AC & Heat'])

export function resolveServicePrice (serviceName, isFinish, basePrice) {
  if (isFinish && FINISH_SERVICES.has(serviceName)) return 20
  return basePrice ?? 0
}

export function resolveWeightInDataPrice (defaultPrice, finishAddonPrice, isFinish) {
  return (defaultPrice ?? 0) + (isFinish ? (finishAddonPrice ?? 0) : 0)
}

// services: [{ systemNumber, serviceName, isFinish, isTemporarily }]
//   (one row per system, or a call-wide row with systemNumber null)
//   A row's price, when given, is the stored price and is kept; otherwise it
//   is resolved from the catalog (the PWA passes no prices).
// items: [{ itemName, category, quantity, description, price }]
//   price is read for custom-price items and, when given, for Weight-In-Data
//   (its stored Finish-resolved price); every other item uses the technician's
//   own price when one exists, otherwise the catalog price.
// catalog: { services: catalog_services rows, items: catalog_items rows }
// overrides: { [itemName]: technician's own price } — what the contractor
//   charges; it is both the line price and the price in the total.
// Returns the services and items with their resolved line prices (and the
// catalog tech_supplied of each item) plus the visit total.
export function priceVisit ({ services = [], items = [], systemCount = 1, catalog, overrides = {} }) {
  const serviceCatalog = new Map((catalog?.services ?? []).map(row => [row.service_name, row]))
  const itemCatalog = new Map((catalog?.items ?? []).map(row => [row.item_name, row]))
  const count = systemCount || 1

  const pricedServices = services.map(row => ({
    ...row,
    price: row.serviceName === 'Cancel'
      ? 0
      : (row.price != null
          ? Number(row.price)
          : resolveServicePrice(row.serviceName, row.isFinish, serviceCatalog.get(row.serviceName)?.default_price)),
  }))
  const anyFinish = pricedServices.some(row => row.isFinish)
  const pricedItems = items.map((item) => {
    const entry = itemCatalog.get(item.itemName)
    let price
    if (item.category === 'thermostat') price = entry?.default_price ?? null
    else if (entry?.custom_price) price = Number(item.price ?? 0)
    else if (item.itemName === WEIGHT_IN_DATA) {
      price = item.price != null
        ? Number(item.price)
        : resolveWeightInDataPrice(entry?.default_price, entry?.finish_addon_price, anyFinish)
    }
    else if (Object.prototype.hasOwnProperty.call(overrides, item.itemName)) price = overrides[item.itemName]
    else price = entry?.default_price ?? 0
    return { ...item, price, techSupplied: entry?.tech_supplied ?? false }
  })

  if (pricedServices.some(row => row.serviceName === 'Cancel')) {
    return { services: pricedServices, items: pricedItems, total: 0 }
  }

  // Per-system rows are each charged on their own; a call-wide row keeps the
  // system-count multiplier. With per-system rows, Weight-In-Data follows
  // Finish per system ($10 base, +$10 addon on each system with Finish).
  const systemRows = pricedServices.filter(row => row.systemNumber != null)
  const finishSystems = systemRows.filter(row => row.isFinish).length

  let total = 0
  for (const row of pricedServices) {
    let price = row.price
    if (row.systemNumber == null && !row.isFinish && serviceCatalog.get(row.serviceName)?.multiplies_by_system_count) price *= count
    total += price
  }
  for (const item of pricedItems) {
    const entry = itemCatalog.get(item.itemName)
    if (item.itemName === WEIGHT_IN_DATA && systemRows.length) {
      total += (entry?.default_price ?? 0) * count + (entry?.finish_addon_price ?? 0) * finishSystems
      continue
    }
    let price
    if (item.itemName === WEIGHT_IN_DATA || entry?.custom_price) price = item.price ?? 0
    else if (Object.prototype.hasOwnProperty.call(overrides, item.itemName)) price = overrides[item.itemName]
    else price = entry?.default_price ?? 0
    if (entry?.multiplies_by_system_count) price = (price ?? 0) * count
    total += price ?? 0
    if (anyFinish && item.itemName !== WEIGHT_IN_DATA && entry?.finish_addon_price != null) total += entry.finish_addon_price
  }
  return { services: pricedServices, items: pricedItems, total }
}
