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

describe('durable completion submissions', () => {
  let db
  let submissions
  let drafts
  let mockApiImpl

  beforeAll(async () => {
    globalThis.localStorage = globalThis.localStorage || createMemoryStorage()
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
    globalThis.localStorage.clear()
    setActiveSession('tech-001')
    db.closeLocalDatabase()
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('fieldops')
      request.onsuccess = resolve
      request.onerror = () => reject(request.error)
    })
  })

  afterAll(() => db?.closeLocalDatabase())

  function normalDraft (technicianId = 'tech-001', visitId = 'submission-visit') {
    return drafts.createLocalVisitDraft({
      id: visitId,
      technicianId,
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
    expect(restored).toMatchObject({
      submissionId: 'submission-1',
      technicianId: 'tech-001',
      lifecycle: 'pending',
      visitId: 'submission-visit',
    })
    expect(restored.snapshot).toMatchObject({
      technicianId: 'tech-001',
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
      technicianId: 'tech-001',
      services: [{ serviceName: 'Finish', isFinish: true, isTemporarily: false, price: 0 }],
      totalPrice: 0,
    })
    await submissions.createPendingCompletionSubmission(first, { id: 'submission-a' })
    await submissions.createPendingCompletionSubmission(second, { id: 'submission-b' })
    db.closeLocalDatabase()

    await expect(db.getPendingCompletionSubmissions()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ submissionId: 'submission-a', visitId: 'submission-visit', technicianId: 'tech-001' }),
      expect.objectContaining({ submissionId: 'submission-b', visitId: 'submission-visit-2', technicianId: 'tech-001' }),
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
      expect.objectContaining({ submissionId: 'upgraded-submission', technicianId: 'tech-001' }),
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
      technicianId: 'tech-001',
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
    expect(snapshot).toMatchObject({
      technicianId: 'tech-001',
      terminalIntent: 'cancelled',
      cancel: true,
      totalPrice: 0,
      notes: 'Stable note',
    })
    expect(snapshot.items).toEqual([])
    expect(snapshot.weighInData).toEqual([])
  })

  it('rejects an invalid normal draft before it can enter the outbox', async () => {
    const draft = drafts.createLocalVisitDraft({ id: 'no-service', technicianId: 'tech-001' })
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
      technicianId: 'tech-001',
      lifecycle: 'pending',
      attempts: 1,
      lastError: 'Internal server error',
    })
    expect(afterFailure.snapshot.notes).toBe('Stable note')

    const calls = []
    mockApiImpl = async (url, body) => {
      calls.push({ url, submissionId: body.submissionId, technicianId: body.technicianId })
      return { acknowledged: true, submissionId: body.submissionId }
    }

    const results = await submissions.retryPendingCompletionSubmissions()
    expect(results).toHaveLength(1)
    expect(calls).toEqual([{ url: '/visits/submission-visit/complete', submissionId: 'legacy-dup-1', technicianId: 'tech-001' }])
    await expect(db.getPendingCompletionSubmissions()).resolves.toEqual([])
    await expect(db.getCompletionSubmission('legacy-dup-1')).resolves.toMatchObject({ lifecycle: 'delivered' })
    await expect(db.getCompletionSubmission('legacy-dup-2')).resolves.toMatchObject({ lifecycle: 'delivered' })
  })

  it('keeps a rejected reviewed snapshot immutable and creates a new identity after explicit correction', async () => {
    const draft = normalDraft()
    const original = await submissions.createPendingCompletionSubmission(draft, { id: 'reviewed-before-rejection' })
    mockApiImpl = async () => {
      throw Object.assign(new Error('Report content changed; correct and resubmit'), {
        status: 409,
        code: 'REPORT_CONTENT_MISMATCH',
      })
    }
    await expect(submissions.deliverCompletionSubmission(original)).rejects.toThrow(/correct and resubmit/i)

    const rejected = await db.getCompletionSubmission(original.submissionId)
    expect(rejected).toMatchObject({ lifecycle: 'correction_required', attempts: 1 })
    expect(rejected.snapshot).toEqual(original.snapshot)
    await expect(db.getPendingCompletionSubmissions()).resolves.toEqual([])

    draft.notes = 'Corrected after review'
    const corrected = await submissions.createPendingCompletionSubmission(draft)
    expect(corrected.submissionId).not.toBe(original.submissionId)
    expect(corrected.snapshot.notes).toBe('Corrected after review')
    await expect(db.getCompletionSubmission(original.submissionId)).resolves.toMatchObject({
      lifecycle: 'correction_required', snapshot: original.snapshot,
    })
  })

  it('quarantines legacy completionSubmissions lacking technicianId without backfilling from LocalVisitDraft and never retries them', async () => {
    // Seed a LocalVisitDraft for tech-001 on the same visitId to verify we never backfill from it
    const draft = normalDraft('tech-001', 'visit-legacy-quarantine')
    await db.saveLocalVisitDraft(draft)

    // Seed a legacy pre-Package-2 completionSubmission without technicianId
    await db.saveCompletionSubmission({
      submissionId: 'legacy-unowned-sub',
      visitId: 'visit-legacy-quarantine',
      lifecycle: 'pending',
      createdAt: '2026-08-23T10:00:00.000Z',
      attempts: 0,
      lastError: null,
      snapshot: {
        version: 1,
        submissionId: 'legacy-unowned-sub',
        visitId: 'visit-legacy-quarantine',
        terminalIntent: 'completed',
        cancel: false,
        service: { serviceName: 'AC', ac: true },
        items: [],
        weighInData: [],
        systems: [],
        notes: 'Unowned legacy snapshot',
        checklistAnswers: [],
        evidenceRefs: [],
        totalPrice: 150,
      },
    })

    const calls = []
    mockApiImpl = async (url, body) => {
      calls.push({ url, body })
      return { acknowledged: true, submissionId: body.submissionId }
    }

    await expect(db.getCompletionSubmission('legacy-unowned-sub')).resolves.toBeNull()
    await expect(db.getPendingCompletionSubmissions()).resolves.toEqual([])
    await expect(db.getAllCompletionSubmissions()).resolves.toEqual([])
    await expect(submissions.retryPendingCompletionSubmissions()).resolves.toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('prevents cross-technician retry, delivery, or submissionId reuse when a visit is reassigned after an offline completion submission', async () => {
    setActiveSession('tech-001')
    const draftTech1 = normalDraft('tech-001', 'reassigned-visit-1')
    const subTech1 = await submissions.createPendingCompletionSubmission(draftTech1, { id: 'sub-tech-1' })

    // Reassign visit to Tech 2 and log in as Tech 2 on the same device
    setActiveSession('tech-002')
    const calls = []
    mockApiImpl = async (url, body) => {
      calls.push({ url, body })
      return { acknowledged: true, submissionId: body.submissionId }
    }

    // Tech 2 cannot see or retry Tech 1's pending submission
    await expect(db.getPendingCompletionSubmissions()).resolves.toEqual([])
    await expect(db.getAllCompletionSubmissions()).resolves.toEqual([])
    await expect(db.getCompletionSubmission('sub-tech-1')).resolves.toBeNull()
    await expect(submissions.retryPendingCompletionSubmissions()).resolves.toEqual([])
    expect(calls).toHaveLength(0)

    // Direct attempt to deliver Tech 1's submission record while authenticated as Tech 2 is rejected
    await expect(submissions.deliverCompletionSubmission(subTech1))
      .rejects.toThrow('Completion submission belongs to a different technician')
    expect(calls).toHaveLength(0)

    // Tech 2 creating their own pending submission for the same visitId generates a distinct submissionId
    // and never overwrites Tech 1's pending submission
    const draftTech2 = normalDraft('tech-002', 'reassigned-visit-1')
    draftTech2.notes = 'Tech 2 independent completion'
    const subTech2 = await submissions.createPendingCompletionSubmission(draftTech2)
    expect(subTech2.submissionId).not.toBe(subTech1.submissionId)
    expect(subTech2.technicianId).toBe('tech-002')
    expect(subTech2.snapshot.technicianId).toBe('tech-002')

    // Tech 1's submission remains preserved for Tech 1
    setActiveSession('tech-001')
    const pendingTech1 = await db.getPendingCompletionSubmissions()
    expect(pendingTech1).toEqual([
      expect.objectContaining({
        submissionId: 'sub-tech-1',
        visitId: 'reassigned-visit-1',
        technicianId: 'tech-001',
      }),
    ])
    expect(pendingTech1[0].snapshot.notes).toBe('Stable note')
  })

  it('halts retries during authentication expiration (401) while preserving pending submissions for same-technician recovery', async () => {
    setActiveSession('tech-001')
    const draft = normalDraft('tech-001', 'visit-401-recovery')
    await submissions.createPendingCompletionSubmission(draft, { id: 'sub-401-recovery' })

    // Simulate 401 session expiration clearing localStorage credentials
    setActiveSession(null)
    const calls = []
    mockApiImpl = async (url, body) => {
      calls.push({ url, body })
      return { acknowledged: true, submissionId: body.submissionId }
    }

    await expect(db.getPendingCompletionSubmissions()).resolves.toEqual([])
    await expect(submissions.retryPendingCompletionSubmissions()).resolves.toEqual([])
    await expect(submissions.deliverCompletionSubmission('sub-401-recovery')).resolves.toBeNull()
    expect(calls).toHaveLength(0)

    // Same technician re-authenticates -> pending submission is recovered and delivered idempotently
    setActiveSession('tech-001')
    await expect(db.getPendingCompletionSubmissions()).resolves.toEqual([
      expect.objectContaining({ submissionId: 'sub-401-recovery', technicianId: 'tech-001', lifecycle: 'pending' }),
    ])
    const results = await submissions.retryPendingCompletionSubmissions()
    expect(results).toHaveLength(1)
    expect(calls).toEqual([{
      url: '/visits/visit-401-recovery/complete',
      body: expect.objectContaining({
        submissionId: 'sub-401-recovery',
        technicianId: 'tech-001',
        snapshot: expect.objectContaining({
          submissionId: 'sub-401-recovery',
          visitId: 'visit-401-recovery',
          technicianId: 'tech-001',
        }),
      }),
    }])
    await expect(db.getCompletionSubmission('sub-401-recovery')).resolves.toMatchObject({
      submissionId: 'sub-401-recovery',
      technicianId: 'tech-001',
      lifecycle: 'delivered',
    })
  })
  it('keeps the pending submission and the local draft through a 401, then delivers automatically after sign-in', async () => {
    setActiveSession('tech-001')
    const draft = normalDraft('tech-001', 'visit-401-live')
    await db.saveLocalVisitDraft(draft, 'tech-001')
    await submissions.createPendingCompletionSubmission(draft, { id: 'sub-401-live' })

    // Reconnect with an ended session: the server answers 401.
    mockApiImpl = async () => {
      const err = new Error('Invalid, expired or revoked session')
      err.status = 401
      throw err
    }
    await submissions.retryPendingCompletionSubmissions()
    await expect(db.getCompletionSubmission('sub-401-live')).resolves.toMatchObject({ lifecycle: 'pending', attempts: 1 })

    // The app clears the session and shows sign-in; the technician's local data stays.
    setActiveSession(null)
    submissions.stopCompletionSubmissionRetry()
    await expect(db.getCompletionSubmission('sub-401-live', 'tech-001')).resolves.toMatchObject({ lifecycle: 'pending' })
    await expect(db.getLocalVisitDraft('visit-401-live', 'tech-001')).resolves.toMatchObject({ id: 'visit-401-live' })

    // Same technician signs in: app.js starts the retry, which delivers without user action.
    const calls = []
    mockApiImpl = async (url, body) => {
      calls.push(url)
      return { acknowledged: true, submissionId: body.submissionId }
    }
    setActiveSession('tech-001')
    submissions.startCompletionSubmissionRetry()
    for (let i = 0; i < 50 && calls.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 10))
    submissions.stopCompletionSubmissionRetry()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(calls).toEqual(['/visits/visit-401-live/complete'])
    await expect(db.getCompletionSubmission('sub-401-live')).resolves.toMatchObject({ lifecycle: 'delivered' })
    await expect(db.getLocalVisitDraft('visit-401-live', 'tech-001')).resolves.toMatchObject({ id: 'visit-401-live', notes: 'Stable note' })
  })
})
