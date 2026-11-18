/**
 * src/lib/db.js
 * IndexedDB wrapper for Field Ops PWA.
 *
 * Stores:
 *   catalog   — items, equipment, lineset-configs (keyed by type)
 *   visits    — cached visit data (scoped by technicianId)
 *   queue     — offline completion queue entries (scoped by technicianId)
 *   photos    — local photo blobs per visit (scoped by technicianId)
 */

const DB_NAME    = 'fieldops'
const DB_VERSION = 2

let _db = null

function normalizeTechnicianId (value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function getActiveTechnicianId () {
  if (typeof localStorage === 'undefined' || !localStorage) return null
  try {
    const raw = localStorage.getItem('technician')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return normalizeTechnicianId(parsed?.id)
  } catch (_) {
    return null
  }
}

export function scopedVisitKey (technicianId, visitId) {
  const techId = normalizeTechnicianId(technicianId)
  if (!techId || typeof visitId !== 'string' || !visitId) {
    throw new Error('Technician ID and visit ID are required for scoped visit key')
  }
  return `${techId}::${visitId}`
}

function canonicalVisitIdFromRecord (record) {
  if (typeof record?.visitId === 'string' && record.visitId.length > 0) {
    return record.visitId
  }
  if (typeof record?.id === 'string') {
    const sepIndex = record.id.indexOf('::')
    if (sepIndex > 0 && sepIndex + 2 < record.id.length) {
      return record.id.slice(sepIndex + 2)
    }
    return record.id
  }
  return null
}

function unwrapVisitRecordForTechnician (record, technicianId) {
  const techId = normalizeTechnicianId(technicianId)
  if (!record || !techId || normalizeTechnicianId(record.technicianId) !== techId) {
    return null
  }
  const visitId = canonicalVisitIdFromRecord(record)
  if (!visitId) return null
  const unwrapped = { ...record, id: visitId }
  delete unwrapped.visitId
  if (unwrapped._myCallsSummary) {
    const summaryTechId = normalizeTechnicianId(
      unwrapped._myCallsSummary.technicianId ?? unwrapped._myCallsSummary.technician_id
    )
    if (summaryTechId && summaryTechId !== techId) {
      delete unwrapped._myCallsSummary
    }
  }
  return unwrapped
}

function openDB () {
  if (_db) return Promise.resolve(_db)

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = event => {
      const db = event.target.result

      if (!db.objectStoreNames.contains('catalog')) {
        db.createObjectStore('catalog', { keyPath: 'type' })
      }
      if (!db.objectStoreNames.contains('visits')) {
        db.createObjectStore('visits', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('queue')) {
        db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true })
      }
      if (!db.objectStoreNames.contains('completionSubmissions')) {
        const submissions = db.createObjectStore('completionSubmissions', { keyPath: 'submissionId' })
        submissions.createIndex('lifecycle', 'lifecycle', { unique: false })
        submissions.createIndex('visitId', 'visitId', { unique: false })
      }
      if (!db.objectStoreNames.contains('photos')) {
        const photos = db.createObjectStore('photos', { keyPath: 'id', autoIncrement: true })
        photos.createIndex('visitId', 'visitId', { unique: false })
      }
    }

    req.onsuccess = event => {
      _db = event.target.result
      // Let a later application version upgrade this database instead of
      // leaving an old tab's connection permanently blocked.
      _db.onversionchange = () => {
        _db.close()
        _db = null
      }
      resolve(_db)
    }
    req.onblocked = () => reject(new Error('Local database upgrade is blocked by another open FieldOps tab'))
    req.onerror = () => reject(req.error)
  })
}

function tx (storeName, mode = 'readonly') {
  return openDB().then(db => db.transaction(storeName, mode).objectStore(storeName))
}

