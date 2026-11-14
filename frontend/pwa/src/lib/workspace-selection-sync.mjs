function immutableCopy (value) {
  return JSON.parse(JSON.stringify(value))
}

// Persist the latest full draft before syncing it. Intermediate selections are
// coalesced behind an in-flight request, so an older queued mutation cannot
// replay after and overwrite a newer local selection.
export function createWorkspaceSelectionSync ({ persist, synchronize, onState = () => {} }) {
  let requestedRevision = 0
  let completedRevision = 0
  let running = null
  let latestDraft = null

  async function drain () {
    while (completedRevision < requestedRevision) {
      const revision = requestedRevision
      await persist(latestDraft)
      const snapshot = immutableCopy(latestDraft)
      try {
        const result = await synchronize(snapshot)
        completedRevision = revision
        if (revision === requestedRevision) {
          onState('current', null, result)
          await persist(latestDraft)
        }
      } catch (error) {
        completedRevision = revision
        if (revision !== requestedRevision) continue
        onState('unavailable', error)
        await persist(latestDraft)
        return
      }
    }
  }

  function schedule (draft) {
    latestDraft = draft
    requestedRevision += 1
    if (!running) {
      running = drain().finally(() => {
        running = null
      })
    }
    return running
  }

  return { schedule }
}
