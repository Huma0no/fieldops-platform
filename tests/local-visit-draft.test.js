require('fake-indexeddb/auto')
const fs = require('fs/promises')
const path = require('path')

function createMemoryStorage () {
  const store = new Map()
  return {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key),
    clear: () => store.clear(),
  }
}

function setActiveSession (technicianId, token = `token-${technicianId}`) {
  if (!technicianId) {
    globalThis.localStorage.removeItem('deviceToken')
    globalThis.localStorage.removeItem('technician')
    return
  }
  globalThis.localStorage.setItem('deviceToken', token)
  globalThis.localStorage.setItem('technician', JSON.stringify({ id: technicianId, role: 'technician' }))
}

describe('Local Visit Draft IndexedDB persistence', () => {
  let db
  let draft

  beforeAll(async () => {
    globalThis.localStorage = globalThis.localStorage || createMemoryStorage()
    const source = await fs.readFile(path.join(__dirname, '../frontend/pwa/src/lib/db.js'), 'utf8')
    db = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
    draft = await import('../frontend/pwa/src/lib/workspace-visit.mjs')
  })

  beforeEach(async () => {
    globalThis.localStorage.clear()
    setActiveSession('tech-001')
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
      technicianId: 'tech-001',
      notes: 'Before close',
      items: [{
        id: 'item-1', itemName: 'FIN180P', category: 'accessory',
        description: null, quantity: 1, price: 10, techSupplied: true,
      }],
    })
    await db.saveLocalVisitDraft(localDraft)
    expect(localDraft.id).toBe('visit-1')
    db.closeLocalDatabase()

    await expect(db.getLocalVisitDraft('visit-1')).resolves.toMatchObject({
      id: 'visit-1', technicianId: 'tech-001', draftSchemaVersion: 1, lifecycle: 'draft', notes: 'Before close',
    })
    const restored = await db.getLocalVisitDraft('visit-1')
    expect(restored._items).toEqual([expect.objectContaining({ id: 'item-1', item_name: 'FIN180P' })])
  })

  it('does not treat an unknown visits-store record as a Local Visit Draft', async () => {
    await db.setVisit({ id: 'legacy-visit', technicianId: 'tech-001', address: { street: 'Old record' } })

    await expect(db.getLocalVisitDraft('legacy-visit')).resolves.toBeNull()
    await expect(db.getAllLocalVisitDrafts()).resolves.toEqual([])
  })

  it('does not restore a draft whose visit items lack stable identities', async () => {
    await db.setVisit({
      id: 'incomplete-draft', technicianId: 'tech-001', draftSchemaVersion: 1, lifecycle: 'draft', _items: [
        { item_name: 'FIN180P', category: 'accessory' },
      ],
    })

    await expect(db.getLocalVisitDraft('incomplete-draft')).resolves.toBeNull()
  })

  it('persists Notes and Checklist local mutations independently of the backend', async () => {
    const localDraft = draft.createLocalVisitDraft({ id: 'visit-mutation', technicianId: 'tech-001' })
    draft.updateLocalVisitDraftNotes(localDraft, 'Durable note', '2026-08-18T12:00:00.000Z')
    draft.toggleLocalVisitDraftChecklist(localDraft, 'pdrain_ecoil', 'no', '2026-08-18T12:01:00.000Z')
    await db.saveLocalVisitDraft(localDraft)

    const restored = await db.getLocalVisitDraft('visit-mutation')
    expect(restored.notes).toBe('Durable note')
    expect(restored._checklist).toEqual({ pdrain_ecoil: 'no' })
    expect(restored.dirty).toBe(true)
  })

  it('does not mutate the draft passed to saveLocalVisitDraft', async () => {
    const localDraft = draft.createLocalVisitDraft({ id: 'visit-no-mutation' })
    delete localDraft.technicianId
    const before = JSON.stringify(localDraft)
    await db.saveLocalVisitDraft(localDraft, 'tech-001')
    expect(JSON.stringify(localDraft)).toBe(before)
    expect((await db.getLocalVisitDraft('visit-no-mutation', 'tech-001')).technicianId).toBe('tech-001')
  })

  it('restores Finish-only as a durable valid Service selection', async () => {
    const localDraft = draft.createLocalVisitDraft({
      id: 'visit-finish-only',
      technicianId: 'tech-001',
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
      technicianId: 'tech-001',
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
    const draftA = draft.createLocalVisitDraft({ id: 'visit-a', technicianId: 'tech-001', checklist: { gas_meter: 'no' }, notes: 'A note' })
    draft.enterLocalVisitDraftCancelMode(draftA)
    const draftB = draft.createLocalVisitDraft({ id: 'visit-b', technicianId: 'tech-001', totalPrice: 0 })
    await db.saveLocalVisitDraft(draftA)
    await db.saveLocalVisitDraft(draftB)

    const restoredB = await db.getLocalVisitDraft('visit-b')
    const restoredA = await db.getLocalVisitDraft('visit-a')
    expect(restoredB).toMatchObject({ _cancelMode: null, _checklist: {}, _activeStep: 'service', totalPrice: 0 })
    expect(restoredA).toMatchObject({ _cancelMode: { confirmed: true }, _checklist: { gas_meter: 'no' }, notes: 'A note', _activeStep: 'notes' })
  })

  it('isolates drafts and My Calls caches when two technicians use the same device and visit ID while preserving canonical visitId in memory and on read', async () => {
    setActiveSession('tech-001')
    const draftTech1 = draft.createLocalVisitDraft({
      id: 'shared-visit-1',
      technicianId: 'tech-001',
      notes: 'Tech 1 private draft',
      totalPrice: 150,
    })
    await db.saveLocalVisitDraft(draftTech1)
    expect(draftTech1.id).toBe('shared-visit-1')
    await db.cacheMyCallsVisits([{ id: 'shared-visit-1', status: 'in_progress', address: { street: '100 Main' } }])

    // Switch to Tech 2 on the same device after visit reassignment
    setActiveSession('tech-002')
    await expect(db.getLocalVisitDraft('shared-visit-1')).resolves.toBeNull()
    await expect(db.getAllLocalVisitDrafts()).resolves.toEqual([])
    await expect(db.getCachedMyCallsVisits()).resolves.toEqual([])

    const draftTech2 = draft.createLocalVisitDraft({
      id: 'shared-visit-1',
      technicianId: 'tech-002',
      notes: 'Tech 2 separate draft',
      totalPrice: 225,
    })
    await db.saveLocalVisitDraft(draftTech2)
    expect(draftTech2.id).toBe('shared-visit-1')
    await db.cacheMyCallsVisits([{ id: 'shared-visit-1', status: 'assigned', address: { street: '100 Main' } }])

    await expect(db.getLocalVisitDraft('shared-visit-1')).resolves.toMatchObject({
      id: 'shared-visit-1',
      technicianId: 'tech-002',
      notes: 'Tech 2 separate draft',
      totalPrice: 225,
    })

    // Tech 2 deleting their draft must not delete Tech 1's draft
    await db.deleteLocalVisitDraft('shared-visit-1')
    await expect(db.getLocalVisitDraft('shared-visit-1')).resolves.toBeNull()

    // Switch back to Tech 1 — Tech 1's draft and My Calls summary are still intact
    setActiveSession('tech-001')
    const restoredTech1 = await db.getLocalVisitDraft('shared-visit-1')
    expect(restoredTech1).toMatchObject({
      id: 'shared-visit-1',
      technicianId: 'tech-001',
      notes: 'Tech 1 private draft',
      totalPrice: 150,
    })
    expect(restoredTech1.visitId).toBeUndefined()
    await expect(db.getCachedMyCallsVisits()).resolves.toEqual([
      expect.objectContaining({ id: 'shared-visit-1', status: 'in_progress', technicianId: 'tech-001' }),
    ])
  })

  it('preserves legacy bare-key records for their matching technician and quarantines legacy records with ambiguous ownership', async () => {
    // Seed a legacy bare-key draft belonging to tech-001 and an ambiguous bare-key draft with technicianId: null
    const legacyOwned = {
      ...draft.createLocalVisitDraft({ id: 'legacy-owned', technicianId: 'tech-001', notes: 'Legacy owned by tech-001' }),
      _myCallsSummary: { id: 'legacy-owned', technicianId: 'tech-002', status: 'assigned' },
    }
    const legacyAmbiguous = draft.createLocalVisitDraft({ id: 'legacy-ambiguous', technicianId: null, notes: 'Ambiguous owner' })
    await db.setVisit(legacyOwned)
    await db.setVisit(legacyAmbiguous)

    // Tech 2 cannot read either legacy record, and Tech 2 saving 'legacy-owned' does not overwrite Tech 1's bare record
    setActiveSession('tech-002')
    await expect(db.getLocalVisitDraft('legacy-owned')).resolves.toBeNull()
    await expect(db.getLocalVisitDraft('legacy-ambiguous')).resolves.toBeNull()
    await expect(db.getAllLocalVisitDrafts()).resolves.toEqual([])

    const tech2Draft = draft.createLocalVisitDraft({ id: 'legacy-owned', technicianId: 'tech-002', notes: 'Tech 2 scoped write' })
    await db.saveLocalVisitDraft(tech2Draft)

    // Switch back to Tech 1: Tech 1 still reads its legacy-owned draft (with mismatched _myCallsSummary stripped),
    // while legacy-ambiguous remains quarantined in place
    setActiveSession('tech-001')
    const restoredOwned = await db.getLocalVisitDraft('legacy-owned')
    expect(restoredOwned).toMatchObject({
      id: 'legacy-owned',
      technicianId: 'tech-001',
      notes: 'Legacy owned by tech-001',
    })
    expect(restoredOwned._myCallsSummary).toBeUndefined()
    await expect(db.getLocalVisitDraft('legacy-ambiguous')).resolves.toBeNull()
    const rawAmbiguous = await db.getVisit('legacy-ambiguous')
    expect(rawAmbiguous).toMatchObject({ id: 'legacy-ambiguous', technicianId: null, notes: 'Ambiguous owner' })
  })

  it('isolates photos and queue entries per technician and quarantines legacy entries without technicianId', async () => {
    setActiveSession('tech-001')
    await db.addPhoto('visit-photo-1', 'SCALE', 'blob-tech-1')
    const q1 = await db.enqueue({ action: 'sync-1', visitId: 'visit-photo-1' })

    setActiveSession('tech-002')
    await expect(db.getPhotosForVisit('visit-photo-1')).resolves.toEqual([])
    await expect(db.getQueue()).resolves.toEqual([])

    // Tech 2 cannot delete Tech 1's photos or dequeue Tech 1's queue entry
    await db.deletePhotosForVisit('visit-photo-1')
    await db.dequeue(q1)

    await db.addPhoto('visit-photo-1', 'FAN', 'blob-tech-2')
    await db.enqueue({ action: 'sync-2', visitId: 'visit-photo-1' })

    await expect(db.getPhotosForVisit('visit-photo-1')).resolves.toEqual([
      expect.objectContaining({ visitId: 'visit-photo-1', tag: 'FAN', technicianId: 'tech-002' }),
    ])
    await expect(db.getQueue()).resolves.toEqual([
      expect.objectContaining({ action: 'sync-2', technicianId: 'tech-002' }),
    ])

    // Switch back to Tech 1: Tech 1's photo and queue entry remain intact
    setActiveSession('tech-001')
    await expect(db.getPhotosForVisit('visit-photo-1')).resolves.toEqual([
      expect.objectContaining({ visitId: 'visit-photo-1', tag: 'SCALE', technicianId: 'tech-001' }),
    ])
    await expect(db.getQueue()).resolves.toEqual([
      expect.objectContaining({ id: q1, action: 'sync-1', technicianId: 'tech-001' }),
    ])

    // When unauthenticated (after 401), all readers fail closed while preserving stored data
    setActiveSession(null)
    await expect(db.getPhotosForVisit('visit-photo-1')).resolves.toEqual([])
    await expect(db.getQueue()).resolves.toEqual([])
    await expect(db.getLocalVisitDraft('visit-photo-1')).resolves.toBeNull()
  })
})
