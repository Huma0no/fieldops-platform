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

function serviceStateFromDetail (detail) {
  const service = (detail.services ?? [])[0]
  return {
    ac:          service?.serviceName === 'AC' || service?.serviceName === 'AC & Heat',
    heat:        service?.serviceName === 'Heat' || service?.serviceName === 'AC & Heat',
    prestart:    service?.serviceName === 'Prestart',
    cancel:      service?.serviceName === 'Cancel',
    driveRun:    service?.serviceName === 'Drive Run',
    finish:      service?.serviceName === 'Finish' || service?.isFinish === true,
    temporarily: service?.isTemporarily ?? false,
    price: service?.price ?? (service?.serviceName === 'Cancel' ? 0 : null),
    twoSystems:  detail.hasMultipleSystems ?? false,
  }
}

export function hasServiceSelection (service = {}) {
  return ['ac', 'heat', 'prestart', 'cancel', 'driveRun', 'finish']
    .some(key => service[key] === true)
}

export function serviceNameFromState (service = {}) {
  if (service.ac && service.heat) return 'AC & Heat'
  if (service.ac) return 'AC'
  if (service.heat) return 'Heat'
  if (service.prestart) return 'Prestart'
  if (service.cancel) return 'Cancel'
  if (service.driveRun) return 'Drive Run'
  if (service.finish) return 'Finish'
  return null
}

// Returns false when toggling would clear the final valid Service selection.
// That state is only created deliberately by Cancel, not by a normal tile.
export function toggleServiceSelection (service, key) {
  const previous = { ...service }
  service[key] = !service[key]

  if (key === 'cancel' || key === 'driveRun') {
    service.ac = false; service.heat = false; service.prestart = false
    if (key === 'cancel') service.driveRun = false
    if (key === 'driveRun') service.cancel = false
  } else if (['ac', 'heat', 'prestart'].includes(key)) {
    service.cancel = false; service.driveRun = false
  }

  if (hasServiceSelection(previous) && !hasServiceSelection(service)) {
    Object.assign(service, previous)
    return false
  }
  return true
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

  let retained = existing.filter(entry =>
    !(item.category === 'thermostat' && entry.category === 'thermostat') &&
    !removedNames.has(entry.item_name)
  )
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
  draft._service = {
    ...(draft._service ?? {}),
    ac: false,
    heat: false,
    prestart: false,
    driveRun: false,
    finish: false,
    temporarily: false,
    cancel: true,
  }
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

    _service: serviceStateFromDetail(detail),
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
