export const LOCAL_VISIT_DRAFT_SCHEMA_VERSION = 1

const CANCEL_CONFIRMED_VISIT_KEY = 'workspace:cancelConfirmedVisitId'
const LEGACY_CANCEL_CONFIRMED_KEY = 'workspace:cancelConfirmed'

// A pending My Calls confirmation belongs to exactly one visit. Never allow a
// session flag from visit A to turn visit B into Cancel mode.
export function consumeConfirmedCancelForVisit (storage, visitId) {
  if (storage.getItem(LEGACY_CANCEL_CONFIRMED_KEY) === 'true') {
    storage.removeItem(LEGACY_CANCEL_CONFIRMED_KEY)
  }
  if (storage.getItem(CANCEL_CONFIRMED_VISIT_KEY) !== visitId) return false
  storage.removeItem(CANCEL_CONFIRMED_VISIT_KEY)
  return true
}

// ── Service (per system) ────────────────────────────────────
// docs/fieldops/workspace/SERVICE-TSTAT-SPEC.md. `_service` holds a default
// selection that applies to every system, per-system overrides keyed by system
// number, call-wide Drive Run, and the rows (with prices) last confirmed by the
// server. A system's selection is { ac, heat, prestart, finish, temporarily }.

const SYSTEM_SERVICE_KEYS = ['ac', 'heat', 'prestart', 'finish', 'temporarily']

export function emptySystemService () {
  return { ac: false, heat: false, prestart: false, finish: false, temporarily: false }
}

function emptyServiceState () {
  return { default: emptySystemService(), overrides: {}, driveRun: false, cancel: false, rows: [] }
}

export function systemNumbersOf (visit) {
  const numbers = (visit?.systems ?? [])
    .map(system => Number(system?.systemNumber ?? system?.system_number))
    .filter(Number.isInteger)
  return numbers.length ? [...new Set(numbers)].sort((a, b) => a - b) : [1]
}

function systemServiceFromRow (row) {
  const name = row?.serviceName
  return {
    ac: name === 'AC' || name === 'AC & Heat',
    heat: name === 'Heat' || name === 'AC & Heat',
    prestart: name === 'Prestart',
    finish: name === 'Finish' || row?.isFinish === true,
    temporarily: row?.isTemporarily === true,
  }
}

function sameSystemService (a, b) {
  return SYSTEM_SERVICE_KEYS.every(key => Boolean(a?.[key]) === Boolean(b?.[key]))
}

// Builds the state from server rows (GET /visits/:id or PATCH /services). A
// system without a row stays empty instead of inheriting the default.
export function serviceStateFromRows (rows = [], systemNumbers = []) {
  const state = emptyServiceState()
  if (rows.some(row => row.serviceName === 'Cancel')) { state.cancel = true; return state }
  state.rows = rows.map(row => ({ ...row, systemNumber: row.systemNumber ?? null }))
  if (rows.some(row => row.serviceName === 'Drive Run')) { state.driveRun = true; return state }
  const perSystem = state.rows.filter(row => row.systemNumber != null)
    .sort((a, b) => a.systemNumber - b.systemNumber)
  if (!perSystem.length) {
    if (rows[0]) state.default = systemServiceFromRow(rows[0])
    return state
  }
  state.default = systemServiceFromRow(perSystem[0])
  for (const row of perSystem.slice(1)) {
    const selection = systemServiceFromRow(row)
    if (!sameSystemService(selection, state.default)) state.overrides[row.systemNumber] = selection
  }
  for (const number of systemNumbers) {
    if (!perSystem.some(row => row.systemNumber === number)) state.overrides[number] = emptySystemService()
  }
  return state
}

// Accepts the current shape or the single-service shape stored by earlier drafts.
export function normalizeServiceState (service) {
  if (service?.default) {
    return { ...emptyServiceState(), ...service, overrides: { ...(service.overrides ?? {}) }, rows: service.rows ?? [] }
  }
  const state = emptyServiceState()
  if (!service) return state
  state.cancel = service.cancel === true
  state.driveRun = service.driveRun === true
  if (!state.driveRun) {
    for (const key of SYSTEM_SERVICE_KEYS) state.default[key] = service[key] === true
  }
  return state
}

export function effectiveSystemService (service, systemNumber) {
  return service.overrides?.[systemNumber] ?? service.default
}

export function isCustomSystemService (service, systemNumber) {
  return Boolean(service.overrides?.[systemNumber])
}

