import {
  getPendingCompletionSubmissions,
  markCompletionSubmissionDelivered,
  saveCompletionSubmission,
} from './db.js'
import { api } from '../../../shared/api.js'
import { isCancelJustificationMissing } from './cancel-justification.mjs'
import { hasServiceSelection, serviceNameFromState } from './workspace-visit.mjs'

export const COMPLETION_SNAPSHOT_VERSION = 1

function immutableCopy (value) {
  return JSON.parse(JSON.stringify(value))
}

function submissionId () {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `submission-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function checklistAnswersFromDraft (draft) {
  return Object.entries(draft._checklist ?? {})
    .filter(([, answer]) => answer === 'yes' || answer === 'no')
    .map(([item, answer]) => ({
      item,
      answer,
      photoCount: draft._checklistPhotoCounts?.[item] ?? 0,
      reportText: answer === 'no' ? null : null,
    }))
}

export function validateCompletionDraft (draft) {
  const cancel = draft?._cancelMode?.confirmed === true
  if (cancel && isCancelJustificationMissing({ notes: draft.notes, checklist: draft._checklist })) {
    throw new Error('Cancel requires notes or a checklist answer')
  }
  if (!cancel && !hasServiceSelection(draft?._service)) {
    throw new Error('No service selected')
  }
}

export function createCompletionSnapshot (draft, { now = new Date().toISOString(), id = submissionId(), checklistAnswers = null } = {}) {
  validateCompletionDraft(draft)
  const cancel = draft._cancelMode?.confirmed === true
  const service = immutableCopy(draft._service ?? {})
  const snapshot = {
    version: COMPLETION_SNAPSHOT_VERSION,
    submissionId: id,
    visitId: draft.id,
    address: immutableCopy(draft.address ?? {}),
    workType: draft.workType ?? null,
    createdAt: now,
    terminalIntent: cancel ? 'cancelled' : (service.temporarily ? 'temporarily' : 'completed'),
    cancel,
    service: { ...service, serviceName: serviceNameFromState(service) },
    items: immutableCopy(cancel ? [] : (draft._items ?? [])),
    weighInData: immutableCopy(cancel ? [] : (draft._weighInData ?? [])),
    systems: immutableCopy(draft.systems ?? []),
    notes: draft.notes ?? '',
    checklistAnswers: immutableCopy(checklistAnswers ?? checklistAnswersFromDraft(draft)),
    evidenceRefs: immutableCopy(draft.evidenceRefs ?? []),
    totalPrice: cancel ? 0 : Number(draft.totalPrice ?? 0),
  }
  return Object.freeze(immutableCopy(snapshot))
}

export async function createPendingCompletionSubmission (draft, options) {
  let resolvedOptions = options
  let existing = null
  if (!options?.id && draft?.id) {
    const pending = await getPendingCompletionSubmissions()
    existing = pending.find(entry => entry.visitId === draft.id) ?? null
    if (existing) {
      resolvedOptions = { ...options, id: existing.submissionId }
    }
  }
  const snapshot = createCompletionSnapshot(draft, resolvedOptions)
  const record = {
    submissionId: snapshot.submissionId,
    visitId: snapshot.visitId,
    lifecycle: 'pending',
    createdAt: existing?.createdAt ?? snapshot.createdAt,
    attempts: existing?.attempts ?? 0,
    lastError: existing?.lastError ?? null,
    snapshot,
  }
  await saveCompletionSubmission(record)
  return record
}

export async function deliverCompletionSubmission (record) {
  const current = record?.submissionId
    ? record
    : await getPendingCompletionSubmissions().then(entries =>
        entries.find(entry =>
          entry.submissionId === record
          || entry.visitId === record
          || (record?.visitId && entry.visitId === record.visitId)
        )
      )
  if (!current || current.lifecycle === 'delivered') return current
  try {
    const acknowledgment = await api.post(`/visits/${current.visitId}/complete`, {
      submissionId: current.submissionId,
      snapshot: current.snapshot,
    })
    if (acknowledgment?.submissionId !== current.submissionId || acknowledgment?.acknowledged !== true) {
      throw new Error('Completion was not explicitly acknowledged')
    }
    const delivered = await markCompletionSubmissionDelivered(current.submissionId, acknowledgment)
    const remainingPending = await getPendingCompletionSubmissions()
    for (const duplicate of remainingPending) {
      if (duplicate.visitId === current.visitId && duplicate.submissionId !== current.submissionId) {
        await markCompletionSubmissionDelivered(duplicate.submissionId, acknowledgment)
      }
    }
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('completion:delivered', {
        detail: {
          visitId: current.visitId,
          submissionId: current.submissionId,
          record: delivered,
          acknowledgment,
        },
      }))
    }
    return delivered
  } catch (error) {
    await saveCompletionSubmission({
      ...current,
      attempts: (current.attempts ?? 0) + 1,
      lastError: error?.message ?? 'Delivery failed',
      lastAttemptAt: new Date().toISOString(),
    })
    throw error
  }
}

let retryStarted = false
let retryInFlight = false

export async function retryPendingCompletionSubmissions () {
  const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine !== false
  if (retryInFlight || !isOnline) return []
  retryInFlight = true
  try {
    const pending = await getPendingCompletionSubmissions()
    const seenVisits = new Set()
    const results = []
    for (const record of pending) {
      if (seenVisits.has(record.visitId)) continue
      seenVisits.add(record.visitId)
      try { results.push(await deliverCompletionSubmission(record)) } catch (_) { results.push(null) }
    }
    return results
  } finally {
    retryInFlight = false
  }
}

export function startCompletionSubmissionRetry () {
  if (retryStarted) return
  retryStarted = true
  const retrySafely = () => {
    void retryPendingCompletionSubmissions().catch(error => {
      // Delivery is independent from navigation. A local storage or transport
      // problem remains observable in the outbox but must not reject boot.
      console.error('Pending completion retry failed:', error)
    })
  }
  window.addEventListener('online', retrySafely)
  retrySafely()
}
