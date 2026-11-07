const ACTIVE_STATUSES = new Set(['assigned', 'in_progress', 'temporarily'])

function isActiveVisit (visit) {
  return ACTIVE_STATUSES.has(visit?.status) || visit?.is_deferred === true
}

export function shouldShowMyCallsLoadError (remoteError, visits = []) {
  return Boolean(remoteError) && !visits.some(isActiveVisit)
}

// Converts durable Local Visit Drafts into the existing My Calls card shape.
// Server records win whenever available; this only enables offline recovery.
export function localDraftVisits (drafts = [], completionSubmissions = []) {
  const finalizedVisitIds = new Set(
    completionSubmissions
      .filter(entry => entry.lifecycle === 'pending' || entry.lifecycle === 'delivered')
      .map(entry => entry.visitId)
  )

  return drafts
    .filter(draft => !finalizedVisitIds.has(draft.id))
    .map(draft => ({
      id: draft.id,
      status: draft.status ?? draft.serverStatus ?? 'assigned',
      address: draft.address,
      scheduled_time: draft.scheduledTime,
      work_type: draft.workType,
      items: draft._items,
      total_price: draft.totalPrice,
      is_deferred: draft.isDeferred,
      systems: draft.systems,
      order_number: draft.orderNumber,
    }))
    .filter(isActiveVisit)
}

// Server records win whenever available; the local cache only fills gaps while
// offline and never creates a duplicate card for the same visit.
export function mergeMyCallsVisits (serverVisits = [], localVisits = []) {
  const known = new Set(serverVisits.map(visit => visit.id))
  return [...serverVisits, ...localVisits.filter(visit => !known.has(visit.id))]
}

export function localMyCallsVisits ({ drafts = [], cachedVisits = [], completionSubmissions = [] } = {}) {
  const draftsAsVisits = localDraftVisits(drafts, completionSubmissions)
  const finalizedVisitIds = new Set(
    completionSubmissions
      .filter(entry => entry.lifecycle === 'pending' || entry.lifecycle === 'delivered')
      .map(entry => entry.visitId)
  )
  return mergeMyCallsVisits(
    cachedVisits.filter(visit => !finalizedVisitIds.has(visit.id) && isActiveVisit(visit)),
    draftsAsVisits
  )
}

// Backwards-compatible name for focused callers while My Calls moves from
// draft-only recovery to durable downloaded-call recovery.
export function mergeLocalDraftVisits (visits = [], drafts = []) {
  const recovered = localDraftVisits(drafts)
  return mergeMyCallsVisits(visits, recovered)
}
