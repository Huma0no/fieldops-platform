import {
  getActiveTechnicianId,
  getPendingCompletionSubmissions,
  markCompletionSubmissionDelivered,
  saveCompletionSubmission,
} from './db.js'
import { api } from '../../../shared/api.js'
import { isCancelJustificationMissing } from './cancel-justification.mjs'
import {
  missingServiceSystems,
  normalizeServiceState,
  serviceRowsFromState,
  systemNumbersOf,
  weighInWarnings,
} from './workspace-visit.mjs'

// Version 2: per-system `services` rows replace the single `service` object.
export const COMPLETION_SNAPSHOT_VERSION = 2

function immutableCopy (value) {
  return JSON.parse(JSON.stringify(value))
}

function submissionId () {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `submission-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function normalizeTechnicianId (value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function resolveSubmissionTechnicianId (draft, explicitTechnicianId) {
  const explicitTechId = normalizeTechnicianId(explicitTechnicianId)
  const draftTechId = normalizeTechnicianId(draft?.technicianId)
  const activeTechId = normalizeTechnicianId(getActiveTechnicianId())
  if (explicitTechId && draftTechId && explicitTechId !== draftTechId) {
    throw new Error('Completion submission technician mismatch')
  }
  if (!explicitTechId && draftTechId && activeTechId && draftTechId !== activeTechId) {
    throw new Error('Completion submission technician mismatch')
  }
  const resolvedTechId = explicitTechId ?? draftTechId ?? activeTechId
  if (!resolvedTechId) {
    throw new Error('Completion submission requires an authenticated technician')
  }
  return resolvedTechId
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

// WS-12: a rejected Report says which parts differ from the server and what
// to do. `fields` are the server's REPORT_CONTENT_MISMATCH field names.
const MISMATCH_SECTIONS = [
  [/^(services|service|terminalIntent)\b/, 'Service'],
  [/^items\b/, 'T-stat, Accessories or Fix'],
  [/^(systems|hasMultipleSystems)\b/, 'Systems'],
  [/^weighInData\b/, 'Weigh-In'],
  [/^checklistAnswers\b/, 'Checklist'],
  [/^notes\b/, 'Notes'],
  [/^evidenceRefs\b/, 'Photos'],
  [/^(address|orderNumber|scheduledDate|scheduledTime|propertyId|workType)\b/, 'Call details'],
]

export function describeReportMismatch (fields) {
  if (!Array.isArray(fields) || !fields.length) return 'Correction required — edit the Report and confirm a new submission'
  const sections = [...new Set(fields.map(field => MISMATCH_SECTIONS.find(([pattern]) => pattern.test(field))?.[1] ?? 'Other details'))]
  const callDetails = sections.includes('Call details')
    ? ' Call details come from the office: ask Dispatch if they look wrong.'
    : ''
  return `Not accepted — the office's copy differs in: ${sections.join(', ')}. Tap Correct report, check ${sections.length > 1 ? 'those sections' : 'that section'} and confirm a new submission.${callDetails}`
}

export function validateCompletionDraft (draft) {
  const cancel = draft?._cancelMode?.confirmed === true
  if (cancel && isCancelJustificationMissing({ notes: draft.notes, checklist: draft._checklist })) {
    throw new Error('Cancel requires notes or a checklist answer')
  }
  if (cancel) return
  const systemNumbers = systemNumbersOf(draft)
  const missing = missingServiceSystems(draft?._service, systemNumbers)
  if (missing.length) {
    throw new Error(systemNumbers.length > 1 ? `System ${missing.join(', ')}: no service selected` : 'No service selected')
  }
}

// Each row carries the price the server confirmed for that exact selection;
// a selection the server has not confirmed yet carries null.
function pricedServiceRows (draft) {
  const service = normalizeServiceState(draft._service)
  return serviceRowsFromState(service, systemNumbersOf(draft)).map((row) => {
    const confirmed = service.rows.find(saved =>
      (saved.systemNumber ?? null) === row.systemNumber &&
      saved.serviceName === row.serviceName &&
      Boolean(saved.isFinish) === row.isFinish &&
      Boolean(saved.isTemporarily) === row.isTemporarily)
    return { ...row, price: confirmed?.price ?? null }
  })
}

export function createCompletionSnapshot (draft, { now = new Date().toISOString(), id = submissionId(), checklistAnswers = null, technicianId } = {}) {
  validateCompletionDraft(draft)
  const resolvedTechId = resolveSubmissionTechnicianId(draft, technicianId)
  const cancel = draft._cancelMode?.confirmed === true
  const services = cancel
    ? [{ systemNumber: null, serviceName: 'Cancel', isFinish: false, isTemporarily: false, price: 0 }]
    : pricedServiceRows(draft)
  const snapshot = {
    version: COMPLETION_SNAPSHOT_VERSION,
    submissionId: id,
    visitId: draft.id,
    technicianId: resolvedTechId,
    address: immutableCopy(draft.address ?? {}),
    propertyId: draft.propertyId ?? null,
    orderNumber: draft.orderNumber ?? null,
    scheduledDate: draft.scheduledDate ?? null,
    scheduledTime: draft.scheduledTime ?? null,
    workType: draft.workType ?? null,
    hasMultipleSystems: draft.hasMultipleSystems === true,
    createdAt: now,
    terminalIntent: cancel ? 'cancelled' : (services.some(row => row.isTemporarily) ? 'temporarily' : 'completed'),
    cancel,
    services,
    items: immutableCopy(cancel ? [] : (draft._items ?? []).map(item => ({
      ...item,
      description: item.description ?? null,
      quantity: item.quantity ?? 1,
      price: item.price ?? null,
      techSupplied: item.techSupplied ?? item.tech_supplied ?? false,
    }))),
    weighInData: immutableCopy(cancel ? [] : (draft._weighInData ?? [])),
    systems: immutableCopy(draft.systems ?? []),
    notes: draft.notes ?? '',
    checklistAnswers: immutableCopy(checklistAnswers ?? checklistAnswersFromDraft(draft)),
    evidenceRefs: immutableCopy(draft.evidenceRefs ?? []),
    // Informational: missing Weigh-In data never blocks the Report.
    weighInWarnings: cancel ? [] : weighInWarnings(draft),
    totalPrice: cancel ? 0 : Number(draft.totalPrice ?? 0),
  }
  return Object.freeze(immutableCopy(snapshot))
}

