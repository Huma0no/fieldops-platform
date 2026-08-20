// Job Card actions are status-based; Cancel remains available while an
// assigned visit is in progress because it is a job-level action.
export function canCancelVisit (status) {
  return ['assigned', 'deferred', 'in_progress'].includes(status)
}

// A confirmed local Cancel remains pending until Generate Report is delivered.
// It is not the same as the backend's terminal `cancelled` visit status.
export function getJobCardActionState (status, isCancelPending = false) {
  if (isCancelPending && canCancelVisit(status)) return 'cancel_pending'
  if (status === 'in_progress') return 'in_progress'
  if (canCancelVisit(status)) return 'assigned'
  return 'none'
}

export function openPendingCancelWorkspace ({ visitId, setWorkspaceVisitId, openWorkspace }) {
  setWorkspaceVisitId(visitId)
  openWorkspace(visitId)
}

export async function startJobAndOpenWorkspace ({ visitId, startVisit, setWorkspaceVisitId, onStarted, openWorkspace }) {
  await startVisit()
  setWorkspaceVisitId(visitId)
  onStarted?.()
  openWorkspace(visitId)
}
