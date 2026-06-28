/**
 * src/lib/db.js
 * IndexedDB wrapper for Field Ops PWA.
 *
 * Stores:
 *   catalog   — items, equipment, lineset-configs (keyed by type)
 *   visits    — cached visit data
 *   queue     — offline completion queue entries
 *   photos    — local photo blobs per visit
 */

const DB_NAME    = 'fieldops'
const DB_VERSION = 1

let _db = null

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
      if (!db.objectStoreNames.contains('photos')) {
        const photos = db.createObjectStore('photos', { keyPath: 'id', autoIncrement: true })
        photos.createIndex('visitId', 'visitId', { unique: false })
      }
    }

    req.onsuccess = event => {
      _db = event.target.result
      resolve(_db)
    }
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

// ── Offline queue ─────────────────────────────────────────

export async function enqueue (entry) {
  const store = await tx('queue', 'readwrite')
  return promisify(store.add({ ...entry, enqueuedAt: Date.now() }))
}

export async function getQueue () {
  const store = await tx('queue')
  return promisify(store.getAll())
}

export async function dequeue (id) {
  const store = await tx('queue', 'readwrite')
  return promisify(store.delete(id))
}

// ── Photos ────────────────────────────────────────────────

export async function addPhoto (visitId, tag, blob) {
  const store = await tx('photos', 'readwrite')
  return promisify(store.add({ visitId, tag, blob, capturedAt: Date.now() }))
}

export async function getPhotosForVisit (visitId) {
  const store = await tx('photos')
  const index = store.index('visitId')
  return promisify(index.getAll(visitId))
}

export async function deletePhotosForVisit (visitId) {
  const store   = await tx('photos', 'readwrite')
  const index   = store.index('visitId')
  const records = await promisify(index.getAll(visitId))
  await Promise.all(records.map(r => promisify(store.delete(r.id))))
}
