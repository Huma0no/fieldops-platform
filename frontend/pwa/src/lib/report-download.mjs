// Report download: the Report JSON, its photos as a ZIP, or both in one ZIP.
// Photos come from the phone (kept KEEP_SENT_PHOTOS_MS after the server
// stored them) or, when online, from the server — whatever their upload state.
import { api } from '../../../shared/api.js'
import { getPhotosForVisit } from './db.js'
import { zipFiles } from './zip.mjs'

// Photo file names follow docs/shared/DATA_MODEL.md (visit_photos):
// {address}_{tag} or {address}_{tag}_SYS{n}; a repeated name gets _2, _3…
export function photoFileNames (refs) {
  const seen = new Map()
  return refs.map(ref => {
    const base = ref.slug || ref.id
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    return `${count > 1 ? `${base}_${count}` : base}.jpg`
  })
}

export async function collectReportPhotos (visit, {
  online = typeof navigator === 'undefined' || navigator.onLine !== false,
  loadLocal = getPhotosForVisit,
  loadServerList = visitId => api.get(`/visits/${visitId}`).then(detail => detail?.photos ?? []),
  fetchPhoto = (visitId, photoId) => fetch(`/api/visits/${visitId}/photos/${photoId}`, { credentials: 'same-origin' })
    .then(res => (res.ok ? res.blob() : null)),
} = {}) {
  const refs = [...(visit.snapshot?.evidenceRefs ?? [])]
  if (online) {
    try {
      for (const photo of await loadServerList(visit.id)) {
        if (!refs.some(ref => ref.id === photo.id)) refs.push(photo)
      }
    } catch (_) { online = false }
  }
  const local = new Map((await loadLocal(visit.id)).filter(r => r.photoId).map(r => [r.photoId, r.blob]))
  const names = photoFileNames(refs)
  const photos = []
  const missing = []
  for (const [i, ref] of refs.entries()) {
    let blob = local.get(ref.id) ?? null
    if (!blob && online) blob = await fetchPhoto(visit.id, ref.id).catch(() => null)
    if (blob) photos.push({ name: names[i], data: blob })
    else missing.push({ name: names[i], needsConnection: !online })
  }
  return { photos, missing }
}

// kind: 'json' | 'zip' (photos) | 'all' (JSON + photos in one ZIP).
export async function buildReportDownload (visit, kind, { loadReport = id => api.get(`/visits/${id}/report-preview`), ...photoOptions } = {}) {
  const base = `report-${visit.id}`
  // The Report JSON is built by the server: without a connection it is listed
  // as missing, like a photo that is no longer on the phone.
  let json = null
  let jsonMissing = []
  if (kind !== 'zip') {
    try {
      json = JSON.stringify(await loadReport(visit.id), null, 2)
    } catch (error) {
      if (error?.status != null) throw error
      jsonMissing = [{ name: `${base}.json`, needsConnection: true }]
    }
  }
  if (kind === 'json') {
    if (!json) return { fileName: null, blob: null, missing: jsonMissing }
    return { fileName: `${base}.json`, blob: new Blob([json], { type: 'application/json' }), missing: [] }
  }
  const { photos, missing: photosMissing } = await collectReportPhotos(visit, photoOptions)
  const missing = [...jsonMissing, ...photosMissing]
  const files = json ? [{ name: `${base}.json`, data: json }, ...photos] : photos
  if (!files.length) return { fileName: null, blob: null, missing }
  return { fileName: kind === 'all' ? `${base}.zip` : `${base}-photos.zip`, blob: await zipFiles(files), missing }
}
