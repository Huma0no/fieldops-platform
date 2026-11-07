require('fake-indexeddb/auto')

const fs = require('fs/promises')
const path = require('path')

describe('durable completion submissions', () => {
  let db
  let submissions
  let drafts
  let mockApiImpl

  beforeAll(async () => {
    globalThis.CustomEvent = globalThis.CustomEvent || class CustomEvent {
      constructor (type, init = {}) {
        this.type = type
        this.detail = init.detail
      }
    }
    globalThis.__testCompletionApiPost = async (url, body) => {
      if (mockApiImpl) return mockApiImpl(url, body)
      return { acknowledged: true, submissionId: body?.submissionId }
    }
    const asModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
    const dbSource = await fs.readFile(path.join(__dirname, '../frontend/pwa/src/lib/db.js'), 'utf8')
    const draftSource = await fs.readFile(path.join(__dirname, '../frontend/pwa/src/lib/workspace-visit.mjs'), 'utf8')
    const cancelSource = await fs.readFile(path.join(__dirname, '../frontend/pwa/src/lib/cancel-justification.mjs'), 'utf8')
    const submissionSource = await fs.readFile(path.join(__dirname, '../frontend/pwa/src/lib/completion-submission.mjs'), 'utf8')
    const dbUrl = asModule(dbSource)
    const draftUrl = asModule(draftSource)
    const cancelUrl = asModule(cancelSource)
    const apiUrl = asModule('export const api = { post: (...args) => globalThis.__testCompletionApiPost(...args) }')
    const rewritten = submissionSource
      .replace("'./db.js'", `'${dbUrl}'`)
      .replace("'../../../shared/api.js'", `'${apiUrl}'`)
      .replace("'./cancel-justification.mjs'", `'${cancelUrl}'`)
      .replace("'./workspace-visit.mjs'", `'${draftUrl}'`)
    db = await import(dbUrl)
    submissions = await import(asModule(rewritten))
    drafts = await import(draftUrl)
  })

  beforeEach(async () => {
    mockApiImpl = null
    db.closeLocalDatabase()
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('fieldops')
      request.onsuccess = resolve
      request.onerror = () => reject(request.error)
    })
  })

  afterAll(() => db?.closeLocalDatabase())

  function normalDraft () {
    return drafts.createLocalVisitDraft({
      id: 'submission-visit',
      services: [{ serviceName: 'AC', isFinish: false, isTemporarily: false, price: 150 }],
      items: [{ id: 'item-1', itemName: 'FIN180P', category: 'accessory', quantity: 1, price: 10, techSupplied: true }],
      notes: 'Stable note',
      checklist: { gas_meter: 'no' },
      totalPrice: 160,
    })
  }

  it('freezes the complete draft source before durable pending delivery', async () => {
    const draft = normalDraft()
    const submission = await submissions.createPendingCompletionSubmission(draft, {
      id: 'submission-1', now: '2026-08-23T10:00:00.000Z',
      checklistAnswers: [{ item: 'gas_meter', answer: 'no', reportText: 'meter issue', photoCount: 0 }],
    })
    draft.notes = 'Changed later'
    draft._items[0].price = 999

    const [restored] = await db.getPendingCompletionSubmissions()
    expect(restored).toMatchObject({ submissionId: 'submission-1', lifecycle: 'pending', visitId: 'submission-visit' })
    expect(restored.snapshot).toMatchObject({
      terminalIntent: 'completed', notes: 'Stable note', totalPrice: 160,
      items: [expect.objectContaining({ item_name: 'FIN180P', price: 10 })],
      checklistAnswers: [expect.objectContaining({ reportText: 'meter issue' })],
    })
    expect(submission.snapshot.notes).toBe('Stable note')
  })

  it('survives IndexedDB close/reopen and retains independent pending visits', async () => {
    const first = normalDraft()
    const second = drafts.createLocalVisitDraft({
      id: 'submission-visit-2',
      services: [{ serviceName: 'Finish', isFinish: true, isTemporarily: false, price: 0 }],
      totalPrice: 0,
    })
    await submissions.createPendingCompletionSubmission(first, { id: 'submission-a' })
    await submissions.createPendingCompletionSubmission(second, { id: 'submission-b' })
    db.closeLocalDatabase()

    await expect(db.getPendingCompletionSubmissions()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ submissionId: 'submission-a', visitId: 'submission-visit' }),
      expect.objectContaining({ submissionId: 'submission-b', visitId: 'submission-visit-2' }),
    ]))
  })

  it('upgrades an existing v1 FieldOps database before reading the outbox', async () => {
    db.closeLocalDatabase()
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('fieldops', 1)
      request.onupgradeneeded = event => {
        const legacy = event.target.result
        legacy.createObjectStore('catalog', { keyPath: 'type' })
        legacy.createObjectStore('visits', { keyPath: 'id' })
        legacy.createObjectStore('queue', { keyPath: 'id', autoIncrement: true })
        const photos = legacy.createObjectStore('photos', { keyPath: 'id', autoIncrement: true })
        photos.createIndex('visitId', 'visitId', { unique: false })
      }
      request.onsuccess = () => { request.result.close(); resolve() }
      request.onerror = () => reject(request.error)
    })

    await expect(db.getPendingCompletionSubmissions()).resolves.toEqual([])
    await submissions.createPendingCompletionSubmission(normalDraft(), { id: 'upgraded-submission' })
    await expect(db.getPendingCompletionSubmissions()).resolves.toEqual([
      expect.objectContaining({ submissionId: 'upgraded-submission' }),
    ])
  })

  it('keeps a downloaded My Calls summary without overwriting its Local Visit Draft', async () => {
    const draft = normalDraft()
    await db.saveLocalVisitDraft(draft)
    await db.cacheMyCallsVisits([{
      id: draft.id, status: 'in_progress', address: { street: '100 Cached Way' }, scheduled_time: '2026-08-23T12:00:00Z',
    }, {
      id: 'assigned-cached', status: 'assigned', address: { street: '200 Cached Way' }, systems: [{ systemNumber: 1 }],
    }])

    await expect(db.getLocalVisitDraft(draft.id)).resolves.toMatchObject({
      id: draft.id, notes: 'Stable note', _items: [expect.objectContaining({ id: 'item-1' })],
    })
    await expect(db.getCachedMyCallsVisits()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: draft.id, status: 'in_progress' }),
      expect.objectContaining({ id: 'assigned-cached', status: 'assigned' }),
    ]))
  })

  it('marks only the explicitly acknowledged submission delivered and retains its immutable record', async () => {
    await submissions.createPendingCompletionSubmission(normalDraft(), { id: 'delivery-a' })
    const second = drafts.createLocalVisitDraft({
      id: 'delivery-visit-b',
      services: [{ serviceName: 'Finish', isFinish: true, price: 0 }],
    })
    await submissions.createPendingCompletionSubmission(second, { id: 'delivery-b' })

    await db.markCompletionSubmissionDelivered('delivery-a', { acknowledged: true, submissionId: 'delivery-a' })
    await expect(db.getCompletionSubmission('delivery-a')).resolves.toMatchObject({
      lifecycle: 'delivered', acknowledgment: { acknowledged: true, submissionId: 'delivery-a' },
    })
    await expect(db.getPendingCompletionSubmissions()).resolves.toEqual([
      expect.objectContaining({ submissionId: 'delivery-b', lifecycle: 'pending' }),
    ])
  })

  it('creates a Cancel snapshot without normal work and preserves justification', async () => {
    const draft = normalDraft()
    drafts.enterLocalVisitDraftCancelMode(draft)
    const snapshot = submissions.createCompletionSnapshot(draft, { id: 'cancel-submission' })
    expect(snapshot).toMatchObject({ terminalIntent: 'cancelled', cancel: true, totalPrice: 0, notes: 'Stable note' })
    expect(snapshot.items).toEqual([])
    expect(snapshot.weighInData).toEqual([])
  })

  it('rejects an invalid normal draft before it can enter the outbox', async () => {
    const draft = drafts.createLocalVisitDraft({ id: 'no-service' })
    await expect(submissions.createPendingCompletionSubmission(draft, { id: 'invalid' }))
      .rejects.toThrow('No service selected')
    await expect(db.getPendingCompletionSubmissions()).resolves.toEqual([])
  })

  it('reuses the existing pending submissionId for the same visit instead of creating duplicates', async () => {
    const draft = normalDraft()
    const first = await submissions.createPendingCompletionSubmission(draft)
    draft.notes = 'Updated note before delivery'
    const second = await submissions.createPendingCompletionSubmission(draft)

    expect(second.submissionId).toBe(first.submissionId)
    const pending = await db.getPendingCompletionSubmissions()
    expect(pending).toHaveLength(1)
    expect(pending[0].submissionId).toBe(first.submissionId)
    expect(pending[0].snapshot.notes).toBe('Updated note before delivery')
  })

  it('preserves failed submissions on HTTP 500 and recovers on manual/automatic retry while reconciling duplicate pending records', async () => {
    const draft = normalDraft()
    await submissions.createPendingCompletionSubmission(draft, { id: 'legacy-dup-1' })
    await submissions.createPendingCompletionSubmission(draft, { id: 'legacy-dup-2' })

    mockApiImpl = async () => {
      throw new Error('Internal server error')
    }
    await expect(submissions.deliverCompletionSubmission('legacy-dup-1')).rejects.toThrow('Internal server error')

    const afterFailure = await db.getCompletionSubmission('legacy-dup-1')
    expect(afterFailure).toMatchObject({
      submissionId: 'legacy-dup-1',
      lifecycle: 'pending',
      attempts: 1,
      lastError: 'Internal server error',
    })
    expect(afterFailure.snapshot.notes).toBe('Stable note')

    const calls = []
    mockApiImpl = async (url, body) => {
      calls.push({ url, submissionId: body.submissionId })
      return { acknowledged: true, submissionId: body.submissionId }
    }

    const results = await submissions.retryPendingCompletionSubmissions()
    expect(results).toHaveLength(1)
    expect(calls).toHaveLength(1)
    await expect(db.getPendingCompletionSubmissions()).resolves.toEqual([])
    await expect(db.getCompletionSubmission('legacy-dup-1')).resolves.toMatchObject({ lifecycle: 'delivered' })
    await expect(db.getCompletionSubmission('legacy-dup-2')).resolves.toMatchObject({ lifecycle: 'delivered' })
  })
})