export async function createPendingCompletionSubmission (draft, options) {
  const resolvedTechId = resolveSubmissionTechnicianId(draft, options?.technicianId)
  let resolvedOptions = { ...options, technicianId: resolvedTechId }
  let existing = null
  if (!options?.id && draft?.id) {
    const pending = await getPendingCompletionSubmissions(resolvedTechId)
    existing = pending.find(entry => entry.visitId === draft.id) ?? null
    if (existing) {
      resolvedOptions = { ...resolvedOptions, id: existing.submissionId }
    }
  }
  const snapshot = createCompletionSnapshot(draft, resolvedOptions)
  const record = {
    submissionId: snapshot.submissionId,
    visitId: snapshot.visitId,
    technicianId: snapshot.technicianId,
    lifecycle: 'pending',
    createdAt: existing?.createdAt ?? snapshot.createdAt,
    attempts: existing?.attempts ?? 0,
    lastError: existing?.lastError ?? null,
    snapshot,
  }
  await saveCompletionSubmission(record)
  return record
}

export async function deliverCompletionSubmission (record, { activeTechnicianId = getActiveTechnicianId() } = {}) {
  const techId = normalizeTechnicianId(activeTechnicianId)
  if (!techId) return null

  const current = record?.submissionId
    ? record
    : await getPendingCompletionSubmissions(techId).then(entries =>
        entries.find(entry =>
          entry.submissionId === record
          || entry.visitId === record
          || (record?.visitId && entry.visitId === record.visitId)
        )
      )
  if (!current || current.lifecycle === 'delivered') return current
  if (
    normalizeTechnicianId(current.technicianId) !== techId ||
    normalizeTechnicianId(current.snapshot?.technicianId) !== techId
  ) {
    throw new Error('Completion submission belongs to a different technician')
  }
  try {
    const acknowledgment = await api.post(`/visits/${current.visitId}/complete`, {
      submissionId: current.submissionId,
      technicianId: current.technicianId,
      snapshot: current.snapshot,
    })
    if (acknowledgment?.submissionId !== current.submissionId || acknowledgment?.acknowledged !== true) {
      throw new Error('Completion was not explicitly acknowledged')
    }
    const delivered = await markCompletionSubmissionDelivered(current.submissionId, acknowledgment, techId)
    const remainingPending = await getPendingCompletionSubmissions(techId)
    for (const duplicate of remainingPending) {
      if (duplicate.visitId === current.visitId && duplicate.submissionId !== current.submissionId) {
        await markCompletionSubmissionDelivered(duplicate.submissionId, acknowledgment, techId)
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
      lifecycle: error?.code === 'REPORT_CONTENT_MISMATCH' ? 'correction_required' : 'pending',
      attempts: (current.attempts ?? 0) + 1,
      lastError: error?.message ?? 'Delivery failed',
      mismatchFields: error?.fields ?? null,
      lastAttemptAt: new Date().toISOString(),
    })
    throw error
  }
}

let retryStarted = false
let retryInFlight = false
let onlineRetryHandler = null

export async function retryPendingCompletionSubmissions ({ activeTechnicianId = getActiveTechnicianId() } = {}) {
  const techId = normalizeTechnicianId(activeTechnicianId)
  const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine !== false
  if (retryInFlight || !isOnline || !techId) return []
  retryInFlight = true
  try {
    const pending = await getPendingCompletionSubmissions(techId)
    const seenVisits = new Set()
    const results = []
    for (const record of pending) {
      if (seenVisits.has(record.visitId)) continue
      seenVisits.add(record.visitId)
      try {
        results.push(await deliverCompletionSubmission(record, { activeTechnicianId: techId }))
      } catch (_) {
        results.push(null)
      }
    }
    return results
  } finally {
    retryInFlight = false
  }
}

export function startCompletionSubmissionRetry () {
  if (retryStarted) return
  retryStarted = true
  onlineRetryHandler = () => {
    void retryPendingCompletionSubmissions().catch(error => {
      // Delivery is independent from navigation. A local storage or transport
      // problem remains observable in the outbox but must not reject boot.
      console.error('Pending completion retry failed:', error)
    })
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('online', onlineRetryHandler)
  }
  onlineRetryHandler()
}

export function stopCompletionSubmissionRetry () {
  if (onlineRetryHandler && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
    window.removeEventListener('online', onlineRetryHandler)
  }
  onlineRetryHandler = null
  retryStarted = false
}
