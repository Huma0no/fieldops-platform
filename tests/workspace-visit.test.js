describe('Local Visit Draft seeding', () => {
  let createLocalVisitDraft
  let confirmedLocalCancelVisitIds
  let consumeConfirmedCancelForVisit
  let discardLegacyUnconfirmedCancelOrigin
  let hasServiceSelection
  let isConfirmedLocalVisitDraftCancelMode
  let migrateLegacyConfirmedCancelMode
  let seedLocalVisitDraft
  let serviceNameFromState
  let toggleServiceSelection
  let enterLocalVisitDraftCancelMode

  beforeAll(async () => {
    ({ confirmedLocalCancelVisitIds, consumeConfirmedCancelForVisit, createLocalVisitDraft, discardLegacyUnconfirmedCancelOrigin, enterLocalVisitDraftCancelMode, hasServiceSelection, isConfirmedLocalVisitDraftCancelMode, migrateLegacyConfirmedCancelMode, seedLocalVisitDraft, serviceNameFromState, toggleServiceSelection } = await import('../frontend/pwa/src/lib/workspace-visit.mjs'))
  })

  it('creates one canonical draft from server detail with persisted item and Weigh-In fields', () => {
    const detail = {
      id: 'visit-1', status: 'assigned', updatedAt: '2026-08-18T10:00:00.000Z',
      notes: 'Existing field note', totalPrice: 15,
      address: { street: '100 Main St' }, systems: [{ systemNumber: 1, outdoorModel: 'COND-1' }],
      items: [{
        id: 'item-1', itemName: 'Other', category: 'accessory', description: 'Drain elbow',
        quantity: 2, price: 15, techSupplied: true,
      }],
      weighInData: [{ systemNumber: 1, linesetLength: 35, factoryLineConfig: 'STANDARD-25' }],
    }

    const draft = createLocalVisitDraft(detail, { catalogVersion: 'v2', now: '2026-08-18T11:00:00.000Z' })

    expect(draft).toMatchObject({
      id: 'visit-1', draftSchemaVersion: 1, lifecycle: 'draft', dirty: false,
      notes: 'Existing field note', totalPrice: 15, serverUpdatedAt: '2026-08-18T10:00:00.000Z',
    })
    expect(draft._items).toEqual([{
      id: 'item-1', item_name: 'Other', category: 'accessory', description: 'Drain elbow',
      quantity: 2, price: 15, tech_supplied: true,
    }])
    expect(draft._weighInData).toEqual([{ systemNumber: 1, linesetLength: 35, factoryLineConfig: 'STANDARD-25' }])
  })

  it('uses safe defaults for empty server work state', () => {
    const draft = createLocalVisitDraft({ id: 'visit-empty' }, { now: '2026-08-18T11:00:00.000Z' })

    expect(draft._items).toEqual([])
    expect(draft._weighInData).toEqual([])
    expect(draft.notes).toBe('')
    expect(draft._checklist).toEqual({})
    expect(isConfirmedLocalVisitDraftCancelMode(draft)).toBe(false)
  })

  it('does not infer Cancel from an empty Service, no items, or a zero total', () => {
    const draft = createLocalVisitDraft({ id: 'ordinary-empty', totalPrice: 0, items: [] })

    expect(draft._service).toMatchObject({ ac: false, heat: false, cancel: false })
    expect(isConfirmedLocalVisitDraftCancelMode(draft)).toBe(false)
  })

  it('identifies only the visit with a confirmed durable Cancel draft', () => {
    const draftA = createLocalVisitDraft({ id: 'visit-a' })
    const draftB = createLocalVisitDraft({ id: 'visit-b' })
    enterLocalVisitDraftCancelMode(draftA)

    const pendingIds = confirmedLocalCancelVisitIds([draftA, draftB])
    expect(pendingIds.has('visit-a')).toBe(true)
    expect(pendingIds.has('visit-b')).toBe(false)
  })

  it('consumes a My Calls Cancel confirmation only for its matching visit', () => {
    const entries = new Map([['workspace:cancelConfirmedVisitId', 'visit-a']])
    const storage = {
      getItem: key => entries.get(key) ?? null,
      removeItem: key => entries.delete(key),
    }

    expect(consumeConfirmedCancelForVisit(storage, 'visit-b')).toBe(false)
    expect(entries.get('workspace:cancelConfirmedVisitId')).toBe('visit-a')
    expect(consumeConfirmedCancelForVisit(storage, 'visit-a')).toBe(true)
    expect(entries.has('workspace:cancelConfirmedVisitId')).toBe(false)
  })

  it('discards the legacy global confirmation flag without applying it to a new visit', () => {
    const entries = new Map([['workspace:cancelConfirmed', 'true']])
    const storage = {
      getItem: key => entries.get(key) ?? null,
      removeItem: key => entries.delete(key),
    }

    expect(consumeConfirmedCancelForVisit(storage, 'new-visit')).toBe(false)
    expect(entries.size).toBe(0)
  })

  it('preserves an existing dirty draft instead of blindly reseeding it', () => {
    const existing = createLocalVisitDraft({ id: 'visit-dirty', notes: 'Local note' })
    existing.dirty = true

    expect(seedLocalVisitDraft(existing, { id: 'visit-dirty', notes: 'Server note' })).toBe(existing)
    expect(existing.notes).toBe('Local note')
  })

  it('hydrates Finish-only as the valid remaining Service selection', () => {
    const draft = createLocalVisitDraft({
      id: 'visit-finish',
      services: [{ serviceName: 'Finish', isFinish: true, isTemporarily: false, price: 0 }],
    })

    expect(draft._service).toMatchObject({ finish: true, ac: false, heat: false, prestart: false, driveRun: false })
    expect(serviceNameFromState(draft._service)).toBe('Finish')
  })

  it('keeps a final selected Service instead of creating an empty draft state', () => {
    const cases = [
      [{ ac: true }, 'ac', 'AC'],
      [{ heat: true }, 'heat', 'Heat'],
      [{ finish: true }, 'finish', 'Finish'],
    ]

    cases.forEach(([state, key, expected]) => {
      const service = { ac: false, heat: false, prestart: false, cancel: false, driveRun: false, finish: false, ...state }
      expect(toggleServiceSelection(service, key)).toBe(false)
      expect(hasServiceSelection(service)).toBe(true)
      expect(serviceNameFromState(service)).toBe(expected)
    })
  })

  it('maps first and combined Service selections to their canonical persisted values', () => {
    const service = { ac: false, heat: false, prestart: false, cancel: false, driveRun: false, finish: false }
    expect(toggleServiceSelection(service, 'finish')).toBe(true)
    expect(serviceNameFromState(service)).toBe('Finish')
    expect(toggleServiceSelection(service, 'ac')).toBe(true)
    expect(serviceNameFromState(service)).toBe('AC')
    expect(service.finish).toBe(true)
    expect(toggleServiceSelection(service, 'heat')).toBe(true)
    expect(serviceNameFromState(service)).toBe('AC & Heat')
  })

  it('enters local Cancel mode by clearing work while retaining Notes and Checklist', () => {
    const draft = {
      _service: { ac: true, heat: false, finish: true, temporarily: false },
      _items: [{ id: 'item-1', item_name: 'FIN180P', category: 'accessory' }],
      _weighInData: [{ systemNumber: 1, adjustedOz: 3 }],
      _weighInPhotos: { '1-SCALE': true },
      _weighinDone: true,
      totalPrice: 170,
      notes: 'Customer not present',
      _checklist: { gas_meter: 'no' },
    }

    enterLocalVisitDraftCancelMode(draft, '2026-08-19T12:00:00.000Z')

    expect(draft._service).toMatchObject({ cancel: true, ac: false, finish: false, temporarily: false })
    expect(draft._items).toEqual([])
    expect(draft._weighInData).toEqual([])
    expect(draft._weighInPhotos).toEqual({})
    expect(draft._weighinDone).toBe(false)
    expect(draft.totalPrice).toBe(0)
    expect(draft._cancelMode).toEqual({ confirmed: true, confirmedAt: '2026-08-19T12:00:00.000Z' })
    expect(draft._activeStep).toBe('notes')
    expect(draft.notes).toBe('Customer not present')
    expect(draft._checklist).toEqual({ gas_meter: 'no' })
  })

  it('does not migrate a lone legacy origin flag into Cancel mode', () => {
    const draft = createLocalVisitDraft({ id: 'legacy-origin-only' })
    draft._cancelOriginated = true
    draft._activeStep = 'notes'

    expect(migrateLegacyConfirmedCancelMode(draft)).toBe(false)
    expect(isConfirmedLocalVisitDraftCancelMode(draft)).toBe(false)
    expect(discardLegacyUnconfirmedCancelOrigin(draft)).toBe(true)
    expect(draft._cancelOriginated).toBeUndefined()
    expect(draft._activeStep).toBe('service')
  })

  it('migrates a legacy draft only when it has both legacy Cancel indicators', () => {
    const draft = createLocalVisitDraft({ id: 'legacy-confirmed' })
    draft._cancelOriginated = true
    draft._service.cancel = true

    expect(migrateLegacyConfirmedCancelMode(draft)).toBe(true)
    expect(isConfirmedLocalVisitDraftCancelMode(draft)).toBe(true)
    expect(draft._cancelOriginated).toBeUndefined()
  })
})
