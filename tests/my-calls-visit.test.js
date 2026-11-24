describe('My Calls Local Visit Draft recovery', () => {
  let localMyCallsVisits
  let mergeMyCallsVisits
  let shouldShowMyCallsLoadError

  beforeAll(async () => {
    ({ localMyCallsVisits, mergeMyCallsVisits, shouldShowMyCallsLoadError } = await import('../frontend/pwa/src/lib/my-calls-visit.mjs'))
  })

  it('shows a local assigned draft when the server list is unavailable', () => {
    const result = localMyCallsVisits({ drafts: [{
      id: 'offline-assigned', status: 'assigned', address: { street: '100 Offline Way' },
      scheduledTime: '2026-08-23T09:00:00Z', workType: 'AC Startup', _items: [], totalPrice: 0,
    }] })
    expect(result).toEqual([expect.objectContaining({ id: 'offline-assigned', status: 'assigned' })])
  })

  it('shows a local in-progress draft when the server list is unavailable', () => {
    const result = localMyCallsVisits({ drafts: [{
      id: 'offline-visit', status: 'in_progress', address: { street: '100 Offline Way' },
      scheduledTime: '2026-08-23T09:00:00Z', workType: 'AC Startup', _items: [], totalPrice: 20,
    }] })
    expect(result).toEqual([expect.objectContaining({
      id: 'offline-visit', status: 'in_progress', scheduled_time: '2026-08-23T09:00:00Z', total_price: 20,
    })])
  })

  it('keeps the server card authoritative and does not duplicate it with its local draft', () => {
    const result = mergeMyCallsVisits(
      [{ id: 'visit-a', status: 'assigned', address: { street: 'Server address' } }],
      [{ id: 'visit-a', status: 'in_progress', address: { street: 'Local address' } }, { id: 'visit-b', status: 'assigned', address: { street: 'Local B' } }]
    )
    expect(result).toHaveLength(2)
    expect(result[0].address.street).toBe('Server address')
    expect(result[1]).toMatchObject({ id: 'visit-b', address: { street: 'Local B' } })
  })

  it('keeps a confirmed Cancel draft visible as its local in-progress card', () => {
    const result = localMyCallsVisits({ drafts: [{
      id: 'cancel-pending', status: 'in_progress', address: { street: '200 Cancel Way' }, _items: [], totalPrice: 0,
      _cancelMode: { confirmed: true },
    }] })
    expect(result).toEqual([expect.objectContaining({ id: 'cancel-pending', status: 'in_progress', total_price: 0 })])
  })

  it('excludes local work after a pending or delivered completion snapshot', () => {
    const draft = { id: 'submitted', status: 'in_progress', address: { street: '300 Done Way' }, _items: [] }
    expect(localMyCallsVisits({ drafts: [draft], completionSubmissions: [{ visitId: 'submitted', lifecycle: 'pending' }] })).toEqual([])
    expect(localMyCallsVisits({ drafts: [draft], completionSubmissions: [{ visitId: 'submitted', lifecycle: 'delivered' }] })).toEqual([])
  })

  it('uses downloaded cached calls if the remote refresh fails', () => {
    const result = localMyCallsVisits({ cachedVisits: [{
      id: 'cached-server-call', status: 'assigned', address: { street: '400 Cached Way' }, systems: [{ systemNumber: 1 }],
    }] })
    expect(result).toEqual([expect.objectContaining({ id: 'cached-server-call', status: 'assigned' })])
    expect(shouldShowMyCallsLoadError(new Error('offline'), result)).toBe(false)
  })

  it('shows the refresh error only when no locally workable call exists', () => {
    expect(shouldShowMyCallsLoadError(new Error('offline'), [])).toBe(true)
    expect(shouldShowMyCallsLoadError(new Error('offline'), [{ id: 'done', status: 'completed' }])).toBe(true)
    // Temporarily is terminal too (FT-02): not a workable call.
    expect(shouldShowMyCallsLoadError(new Error('offline'), [{ id: 'temp', status: 'temporarily' }])).toBe(true)
    expect(shouldShowMyCallsLoadError(null, [])).toBe(false)
  })
})
