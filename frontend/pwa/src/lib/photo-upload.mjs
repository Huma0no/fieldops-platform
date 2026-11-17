// Photo evidence, local-first (docs/OFFLINE-FIRST-CONTRACT.md and
// docs/shared/PHOTOS-GPS-INTEGRATIONS.md): a photo is kept on the phone the
// moment it is taken, counted in the draft through its evidence reference, and
// uploaded whenever the server is reachable — before or after the Report.
import { api } from '../../../shared/api.js'
import { deleteUploadedPhotosBefore, getActiveTechnicianId, getPendingPhotos, markPhotoUploaded, savePendingPhoto } from './db.js'

// A sent photo stays on the phone this long, so its Report can be downloaded
// offline with its photos.
export const KEEP_SENT_PHOTOS_MS = 7 * 24 * 60 * 60 * 1000

// Same file name the server builds: {ADDRESS}_{TAG}[_SYS{n}].
export function photoSlug (street, tag, systemNumber) {
  const base = `${street ?? ''}_${tag}`.toUpperCase().replace(/\s+/g, '_')
  return systemNumber ? `${base}_SYS${systemNumber}` : base
}

function newPhotoId () {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `photo-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

// Keeps the photo and returns the evidence reference for the draft.
export async function keepPhoto ({
  visitId, technicianId = getActiveTechnicianId(), blob, fileName = null,
  tag, category, systemNumber = null, label = null, street, lat = null, lon = null,
  save = savePendingPhoto,
}) {
  const photoId = newPhotoId()
  const slug = photoSlug(street, tag, systemNumber)
  await save({ photoId, visitId, blob, fileName, tag, category, systemNumber, label, slug, lat, lon, capturedAt: new Date().toISOString() }, technicianId)
  return { id: photoId, slug, tag, label, category, systemNumber, storedAt: null }
}

let uploading = null

export function uploadPendingPhotos ({
  technicianId = getActiveTechnicianId(),
  load = getPendingPhotos,
  markUploaded = markPhotoUploaded,
  send = (visitId, form) => api.upload(`/visits/${visitId}/photos`, form),
} = {}) {
  if (uploading) return uploading
  uploading = (async () => {
    if (!technicianId) return
    for (const record of await load(technicianId)) {
      const form = new FormData()
      form.append('photo', record.blob, record.fileName ?? `${record.slug}.jpg`)
      form.append('photoId', record.photoId)
      form.append('tag', record.tag)
      form.append('category', record.category)
      form.append('slug', record.slug)
      if (record.systemNumber != null) form.append('systemNumber', String(record.systemNumber))
      if (record.label) form.append('label', record.label)
      if (record.lat != null && record.lon != null) {
        form.append('lat', String(record.lat))
        form.append('lon', String(record.lon))
      }
      try {
        await send(record.visitId, form)
        await markUploaded(record.id)
      } catch (error) {
        // Offline or signed out: stop and retry later. A rejected photo stays
        // on the phone (never deleted unseen) and is retried next time.
        if (error?.status == null || error.status === 401) return
        console.error('Photo upload rejected:', record.photoId, error)
      }
    }
  })().finally(() => { uploading = null })
  return uploading
}

let retryStarted = false
let retryTimer = null
const RETRY_MS = 60_000

// Uploads on start and on reconnect; while photos are still waiting and the
// device is online (e.g. after a server error), tries again every minute.
export function startPhotoUploadRetry () {
  if (retryStarted || typeof window === 'undefined') return
  retryStarted = true
  const upload = async () => {
    clearTimeout(retryTimer)
    try {
      await deleteUploadedPhotosBefore(Date.now() - KEEP_SENT_PHOTOS_MS)
      await uploadPendingPhotos()
      const waiting = await getPendingPhotos()
      if (waiting.length && navigator.onLine !== false) retryTimer = setTimeout(upload, RETRY_MS)
    } catch (error) {
      console.error('Photo upload retry failed:', error)
    }
  }
  window.addEventListener('online', upload)
  void upload()
}
