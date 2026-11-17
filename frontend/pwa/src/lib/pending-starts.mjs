// Start without a connection (docs/OFFLINE-FIRST-CONTRACT.md): the visit is
// marked started in its Local Visit Draft at once, and the Start itself is
// recorded and sent when the server is reachable again — Dispatch sees
// "in progress" then.
import { api } from '../../../shared/api.js'
import { getActiveTechnicianId, getLocalVisitDraft, saveLocalVisitDraft } from './db.js'

const keyFor = technicianId => `fo:pendingStarts:${technicianId}`

export function readPendingStarts (storage, technicianId) {
  try {
    const ids = JSON.parse(storage.getItem(keyFor(technicianId)) ?? '[]')
    return Array.isArray(ids) ? ids : []
  } catch (_) {
    return []
  }
}

function writePendingStarts (storage, technicianId, ids) {
  if (ids.length) storage.setItem(keyFor(technicianId), JSON.stringify(ids))
  else storage.removeItem(keyFor(technicianId))
}

export function recordPendingStart (storage, technicianId, visitId) {
  const ids = readPendingStarts(storage, technicianId)
  if (!ids.includes(visitId)) writePendingStarts(storage, technicianId, [...ids, visitId])
}

// A network failure has no HTTP status; any server answer does.
const isNetworkFailure = error => error?.status == null

export async function startVisitLocalFirst (visitId, {
  storage = localStorage,
  technicianId = getActiveTechnicianId(),
  startVisit = id => api.post(`/visits/${id}/start`),
  getDraft = getLocalVisitDraft,
  saveDraft = saveLocalVisitDraft,
} = {}) {
  const draft = await getDraft(visitId, technicianId)
  try {
    await startVisit(visitId)
  } catch (error) {
    // Without a downloaded draft there is nothing to work on offline.
    if (!isNetworkFailure(error) || !draft) throw error
    recordPendingStart(storage, technicianId, visitId)
  }
  if (draft) {
    draft.status = 'in_progress'
    await saveDraft(draft, technicianId)
  }
}

export async function flushPendingStarts ({
  storage = localStorage,
  technicianId = getActiveTechnicianId(),
  startVisit = id => api.post(`/visits/${id}/start`),
} = {}) {
  if (!technicianId) return
  for (const visitId of readPendingStarts(storage, technicianId)) {
    try {
      await startVisit(visitId)
    } catch (error) {
      // Still offline or signed out: keep it for the next attempt. Any other
      // answer (already started, already finished) means nothing is left to send.
      if (isNetworkFailure(error) || error.status === 401) return
    }
    writePendingStarts(storage, technicianId, readPendingStarts(storage, technicianId).filter(id => id !== visitId))
  }
}

let retryStarted = false

export function startPendingStartRetry () {
  if (retryStarted || typeof window === 'undefined') return
  retryStarted = true
  const flush = () => { void flushPendingStarts().catch(error => console.error('Pending Start retry failed:', error)) }
  window.addEventListener('online', flush)
  flush()
}
