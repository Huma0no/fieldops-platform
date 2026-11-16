/**
 * src/lib/guided-context.mjs
 * Builds the Guided module context from a FieldOps visit and keeps the
 * active call (last expanded My Calls card or open Workspace) on the device.
 * The context shape is defined in docs/fieldops/GUIDED-SPEC.md (Context).
 */

export const GUIDED_CONTEXT_KEY = 'guided:activeCall'
export const GUIDED_RETURN_KEY = 'guided:return'

const ZONE_BOARDS = ['UT3000', 'HZ322', 'Harmony']
const TERMINAL_STATUSES = new Set(['completed', 'temporarily', 'cancelled'])

export function guidedContextFromVisit (visit) {
  if (!visit?.id) return null
  const items = (visit._items ?? visit.items ?? []).map(item => ({
    name: item.item_name ?? item.itemName,
    category: item.category,
    quantity: Number(item.quantity ?? 1),
  }))
  const thermostats = items.filter(item => item.category === 'thermostat')
  const zones = thermostats.reduce((sum, item) => sum + (item.quantity > 0 ? item.quantity : 1), 0)
  const system = visit.systems?.[0] ?? {}
  return {
    visitId: visit.id,
    label: visit.address?.street ?? visit.orderNumber ?? visit.id,
    zones: zones || null,
    dapc: items.some(item => item.name === 'DAPC'),
    equipment: {
      board: ZONE_BOARDS.find(board => items.some(item => item.name === board)) ?? null,
      thermostat: thermostats[0]?.name ?? null,
    },
    models: {
      indoor: system.indoorModel ?? null,
      outdoor: system.outdoorModel ?? null,
      coil: system.coilModel ?? null,
    },
  }
}

export function pickableCalls (visits = []) {
  return visits
    .filter(visit => visit?.id && !TERMINAL_STATUSES.has(visit.status))
    .map(visit => ({ id: visit.id, label: visit.address?.street ?? visit.orderNumber ?? visit.id }))
}

export function readGuidedContext (storage) {
  try {
    const context = JSON.parse(storage.getItem(GUIDED_CONTEXT_KEY))
    return context?.visitId ? context : null
  } catch (_) {
    return null
  }
}

export function saveGuidedContext (storage, context) {
  try {
    if (context) storage.setItem(GUIDED_CONTEXT_KEY, JSON.stringify(context))
  } catch (_) {
    // Storage full or blocked: Guided falls back to the call picker.
  }
}