export function systemServiceName (selection) {
  if (selection.ac && selection.heat) return 'AC & Heat'
  if (selection.ac) return 'AC'
  if (selection.heat) return 'Heat'
  if (selection.prestart) return 'Prestart'
  if (selection.finish) return 'Finish'
  return null
}

// AC and Heat combine; Prestart is exclusive; Temporarily needs AC or Heat;
// Finish combines with AC/Heat or stands alone.
function toggleSystemServiceKey (selection, key) {
  if (key === 'temporarily' && !selection.ac && !selection.heat) return selection
  const on = !selection[key]
  if (key === 'prestart') return Object.assign(selection, emptySystemService(), { prestart: on })
  selection[key] = on
  if (on) selection.prestart = false
  if (!selection.ac && !selection.heat) selection.temporarily = false
  return selection
}

// systemNumber null edits the default; a number edits (or creates) that
// system's override. Any service tap turns Drive Run off.
export function tapService (service, systemNumber, key) {
  service.driveRun = false
  if (systemNumber == null) {
    toggleSystemServiceKey(service.default, key)
  } else {
    const selection = { ...effectiveSystemService(service, systemNumber) }
    service.overrides[systemNumber] = toggleSystemServiceKey(selection, key)
  }
  return service
}

export function resetSystemService (service, systemNumber) {
  delete service.overrides[systemNumber]
  return service
}

export function setDriveRun (service, on) {
  if (on) {
    service.default = emptySystemService()
    service.overrides = {}
  }
  service.driveRun = on
  return service
}

export function hasServiceSelection (service, systemNumbers = [1]) {
  const state = normalizeServiceState(service)
  if (state.cancel || state.driveRun) return true
  return systemNumbers.some(number => systemServiceName(effectiveSystemService(state, number)))
}

export function missingServiceSystems (service, systemNumbers) {
  const state = normalizeServiceState(service)
  if (state.cancel || state.driveRun) return []
  return systemNumbers.filter(number => !systemServiceName(effectiveSystemService(state, number)))
}

// Rows for PATCH /services and the completion snapshot (prices added there).
export function serviceRowsFromState (service, systemNumbers) {
  const state = normalizeServiceState(service)
  if (state.driveRun) return [{ systemNumber: null, serviceName: 'Drive Run', isFinish: false, isTemporarily: false }]
  return systemNumbers.flatMap((number) => {
    const selection = effectiveSystemService(state, number)
    const serviceName = systemServiceName(selection)
    if (!serviceName) return []
    return [{
      systemNumber: number,
      serviceName,
      isFinish: selection.finish === true && serviceName !== 'Prestart',
      isTemporarily: selection.temporarily === true && (selection.ac || selection.heat),
    }]
  })
}

function markSelectionChanged (draft) {
  draft.dirty = true
  draft.localUpdatedAt = new Date().toISOString()
  draft.pricingStatus = 'pending'
  return draft
}

