describe('My Calls Job Card actions', () => {
  let canCancelVisit
  let getJobCardActionState
  let openPendingCancelWorkspace
  let startJobAndOpenWorkspace

  beforeAll(async () => {
    ({ canCancelVisit, getJobCardActionState, openPendingCancelWorkspace, startJobAndOpenWorkspace } = await import('../frontend/pwa/src/lib/job-card-actions.mjs'))
  })

  it.each(['assigned', 'deferred', 'in_progress'])('renders Cancel for %s visits', status => {
    expect(canCancelVisit(status)).toBe(true)
  })

  it.each(['pending_review', 'in_lobby', 'completed', 'temporarily', 'cancelled'])('does not render Cancel for %s visits', status => {
    expect(canCancelVisit(status)).toBe(false)
  })

  it('keeps normal assigned and in-progress card actions unchanged', () => {
    expect(getJobCardActionState('assigned')).toBe('assigned')
    expect(getJobCardActionState('in_progress')).toBe('in_progress')
  })

  it('uses the local confirmed Cancel marker for Cancel Pending instead of showing Cancel again', () => {
    expect(getJobCardActionState('in_progress', true)).toBe('cancel_pending')
    expect(getJobCardActionState('assigned', true)).toBe('cancel_pending')
  })

  it('keeps a backend-cancelled visit distinct from a local pending Cancel', () => {
    expect(getJobCardActionState('cancelled', true)).toBe('none')
  })

  it('continues the pending Cancel for its own visit without another confirmation', () => {
    const calls = []
    openPendingCancelWorkspace({
      visitId: 'visit-a',
      setWorkspaceVisitId: id => calls.push(`set:${id}`),
      openWorkspace: id => calls.push(`open:${id}`),
    })

    expect(calls).toEqual(['set:visit-a', 'open:visit-a'])
  })

  it('opens Workspace immediately after a successful Start', async () => {
    const calls = []
    await startJobAndOpenWorkspace({
      visitId: 'visit-start',
      startVisit: async () => { calls.push('start') },
      setWorkspaceVisitId: id => calls.push(`set:${id}`),
      onStarted: () => calls.push('reload'),
      openWorkspace: id => calls.push(`open:${id}`),
    })

    expect(calls).toEqual(['start', 'set:visit-start', 'reload', 'open:visit-start'])
  })

  it('does not navigate when Start fails', async () => {
    const openWorkspace = jest.fn()
    await expect(startJobAndOpenWorkspace({
      visitId: 'visit-fail',
      startVisit: async () => { throw new Error('start failed') },
      setWorkspaceVisitId: jest.fn(),
      onStarted: jest.fn(),
      openWorkspace,
    })).rejects.toThrow('start failed')

    expect(openWorkspace).not.toHaveBeenCalled()
  })
})
