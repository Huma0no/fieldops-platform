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
      id: 'offline-visit', status: 'in_progress', scheduledTime: '2026-08-23T09:00:00Z', totalPrice: 20,
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
    expect(result).toEqual([expect.objectContaining({ id: 'cancel-pending', status: 'in_progress', totalPrice: 0 })])
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

  it('leaves out a deferred call once it is finished: deferral never keeps a card (FT-03)', () => {
    const result = localMyCallsVisits({
      drafts: [{ id: 'deferred-done', status: 'completed', isDeferred: true, address: {} }],
      cachedVisits: [{ id: 'cached-deferred-done', status: 'temporarily', is_deferred: true }],
    })
    expect(result).toEqual([])
  })
})

describe('My Calls list after Generate Report (Day 2)', () => {
  let myCallsList

  beforeAll(async () => {
    ({ myCallsList } = await import('../frontend/pwa/src/lib/my-calls-visit.mjs'))
  })

  const call = (id, status = 'in_progress') => ({ id, status, address: { street: id } })

  it('drops a call whose Report is generated, even while the server still lists it (queued offline)', () => {
    const list = myCallsList({
      serverVisits: [call('reported'), call('open', 'assigned')],
      localVisits: [],
      completionSubmissions: [{ visitId: 'reported', lifecycle: 'pending' }],
    })
    expect(list.map(v => v.id)).toEqual(['open'])
  })

  it('is rebuilt from its sources, so a card never outlives them', () => {
    // The server no longer lists the delivered call and the phone has no
    // local copy of it: nothing keeps it.
    expect(myCallsList({ serverVisits: [call('open')], localVisits: [] }).map(v => v.id)).toEqual(['open'])
    // Offline: the downloaded calls only.
    expect(myCallsList({ serverVisits: null, localVisits: [call('cached')] }).map(v => v.id)).toEqual(['cached'])
  })

  it('keeps the server list authoritative for delivered Reports and inactive statuses', () => {
    const list = myCallsList({
      serverVisits: [call('reopened', 'assigned'), call('done', 'completed')],
      localVisits: [call('reopened')],
      completionSubmissions: [{ visitId: 'reopened', lifecycle: 'delivered' }],
    })
    expect(list.map(v => [v.id, v.status])).toEqual([['reopened', 'assigned']])
  })
})

describe('My Calls order (Day 2)', () => {
  it('puts deferred calls first, then sorts by scheduled time, a call without one last', async () => {
    const { sortMyCalls } = await import('../frontend/pwa/src/lib/my-calls-visit.mjs')
    const sorted = sortMyCalls([
      { id: 'late', scheduledTime: '2026-11-25T08:30:00' },
      { id: 'none', scheduledTime: null },
      { id: 'deferred', isDeferred: true, scheduledTime: '2026-11-25T09:00:00' },
      { id: 'early', scheduledTime: '2026-11-25T07:30:00' },
    ])
    expect(sorted.map(v => v.id)).toEqual(['deferred', 'early', 'late', 'none'])
  })
})

describe('My Calls expanded card briefing (FT-03)', () => {
  let myCallsBriefing

  beforeAll(async () => {
    ({ myCallsBriefing } = await import('../frontend/pwa/src/lib/my-calls-visit.mjs'))
  })

  const catalog = {
    equipment: [
      { model: 'ML14KC1-036', unit_type: 'condenser', brand: 'Lennox', refrigerant: 'R-454B', btu: 36000, pesp: null,
        charges: [{ manufacturer: 'Lennox', length_ft: 15, charge_oz: 78 }, { manufacturer: 'Lennox', length_ft: 30, charge_oz: 148 }] },
      { model: 'EL296V', unit_type: 'furnace', brand: 'Lennox', refrigerant: null, btu: null, pesp: 0.5, charges: [] },
    ],
    manufacturers: [{ name: 'Lennox', oz_per_ft: 0.6, default_length_ft: 30 }],
    catalogItems: [{ item_name: 'Ecoil Wire', label: 'EEV Wire' }, { item_name: 'UT3000', label: null }],
  }

  it('builds the card from the server detail: work type, chips, notes and per-system briefing', () => {
    const briefing = myCallsBriefing({
      workType: 'ac_heat',
      companyNotes: 'Gate code 1234',
      items: [
        { itemName: 'UT3000', category: 'accessory', quantity: 1 },
        { itemName: 'Ecoil Wire', category: 'accessory', quantity: 2 },
        { itemName: 'T6 Pro', category: 'thermostat', quantity: 2 },
        { itemName: 'Pressure Test', category: 'fix', quantity: 1 },
      ],
      systems: [{ systemNumber: 1, indoorModel: 'EL296V', outdoorModel: 'ML14KC1-036', refrigerant: null }],
    }, catalog)
    expect(briefing.workType).toBe('ac_heat')
    expect(briefing.notes).toBe('Gate code 1234')
    // Fixes are work, not pre-specified load: no chip.
    expect(briefing.chips).toEqual([
      { label: 'UT3000', quantity: 1 }, { label: 'EEV Wire', quantity: 2 }, { label: 'T6 Pro', quantity: 2 },
    ])
    expect(briefing.items).toHaveLength(4)
    expect(briefing.items[1]).toEqual({ itemName: 'Ecoil Wire', category: 'accessory', quantity: 2 })
    expect(briefing.systems).toEqual([{
      systemNumber: 1,
      indoorModel: 'EL296V', indoorType: 'Furnace',
      outdoorModel: 'ML14KC1-036', outdoorType: 'Condenser',
      tons: 3, refrigerant: 'R-454B',
      // Lennox default length 30 ft → 148 oz.
      factoryChargeOz: 148,
      esp: 0.5,
    }])
  })

  it('reads the Local Visit Draft the same way (offline), and leaves unknown values empty', () => {
    const briefing = myCallsBriefing({
      workType: 'prestart', companyNotes: null,
      _items: [{ item_name: 'Ecoil Wire', category: 'accessory', quantity: 1 }],
      systems: [
        { systemNumber: 1, indoorModel: 'Typed indoor', outdoorModel: 'Typed outdoor', refrigerant: 'R-410A' },
        { systemNumber: 2, indoorModel: null, outdoorModel: null, refrigerant: null },
      ],
    }, catalog)
    expect(briefing.chips).toEqual([{ label: 'EEV Wire', quantity: 1 }])
    expect(briefing.items).toEqual([{ itemName: 'Ecoil Wire', category: 'accessory', quantity: 1 }])
    expect(briefing.notes).toBeNull()
    expect(briefing.systems[0]).toEqual({
      systemNumber: 1, indoorModel: 'Typed indoor', indoorType: null, outdoorModel: 'Typed outdoor', outdoorType: null,
      tons: null, refrigerant: 'R-410A', factoryChargeOz: null, esp: null,
    })
    expect(briefing.systems[1].refrigerant).toBeNull()
    // No catalog cached yet: models still show.
    expect(myCallsBriefing({ systems: [{ systemNumber: 1, indoorModel: 'EL296V', outdoorModel: 'ML14KC1-036' }] }).systems[0])
      .toMatchObject({ indoorModel: 'EL296V', outdoorModel: 'ML14KC1-036', tons: null, factoryChargeOz: null })
  })
})
