require('fake-indexeddb/auto')
const fs = require('fs/promises')
const path = require('path')

describe('Local Visit Draft IndexedDB persistence', () => {
  let db
  let draft

  beforeAll(async () => {
    const source = await fs.readFile(path.join(__dirname, '../frontend/pwa/src/lib/db.js'), 'utf8')
    db = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
    draft = await import('../frontend/pwa/src/lib/workspace-visit.mjs')
  })

  beforeEach(async () => {
    db.closeLocalDatabase()
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('fieldops')
      request.onsuccess = resolve
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('IndexedDB deletion blocked'))
    })
  })

  afterAll(() => db?.closeLocalDatabase())

  it('saves a draft and restores it after the database connection closes', async () => {
    const localDraft = draft.createLocalVisitDraft({
      id: 'visit-1',
      notes: 'Before close',
      items: [{
        id: 'item-1', itemName: 'FIN180P', category: 'accessory',
        description: null, quantity: 1, price: 10, techSupplied: true,
      }],
    })
    await db.saveLocalVisitDraft(localDraft)
    db.closeLocalDatabase()

    await expect(db.getLocalVisitDraft('visit-1')).resolves.toMatchObject({
      id: 'visit-1', draftSchemaVersion: 1, lifecycle: 'draft', notes: 'Before close',
    })
    const restored = await db.getLocalVisitDraft('visit-1')
    expect(restored._items).toEqual([expect.objectContaining({ id: 'item-1', item_name: 'FIN180P' })])
  })

  it('does not treat an unknown visits-store record as a Local Visit Draft', async () => {
    await db.setVisit({ id: 'legacy-visit', address: { street: 'Old record' } })

    await expect(db.getLocalVisitDraft('legacy-visit')).resolves.toBeNull()
    await expect(db.getAllLocalVisitDrafts()).resolves.toEqual([])
  })

  it('does not restore a draft whose visit items lack stable identities', async () => {
    await db.setVisit({
      id: 'incomplete-draft', draftSchemaVersion: 1, lifecycle: 'draft', _items: [
        { item_name: 'FIN180P', category: 'accessory' },
      ],
    })

    await expect(db.getLocalVisitDraft('incomplete-draft')).resolves.toBeNull()
  })

  it('persists Notes and Checklist local mutations independently of the backend', async () => {
    const localDraft = draft.createLocalVisitDraft({ id: 'visit-mutation' })
    draft.updateLocalVisitDraftNotes(localDraft, 'Durable note', '2026-08-18T12:00:00.000Z')
    draft.toggleLocalVisitDraftChecklist(localDraft, 'pdrain_ecoil', 'no', '2026-08-18T12:01:00.000Z')
    await db.saveLocalVisitDraft(localDraft)

    const restored = await db.getLocalVisitDraft('visit-mutation')
    expect(restored.notes).toBe('Durable note')
    expect(restored._checklist).toEqual({ pdrain_ecoil: 'no' })
    expect(restored.dirty).toBe(true)
  })

  it('restores Finish-only as a durable valid Service selection', async () => {
    const localDraft = draft.createLocalVisitDraft({
      id: 'visit-finish-only',
      services: [{ serviceName: 'Finish', isFinish: true, isTemporarily: false, price: 0 }],
      totalPrice: 0,
    })
    await db.saveLocalVisitDraft(localDraft)
    db.closeLocalDatabase()

    const restored = await db.getLocalVisitDraft('visit-finish-only')
    expect(restored._service).toMatchObject({ finish: true, ac: false, heat: false, prestart: false, driveRun: false })
    expect(restored.totalPrice).toBe(0)
  })

  it('restores confirmed Cancel mode with Notes and Checklist but no work state', async () => {
    const localDraft = draft.createLocalVisitDraft({
      id: 'visit-cancel-mode',
      items: [{ id: 'item-1', itemName: 'FIN180P', category: 'accessory', quantity: 1, price: 10 }],
      notes: 'No access',
      checklist: { gas_meter: 'no' },
      totalPrice: 10,
    })
    draft.enterLocalVisitDraftCancelMode(localDraft)
    await db.saveLocalVisitDraft(localDraft)
    db.closeLocalDatabase()

    const restored = await db.getLocalVisitDraft('visit-cancel-mode')
    expect(restored).toMatchObject({
      _cancelMode: { confirmed: true },
      _service: expect.objectContaining({ cancel: true }),
      _items: [],
      totalPrice: 0,
      notes: 'No access',
      _checklist: { gas_meter: 'no' },
    })
  })

  it('keeps drafts isolated when switching visit A → B → A', async () => {
    const draftA = draft.createLocalVisitDraft({ id: 'visit-a', checklist: { gas_meter: 'no' }, notes: 'A note' })
    draft.enterLocalVisitDraftCancelMode(draftA)
    const draftB = draft.createLocalVisitDraft({ id: 'visit-b', totalPrice: 0 })
    await db.saveLocalVisitDraft(draftA)
    await db.saveLocalVisitDraft(draftB)

    const restoredB = await db.getLocalVisitDraft('visit-b')
    const restoredA = await db.getLocalVisitDraft('visit-a')
    expect(restoredB).toMatchObject({ _cancelMode: null, _checklist: {}, _activeStep: 'service', totalPrice: 0 })
    expect(restoredA).toMatchObject({ _cancelMode: { confirmed: true }, _checklist: { gas_meter: 'no' }, notes: 'A note', _activeStep: 'notes' })
  })
})
