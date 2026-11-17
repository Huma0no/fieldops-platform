// Report receipt (W4): one address per receipt, built from the completion
// snapshot the phone created — the same data for "Review before sending" and
// for Reports → View report, online or offline.
import { priceVisit, WEIGHT_IN_DATA } from '../../../shared/pricing.mjs'

const ITEM_LABELS = { [WEIGHT_IN_DATA]: 'Weigh-in' }
const GROUPS = [['thermostat', 'T-STAT'], ['accessory', 'ACCESSORIES'], ['fix', 'FIX']]

function serviceLabel (row, multiSystem) {
  const name = `${row.isFinish ? 'Finish/ ' : ''}${row.serviceName}${row.isTemporarily ? ' · Temporarily' : ''}`
  return row.systemNumber != null && multiSystem ? `${name} · System ${row.systemNumber}` : name
}

function itemLabel (item) {
  const name = item.description ?? ITEM_LABELS[item.itemName] ?? item.itemName
  return (item.quantity ?? 1) > 1 ? `${name} × ${item.quantity}` : name
}

function weight (oz) {
  const rounded = Math.round(oz)
  return `${Math.floor(rounded / 16)} lb ${rounded % 16} oz`
}

function weighInLine (row) {
  const parts = [`System ${row.systemNumber}`]
  if (row.linesetLength != null) parts.push(`${row.linesetLength} ft`)
  if (row.adjustedOz != null) parts.push(`+${row.adjustedOz} oz`)
  if (row.factoryChargeOz != null && row.adjustedOz != null) parts.push(`total ${weight(Number(row.factoryChargeOz) + Number(row.adjustedOz))}`)
  return parts.join(' · ')
}

// PP-01 price corrections, keyed like the server labels its discrepancy rows.
function adjustedPrices (discrepancies, field) {
  return new Map((discrepancies ?? [])
    .filter(entry => entry.field === field)
    .map(entry => [entry.row, entry.submitted]))
}

// source: the phone's completion snapshot, or the server's report JSON (same
// field names) whose prices include PP-01 corrections.
// catalog: { services, items } from the device cache (row flags: system-count
// multiplier, Finish add-on). Line prices are the source's own (CC-08).
// Lines the office re-priced carry `adjustedFrom` (the technician's price).
export function receiptModel (snapshot, { catalog = { services: [], items: [] }, technicianName = null } = {}) {
  const serviceAdjusted = adjustedPrices(snapshot.priceDiscrepancies, 'services.price')
  const itemAdjusted = adjustedPrices(snapshot.priceDiscrepancies, 'items.price')
  const multiSystem = (snapshot.systems ?? []).length > 1 || snapshot.hasMultipleSystems === true
  const items = (snapshot.items ?? []).map(item => ({ ...item, itemName: item.itemName ?? item.item_name }))
  const overrides = Object.fromEntries(items.filter(item => item.price != null).map(item => [item.itemName, Number(item.price)]))
  const priced = priceVisit({
    services: snapshot.services ?? [],
    items,
    systemCount: Math.max(1, (snapshot.systems ?? []).length),
    catalog,
    overrides,
  })

  const groups = []
  const mark = (line, adjusted, key) => (adjusted.has(key) ? { ...line, adjustedFrom: adjusted.get(key) } : line)
  const services = (snapshot.services ?? []).map((row, i) => mark(
    { label: serviceLabel(row, multiSystem), amount: priced.amounts.services[i] },
    serviceAdjusted,
    row.systemNumber == null ? row.serviceName : `System ${row.systemNumber} ${row.serviceName}`,
  ))
  if (services.length) groups.push({ title: 'SERVICE', lines: services })
  for (const [category, title] of GROUPS) {
    const lines = items
      .map((item, i) => ({ item, amount: priced.amounts.items[i] }))
      .filter(({ item }) => item.category === category)
      .map(({ item, amount }) => mark({ label: itemLabel(item), amount }, itemAdjusted, item.itemName))
    if (lines.length) groups.push({ title, lines })
  }

  const address = snapshot.address ?? {}
  return {
    street: address.street ?? '',
    place: [address.subdivision, address.builder].filter(Boolean).join(' · '),
    date: snapshot.createdAt ?? snapshot.generatedAt ?? snapshot.completedAt ?? null,
    technicianName: technicianName ?? snapshot.technicianName ?? null,
    groups,
    weighIn: (snapshot.weighInData ?? []).map(weighInLine),
    checklist: (snapshot.checklistAnswers ?? [])
      .filter(answer => answer.answer === 'no')
      .map(answer => answer.reportText ?? answer.item),
    notes: snapshot.notes ?? '',
    total: Number(snapshot.totalPrice ?? 0),
    totalAdjustedFrom: (snapshot.priceDiscrepancies ?? []).find(entry => entry.field === 'totalPrice')?.submitted,
  }
}