function promisify (req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

// ── Catalog ───────────────────────────────────────────────

export async function setCatalog (type, data) {
  const store = await tx('catalog', 'readwrite')
  return promisify(store.put({ type, data, updatedAt: Date.now() }))
}

export async function getCatalog (type) {
  const store  = await tx('catalog')
  const record = await promisify(store.get(type))
  return record?.data ?? null
}

// ── Visits ────────────────────────────────────────────────

export async function setVisit (visit) {
  const store = await tx('visits', 'readwrite')
  return promisify(store.put(visit))
}

export async function getVisit (id) {
  const store = await tx('visits')
  return promisify(store.get(id))
}

export async function getAllVisits () {
  const store = await tx('visits')
  return promisify(store.getAll())
}

export async function deleteVisit (id) {
  const store = await tx('visits', 'readwrite')
  return promisify(store.delete(id))
}

// ── Local Visit Drafts ───────────────────────────────────

export function isLocalVisitDraft (record) {
  return record?.draftSchemaVersion === 1 &&
    record.lifecycle === 'draft' &&
    typeof record.id === 'string' &&
    Array.isArray(record._items) &&
    record._items.every(item => typeof item?.id === 'string' && item.id.length > 0)
}

export async function saveLocalVisitDraft (draft, technicianId = draft?.technicianId ?? getActiveTechnicianId()) {
  if (!isLocalVisitDraft(draft)) throw new Error('Invalid Local Visit Draft')
  const explicitTechId = normalizeTechnicianId(technicianId)
  const draftTechId = normalizeTechnicianId(draft?.technicianId)
  if (explicitTechId && draftTechId && explicitTechId !== draftTechId) {
    throw new Error('Local Visit Draft technician mismatch')
  }
  const techId = explicitTechId ?? draftTechId
  if (!techId) throw new Error('Local Visit Draft requires an authenticated technician')

  const rawVisitId = draft.id
  const scopedKey = scopedVisitKey(techId, rawVisitId)
  const existingScoped = await getVisit(scopedKey)
  const existingBare = await getVisit(rawVisitId)

  const recordToStore = {
    ...draft,
    id: scopedKey,
    visitId: rawVisitId,
    technicianId: techId,
  }

  if (!recordToStore._myCallsSummary) {
    const scopedSummaryTech = normalizeTechnicianId(
      existingScoped?._myCallsSummary?.technicianId ?? existingScoped?._myCallsSummary?.technician_id
    )
    const bareSummaryTech = normalizeTechnicianId(
      existingBare?._myCallsSummary?.technicianId ?? existingBare?._myCallsSummary?.technician_id
    )
    if (existingScoped?._myCallsSummary && (!scopedSummaryTech || scopedSummaryTech === techId)) {
      recordToStore._myCallsSummary = existingScoped._myCallsSummary
    } else if (
      existingBare &&
      normalizeTechnicianId(existingBare.technicianId) === techId &&
      existingBare._myCallsSummary &&
      (!bareSummaryTech || bareSummaryTech === techId)
    ) {
      recordToStore._myCallsSummary = existingBare._myCallsSummary
    }
  }

  const result = await setVisit(recordToStore)
  if (existingBare && normalizeTechnicianId(existingBare.technicianId) === techId) {
    await deleteVisit(rawVisitId)
  }
  return result
}

export async function getLocalVisitDraft (id, technicianId = getActiveTechnicianId()) {
  const techId = normalizeTechnicianId(technicianId)
  if (!techId || typeof id !== 'string' || !id) return null

  const scopedRecord = await getVisit(scopedVisitKey(techId, id))
  const unwrappedScoped = unwrapVisitRecordForTechnician(scopedRecord, techId)
  if (isLocalVisitDraft(unwrappedScoped)) {
    return unwrappedScoped
  }

  const legacyRecord = await getVisit(id)
  const unwrappedLegacy = unwrapVisitRecordForTechnician(legacyRecord, techId)
  return isLocalVisitDraft(unwrappedLegacy) ? unwrappedLegacy : null
}

export async function getAllLocalVisitDrafts (technicianId = getActiveTechnicianId()) {
  const techId = normalizeTechnicianId(technicianId)
  if (!techId) return []

  const records = await getAllVisits()
  const byVisitId = new Map()
  for (const record of records) {
    const unwrapped = unwrapVisitRecordForTechnician(record, techId)
    if (!isLocalVisitDraft(unwrapped)) continue
    const isScopedRecord = typeof record.id === 'string' && record.id.startsWith(`${techId}::`)
    if (!byVisitId.has(unwrapped.id) || isScopedRecord) {
      byVisitId.set(unwrapped.id, unwrapped)
    }
  }
  return Array.from(byVisitId.values())
}

// My Calls summaries share the existing visit cache without replacing the
// mutable Local Visit Draft stored for the same visit ID. The server summary
// is only a downloadable card representation; Workspace remains draft-backed.
export async function cacheMyCallsVisits (visits, technicianId = getActiveTechnicianId()) {
  const techId = normalizeTechnicianId(technicianId)
  if (!techId) return

  const records = await getAllVisits()
  const byKey = new Map(records.map(record => [record.id, record]))
  const incomingScopedKeys = new Set()

  await Promise.all((visits ?? []).map(async visit => {
    if (!visit?.id) return
    const visitTechId = normalizeTechnicianId(visit.technicianId ?? visit.technician_id)
    if (visitTechId && visitTechId !== techId) return

    const scopedKey = scopedVisitKey(techId, visit.id)
    incomingScopedKeys.add(scopedKey)
    const summary = { ...visit, id: visit.id, technicianId: techId }
    const existingScoped = byKey.get(scopedKey)
    const existingBare = byKey.get(visit.id)
    const unwrappedScoped = unwrapVisitRecordForTechnician(existingScoped, techId)
    const unwrappedBare = unwrapVisitRecordForTechnician(existingBare, techId)

    if (isLocalVisitDraft(unwrappedScoped)) {
      return setVisit({ ...existingScoped, id: scopedKey, visitId: visit.id, technicianId: techId, _myCallsSummary: summary })
    }
    if (isLocalVisitDraft(unwrappedBare)) {
      await setVisit({ ...existingBare, id: scopedKey, visitId: visit.id, technicianId: techId, _myCallsSummary: summary })
      return deleteVisit(visit.id)
    }
    return setVisit({ id: scopedKey, visitId: visit.id, technicianId: techId, _myCallsSummary: summary })
  }))

  await Promise.all(records.map(async record => {
    if (normalizeTechnicianId(record?.technicianId) !== techId) return
    if (!record?._myCallsSummary) return
    const visitId = canonicalVisitIdFromRecord(record)
    if (!visitId) return
    const scopedKey = scopedVisitKey(techId, visitId)
    if (incomingScopedKeys.has(scopedKey)) return

    const unwrapped = unwrapVisitRecordForTechnician(record, techId)
    if (isLocalVisitDraft(unwrapped)) {
      const { _myCallsSummary, ...withoutSummary } = record
      await setVisit(withoutSummary)
    } else if (record.id === scopedKey) {
      await deleteVisit(record.id)
    }
  }))
}

export async function getCachedMyCallsVisits (technicianId = getActiveTechnicianId()) {
  const techId = normalizeTechnicianId(technicianId)
  if (!techId) return []

  const records = await getAllVisits()
  const byVisitId = new Map()
  for (const record of records) {
    const summary = record?._myCallsSummary
    if (!summary || typeof summary.id !== 'string') continue
    const recordTechId = normalizeTechnicianId(record.technicianId)
    const summaryTechId = normalizeTechnicianId(summary.technicianId ?? summary.technician_id)
    const resolvedOwner = summaryTechId ?? recordTechId
    if (resolvedOwner !== techId) continue
    if (recordTechId && recordTechId !== techId) continue

    const isScopedRecord = typeof record.id === 'string' && record.id.startsWith(`${techId}::`)
    if (!byVisitId.has(summary.id) || isScopedRecord) {
      byVisitId.set(summary.id, summary)
    }
  }
  return Array.from(byVisitId.values())
}

export async function deleteLocalVisitDraft (id, technicianId = getActiveTechnicianId()) {
  const techId = normalizeTechnicianId(technicianId)
  if (!techId || typeof id !== 'string' || !id) return

  await deleteVisit(scopedVisitKey(techId, id))
  const bareRecord = await getVisit(id)
  if (bareRecord && normalizeTechnicianId(bareRecord.technicianId) === techId) {
    await deleteVisit(id)
  }
}

// Safe to use when an app lifecycle or a focused test needs a fresh connection.
export function closeLocalDatabase () {
  if (_db) _db.close()
  _db = null
}

// ── Offline queue ─────────────────────────────────────────

export async function enqueue (entry, technicianId = entry?.technicianId ?? getActiveTechnicianId()) {
  const techId = normalizeTechnicianId(technicianId)
  if (!techId) throw new Error('Queue entry requires an authenticated technician')
  if (entry?.technicianId != null && normalizeTechnicianId(entry.technicianId) !== techId) {
    throw new Error('Queue entry technician mismatch')
  }
  const store = await tx('queue', 'readwrite')
  return promisify(store.add({ ...entry, technicianId: techId, enqueuedAt: Date.now() }))
}

export async function getQueue (technicianId = getActiveTechnicianId()) {
  const techId = normalizeTechnicianId(technicianId)
  if (!techId) return []
  const store = await tx('queue')
  const records = await promisify(store.getAll())
  return records.filter(record => normalizeTechnicianId(record?.technicianId) === techId)
}

export async function dequeue (id, technicianId = getActiveTechnicianId()) {
  const techId = normalizeTechnicianId(technicianId)
  if (!techId) return
  const store = await tx('queue', 'readwrite')
  const record = await promisify(store.get(id))
  if (!record || normalizeTechnicianId(record.technicianId) !== techId) return
  return promisify(store.delete(id))
}

// ── Completion submissions ───────────────────────────────

function isOwnedCompletionSubmission (record, technicianId) {
  const techId = normalizeTechnicianId(technicianId)
  if (!record || !techId) return false
  return normalizeTechnicianId(record.technicianId) === techId &&
    normalizeTechnicianId(record.snapshot?.technicianId) === techId
}

export async function saveCompletionSubmission (submission) {
  const store = await tx('completionSubmissions', 'readwrite')
  return promisify(store.put(submission))
}

export async function getCompletionSubmission (submissionId, technicianId = getActiveTechnicianId()) {
  const techId = normalizeTechnicianId(technicianId)
  if (!techId) return null
  const store = await tx('completionSubmissions')
  const record = await promisify(store.get(submissionId))
  return isOwnedCompletionSubmission(record, techId) ? record : null
}

export async function getPendingCompletionSubmissions (technicianId = getActiveTechnicianId()) {
  const techId = normalizeTechnicianId(technicianId)
  if (!techId) return []
  const store = await tx('completionSubmissions')
  const index = store.index('lifecycle')
  const records = await promisify(index.getAll('pending'))
  return records.filter(record => isOwnedCompletionSubmission(record, techId))
}

export async function getAllCompletionSubmissions (technicianId = getActiveTechnicianId()) {
  const techId = normalizeTechnicianId(technicianId)
  if (!techId) return []
  const store = await tx('completionSubmissions')
  const records = await promisify(store.getAll())
  return records.filter(record => isOwnedCompletionSubmission(record, techId))
}

export async function markCompletionSubmissionDelivered (submissionId, acknowledgment, technicianId = getActiveTechnicianId()) {
  const submission = await getCompletionSubmission(submissionId, technicianId)
  if (!submission) return null
  const delivered = {
    ...submission,
    lifecycle: 'delivered',
    deliveredAt: new Date().toISOString(),
    lastError: null,
    acknowledgment,
  }
  await saveCompletionSubmission(delivered)
  return delivered
}

// ── Photos ────────────────────────────────────────────────

export async function addPhoto (visitId, tag, blob, technicianId = getActiveTechnicianId()) {
  const techId = normalizeTechnicianId(technicianId)
  if (!techId) throw new Error('Photo capture requires an authenticated technician')
  const store = await tx('photos', 'readwrite')
  return promisify(store.add({ visitId, tag, blob, technicianId: techId, capturedAt: Date.now() }))
}

export async function getPhotosForVisit (visitId, technicianId = getActiveTechnicianId()) {
  const techId = normalizeTechnicianId(technicianId)
  if (!techId) return []
  const store = await tx('photos')
  const index = store.index('visitId')
  const records = await promisify(index.getAll(visitId))
  return records.filter(record => normalizeTechnicianId(record?.technicianId) === techId)
}

// Photos waiting for the server (docs/OFFLINE-FIRST-CONTRACT.md). Each record
// carries the image, its evidence metadata and the photo id the server keeps.
export async function savePendingPhoto (record, technicianId = getActiveTechnicianId()) {
  const techId = normalizeTechnicianId(technicianId)
  if (!techId) throw new Error('Photo capture requires an authenticated technician')
  const store = await tx('photos', 'readwrite')
  return promisify(store.add({ ...record, technicianId: techId, pendingUpload: true }))
}

export async function getPendingPhotos (technicianId = getActiveTechnicianId()) {
  const techId = normalizeTechnicianId(technicianId)
  if (!techId) return []
  const store = await tx('photos')
  const records = await promisify(store.getAll())
  return records.filter(record => record?.pendingUpload === true && normalizeTechnicianId(record.technicianId) === techId)
}

// The server stored the photo: keep the local copy (for offline download) as
// sent; deleteUploadedPhotosBefore removes it later.
export async function markPhotoUploaded (id, uploadedAt = Date.now()) {
  const store = await tx('photos', 'readwrite')
  const record = await promisify(store.get(id))
  if (!record) return
  return promisify(store.put({ ...record, pendingUpload: false, uploadedAt }))
}

// Discards local photos by their photo id (a system the technician removed).
export async function deleteLocalPhotos (photoIds) {
  const ids = new Set(photoIds)
  if (!ids.size) return
  const store = await tx('photos', 'readwrite')
  const records = await promisify(store.getAll())
  await Promise.all(records.filter(record => ids.has(record?.photoId)).map(record => promisify(store.delete(record.id))))
}

export async function deleteUploadedPhotosBefore (cutoff) {
  const store = await tx('photos', 'readwrite')
  const records = await promisify(store.getAll())
  const expired = records.filter(record => record?.pendingUpload === false && record.uploadedAt < cutoff)
  await Promise.all(expired.map(record => promisify(store.delete(record.id))))
}

export async function deletePhotosForVisit (visitId, technicianId = getActiveTechnicianId()) {
  const techId = normalizeTechnicianId(technicianId)
  if (!techId) return
  const store   = await tx('photos', 'readwrite')
  const index   = store.index('visitId')
  const records = await promisify(index.getAll(visitId))
  const owned = records.filter(record => normalizeTechnicianId(record?.technicianId) === techId)
  await Promise.all(owned.map(r => promisify(store.delete(r.id))))
}
