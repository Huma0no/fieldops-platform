import { catalogCharge, linesetDefaults } from './lineset.mjs'

const ACTIVE_STATUSES = new Set(['assigned', 'in_progress'])

// A deferred call is still assigned; once finished, deferral never keeps it (FT-03).
function isActiveVisit (visit) {
  return ACTIVE_STATUSES.has(visit?.status)
}

export function shouldShowMyCallsLoadError (remoteError, visits = []) {
  return Boolean(remoteError) && !visits.some(isActiveVisit)
}

// Converts durable Local Visit Drafts into the My Calls card shape: the
// server's /visits/mine fields (camelCase), so one card reads both (Day 2).
// Server records win whenever available; this only enables offline recovery.
export function localDraftVisits (drafts = [], completionSubmissions = []) {
  const finalizedVisitIds = new Set(
    completionSubmissions
      .filter(entry => entry.lifecycle === 'pending' || entry.lifecycle === 'delivered')
      .map(entry => entry.visitId)
  )

  return drafts
    .filter(draft => !finalizedVisitIds.has(draft.id))
    .map(draft => ({
      id: draft.id,
      status: draft.status ?? draft.serverStatus ?? 'assigned',
      address: draft.address,
      scheduledTime: draft.scheduledTime,
      workType: draft.workType,
      items: draft._items,
      totalPrice: draft.totalPrice,
      isDeferred: draft.isDeferred,
      hasMultipleSystems: draft.hasMultipleSystems,
      systems: draft.systems,
      orderNumber: draft.orderNumber,
    }))
    .filter(isActiveVisit)
}

// Server records win whenever available; the local cache only fills gaps while
// offline and never creates a duplicate card for the same visit.
export function mergeMyCallsVisits (serverVisits = [], localVisits = []) {
  const known = new Set(serverVisits.map(visit => visit.id))
  return [...serverVisits, ...localVisits.filter(visit => !known.has(visit.id))]
}

// The My Calls list, rebuilt from its sources on every refresh (Day 2): the
// server's active calls (null when unreachable) plus the phone's downloaded
// calls. A call whose Report is generated and still queued on the phone
// leaves the list at once, even though the server still lists it.
export function myCallsList ({ serverVisits = null, localVisits = [], completionSubmissions = [] } = {}) {
  const queued = new Set(completionSubmissions
    .filter(entry => entry.lifecycle === 'pending')
    .map(entry => entry.visitId))
  return mergeMyCallsVisits(serverVisits ?? [], localVisits)
    .filter(visit => isActiveVisit(visit) && !queued.has(visit.id))
}

// Deferred calls first, then by scheduled time; a call without a time last.
export function sortMyCalls (visits = []) {
  const at = visit => {
    const time = visit.scheduledTime ? new Date(visit.scheduledTime).getTime() : NaN
    return Number.isNaN(time) ? Infinity : time
  }
  return [
    ...visits.filter(visit => visit.isDeferred),
    ...visits.filter(visit => !visit.isDeferred).sort((a, b) => (at(a) === at(b) ? 0 : at(a) < at(b) ? -1 : 1)),
  ]
}

export function localMyCallsVisits ({ drafts = [], cachedVisits = [], completionSubmissions = [] } = {}) {
  const draftsAsVisits = localDraftVisits(drafts, completionSubmissions)
  const finalizedVisitIds = new Set(
    completionSubmissions
      .filter(entry => entry.lifecycle === 'pending' || entry.lifecycle === 'delivered')
      .map(entry => entry.visitId)
  )
  return mergeMyCallsVisits(
    cachedVisits.filter(visit => !finalizedVisitIds.has(visit.id) && isActiveVisit(visit)),
    draftsAsVisits
  )
}

// Backwards-compatible name for focused callers while My Calls moves from
// draft-only recovery to durable downloaded-call recovery.
export function mergeLocalDraftVisits (visits = [], drafts = []) {
  const recovered = localDraftVisits(drafts)
  return mergeMyCallsVisits(visits, recovered)
}

const UNIT_TYPES = { condenser: 'Condenser', heat_pump: 'Heat pump', furnace: 'Furnace', air_handler: 'Air handler' }

// FT-03: the expanded My Calls card, from the server's visit detail or the
// Local Visit Draft (offline) plus the cached catalog. Briefing values with no
// data source today (over-charge threshold, subcooling, CFM max/min) are not
// built; catalog values missing for a model stay null.
export function myCallsBriefing (source = {}, { equipment = [], manufacturers = [], catalogItems = [] } = {}) {
  const items = (source._items ?? source.items ?? []).map(item => ({
    itemName: item.itemName ?? item.item_name,
    category: item.category,
    quantity: Number(item.quantity ?? 1),
  }))
  const labels = new Map(catalogItems.map(row => [row.item_name, row.label]))
  const chips = items
    .filter(item => item.category === 'thermostat' || item.category === 'accessory')
    .map(item => ({ label: labels.get(item.itemName) || item.itemName, quantity: item.quantity }))
  const systems = (source.systems ?? []).map(system => {
    const indoor = equipment.find(row => row.model === system.indoorModel)
    const outdoor = equipment.find(row => row.model === system.outdoorModel)
    const { manufacturer, factoryLengthFt, refrigerant } = linesetDefaults({ manufacturers, equipment, outdoorModel: system.outdoorModel })
    return {
      systemNumber: system.systemNumber,
      indoorModel: system.indoorModel ?? null,
      indoorType: UNIT_TYPES[indoor?.unit_type] ?? null,
      outdoorModel: system.outdoorModel ?? null,
      outdoorType: UNIT_TYPES[outdoor?.unit_type] ?? null,
      // Capacity of the outdoor unit; an indoor btu is heating input, not tons.
      tons: outdoor?.btu ? outdoor.btu / 12000 : null,
      refrigerant: system.refrigerant ?? refrigerant ?? null,
      factoryChargeOz: catalogCharge(equipment, system.outdoorModel, manufacturer, factoryLengthFt),
      esp: indoor?.pesp ?? null,
    }
  })
  return { workType: source.workType ?? null, notes: source.companyNotes ?? null, items, chips, systems }
}