function localItemId () {
  if (globalThis.crypto?.randomUUID) return `local-${globalThis.crypto.randomUUID()}`
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function localItemFromCatalog (item, { quantity = 1, price, description = null } = {}) {
  return {
    id: localItemId(),
    item_name: item.item_name ?? item.itemName,
    category: item.category,
    description: description ?? null,
    quantity,
    price: price ?? item.default_price ?? 0,
    tech_supplied: item.tech_supplied ?? item.techSupplied ?? false,
  }
}

export function addLocalVisitDraftItem (draft, item, {
  quantity = 1,
  price,
  description = null,
  catalogItems = [],
  itemRelations = [],
} = {}) {
  const itemName = item.item_name ?? item.itemName
  const existing = draft._items ?? []
  const companions = itemRelations
    .filter(relation => relation.item_name === itemName && relation.relation_type === 'companion')
    .map(relation => relation.related_item_name)
  const excludedGroups = new Set(itemRelations
    .filter(relation => relation.item_name === itemName && relation.relation_type === 'exclusion_group')
    .map(relation => relation.exclusion_group_id)
    .filter(Boolean))
  const excludedNames = new Set(itemRelations
    .filter(relation => relation.relation_type === 'exclusion_group' && excludedGroups.has(relation.exclusion_group_id))
    .map(relation => relation.item_name))
  const excludedCompanions = new Set(itemRelations
    .filter(relation => excludedNames.has(relation.item_name) && relation.relation_type === 'companion')
    .map(relation => relation.related_item_name))
  const removedNames = new Set([...excludedNames, ...excludedCompanions])
  for (const companion of companions) removedNames.delete(companion)

  let retained = existing.filter(entry => !removedNames.has(entry.item_name))
  const selected = existing.find(entry => entry.item_name === itemName)
  if (selected) retained = retained.filter(entry => entry.item_name !== itemName)
  const newItems = [localItemFromCatalog(item, { quantity, price, description })]
  for (const companionName of companions) {
    if (retained.some(entry => entry.item_name === companionName)) continue
    const companionItem = catalogItems.find(entry => entry.item_name === companionName)
    if (companionItem) newItems.push(localItemFromCatalog(companionItem))
  }
  draft._items = [...retained, ...newItems]
  markSelectionChanged(draft)
  return { addedItems: newItems.map(entry => entry.item_name), removedItems: [...removedNames] }
}

export function removeLocalVisitDraftItem (draft, itemId, itemRelations = []) {
  const selected = (draft._items ?? []).find(item => item.id === itemId)
  if (!selected) return { removedItems: [] }
  const removedNames = new Set([
    selected.item_name,
    ...itemRelations
      .filter(relation => relation.item_name === selected.item_name && relation.relation_type === 'companion')
      .map(relation => relation.related_item_name),
  ])
  draft._items = (draft._items ?? []).filter(item => !removedNames.has(item.item_name))
  markSelectionChanged(draft)
  return { removedItems: [...removedNames] }
}

export function setLocalVisitDraftItemQuantity (draft, itemId, quantity) {
  const selected = (draft._items ?? []).find(item => item.id === itemId)
  const resolvedQuantity = Math.max(1, Math.floor(Number(quantity) || 1))
  if (!selected || selected.quantity === resolvedQuantity) return false
  selected.quantity = resolvedQuantity
  markSelectionChanged(draft)
  return true
}

// Cancel is a local draft mode until Generate Report is delivered. It clears
// work that cannot accompany a cancelled visit, while retaining the separate
// Notes and Checklist justification records.
export function enterLocalVisitDraftCancelMode (draft, now = new Date().toISOString()) {
  draft._service = { ...emptyServiceState(), cancel: true }
  draft._items = []
  draft._weighInData = []
  draft._weighInPhotos = {}
  draft._weighinDone = false
  draft.totalPrice = 0
  draft._cancelMode = { confirmed: true, confirmedAt: now }
  delete draft._cancelOriginated
  draft._activeStep = 'notes'
  return markLocalVisitDraftDirty(draft, now)
}

// This is the sole canonical Cancel marker. Empty work, a $0 total, and an
// empty Service selection are all valid non-Cancel draft states.
export function isConfirmedLocalVisitDraftCancelMode (draft) {
  return draft?._cancelMode?.confirmed === true
}

// My Calls derives this local-only state from durable drafts. It is deliberately
// keyed by visit ID so a pending Cancel for one visit cannot affect another.
export function confirmedLocalCancelVisitIds (drafts = []) {
  return new Set(
    drafts
      .filter(isConfirmedLocalVisitDraftCancelMode)
      .map(draft => draft.id)
  )
}

// Drafts created during the brief pre-marker implementation may have both the
// old origin flag and a local Cancel service. That pair is the only legacy
// state that can be migrated without treating an empty ordinary draft as
// Cancel. A lone _cancelOriginated flag is intentionally ignored.
export function migrateLegacyConfirmedCancelMode (draft) {
  if (isConfirmedLocalVisitDraftCancelMode(draft)) return false
  if (draft?._cancelOriginated === true && draft?._service?.cancel === true) {
    draft._cancelMode = { confirmed: true, confirmedAt: draft.localUpdatedAt ?? null, legacy: true }
    delete draft._cancelOriginated
    return true
  }
  return false
}

// Before the explicit confirmation marker, entering from My Calls wrote this
// origin flag before any confirmation. Discard that unconfirmed legacy signal
// so it cannot force a normal draft into Notes or Cancel mode on reopen.
export function discardLegacyUnconfirmedCancelOrigin (draft) {
  if (!isConfirmedLocalVisitDraftCancelMode(draft) &&
      draft?._cancelOriginated === true &&
      draft?._service?.cancel !== true) {
    delete draft._cancelOriginated
    draft._activeStep = 'service'
    return true
  }
  return false
}

function itemsFromDetail (items = []) {
  return items.map((item) => ({
    id: item.id,
    item_name: item.itemName,
    category: item.category,
    description: item.description ?? null,
    quantity: item.quantity ?? 1,
    price: item.category === 'thermostat' ? (item.price ?? null) : (item.price ?? 0),
    tech_supplied: item.techSupplied ?? false,
  }))
}

function evidenceFromDetail (photos = []) {
  const weighInPhotos = {}
  photos.forEach((photo) => {
    if ((photo.tag === 'SCALE' || photo.tag === 'FAN') && photo.systemNumber != null) {
      weighInPhotos[`${photo.systemNumber}-${photo.tag}`] = true
    }
  })
  return { refs: photos, weighInPhotos }
}

export function isLocalVisitDraft (record) {
  return record?.draftSchemaVersion === LOCAL_VISIT_DRAFT_SCHEMA_VERSION &&
    record.lifecycle === 'draft' &&
    typeof record.id === 'string' &&
    Array.isArray(record._items) &&
    record._items.every(item => typeof item?.id === 'string' && item.id.length > 0)
}

// Converts one server detail response into the single mutable Workspace model.
// Field names intentionally match existing Workspace consumers; no parallel view
// model is maintained alongside this draft.
// Call data comes from the office. Correct report (after a rejection) takes
// it from the server so a Report rejected for changed call details can be
// resent; the technician's work in the draft is kept.
export const REFRESH_CALL_DATA_KEY = 'workspace:refreshCallData'
export const CALL_DATA_FIELDS = ['address', 'orderNumber', 'scheduledDate', 'scheduledTime', 'workType', 'propertyId']

export function refreshCallData (draft, detail) {
  const refreshed = { ...draft }
  for (const field of CALL_DATA_FIELDS) {
    if (detail?.[field] !== undefined) refreshed[field] = detail[field]
  }
  return refreshed
}

export function createLocalVisitDraft (detail, { catalogVersion = null, now = new Date().toISOString() } = {}) {
  const evidence = evidenceFromDetail(detail.photos ?? [])

  return {
    id: detail.id,
    propertyId: detail.propertyId ?? null,
    draftSchemaVersion: LOCAL_VISIT_DRAFT_SCHEMA_VERSION,
    lifecycle: 'draft',
    localUpdatedAt: now,
    downloadedAt: now,
    serverUpdatedAt: detail.updatedAt ?? null,
    serverStatus: detail.status ?? null,
    catalogVersion,
    dirty: false,

    address: detail.address ?? {},
    orderNumber: detail.orderNumber ?? null,
    scheduledDate: detail.scheduledDate ?? null,
    scheduledTime: detail.scheduledTime ?? null,
    workType: detail.workType ?? null,
    companyNotes: detail.companyNotes ?? null,
    contacts: {
      name: detail.contactName ?? null,
      phone: detail.contactPhone ?? null,
      channel: detail.contactChannel ?? null,
    },
    status: detail.status ?? null,
    technicianId: detail.technicianId ?? null,
    hasMultipleSystems: detail.hasMultipleSystems ?? false,
    isDeferred: detail.isDeferred ?? false,
    systems: detail.systems ?? [],

    _service: serviceStateFromRows(detail.services ?? [], systemNumbersOf(detail)),
    _items: itemsFromDetail(detail.items),
    _weighInData: detail.weighInData ?? [],
    notes: detail.notes ?? '',
    _checklist: detail.checklist ?? {},
    evidenceRefs: evidence.refs,
    _checklistPhotoCounts: detail.checklistPhotoCounts ?? {},
    _weighInPhotos: evidence.weighInPhotos,
    _photoCount: evidence.refs.length,
    _cancelMode: null,
    _completedSteps: [],
    _activeStep: 'service',
    _weighinDone: false,
    totalPrice: detail.totalPrice ?? 0,
    pricingStatus: 'current',
  }
}

export function seedLocalVisitDraft (existingDraft, detail, options) {
  if (isLocalVisitDraft(existingDraft) && existingDraft.dirty) return existingDraft
  return createLocalVisitDraft(detail, options)
}

export function markLocalVisitDraftDirty (draft, now = new Date().toISOString()) {
  draft.dirty = true
  draft.localUpdatedAt = now
  return draft
}

export function updateLocalVisitDraftNotes (draft, notes, now) {
  draft.notes = notes
  return markLocalVisitDraftDirty(draft, now)
}

export function toggleLocalVisitDraftChecklist (draft, key, value, now) {
  draft._checklist = draft._checklist ?? {}
  draft._checklist[key] = draft._checklist[key] === value ? null : value
  return markLocalVisitDraftDirty(draft, now)
}
