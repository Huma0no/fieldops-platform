import { useState, useRef, useCallback, useEffect } from 'react'
import { api } from '@shared/api.js'
import AddressModal from '../components/AddressModal.jsx'

// ── Stage constants (PDF flow) ─────────────────────────────
const STAGE = { UPLOAD: 'upload', REVIEW: 'review', DONE: 'done' }

const PDF_FIELD_LABELS = {
  scheduledTime:           'Scheduled time',
  address:                 'Address',
  city:                    'City',
  subdivision:             'Subdivision',
  orderNumber:             'Order #',
  builder:                 'Builder',
  builderContactName:      'Contact name',
  builderContactPhone:     'Contact phone',
  workType:                'Work type',
  preSpecifiedThermostat:  'Thermostat',
  companyNotes:            'Company notes',
}

// ── Manual session persistence ─────────────────────────────
const STORAGE_KEY = 'fieldops_manual_batch'

function emptyDraft() {
  return {
    address: '', subdivision: '', builder: '',
    systems: [{ indoorModel: '', outdoorModel: '', coilModel: '' }],
    thermostat: '', thermostatQty: 1, accessories: '', notes: '',
    scheduledTime: '', orderNumber: '', contactName: '', contactPhone: '',
    workType: '', isPriority: false,
  }
}

function emptySession() {
  return { batchId: null, confirmedCalls: [] }
}

function loadStoredSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { session: emptySession(), draft: emptyDraft() }
    const stored = JSON.parse(raw)
    return {
      session: { batchId: stored.batchId || null, confirmedCalls: stored.confirmedCalls || [] },
      draft: stored.draft || emptyDraft(),
    }
  } catch {
    return { session: emptySession(), draft: emptyDraft() }
  }
}

function saveToStorage(session, draft) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...session, draft }))
  } catch {}
}

// ── Root ───────────────────────────────────────────────────

export default function CallIntake() {
  const stored = loadStoredSession()
  const [mode, setMode] = useState(stored.session.batchId ? 'manual' : 'pdf')

  return (
    <div style={s.page}>
      <div style={s.modeBar}>
        <button
          style={{ ...s.modeBtn, ...(mode === 'pdf' ? s.modeBtnActive : {}) }}
          onClick={() => setMode('pdf')}
        >
          PDF Upload
        </button>
        <button
          style={{ ...s.modeBtn, ...(mode === 'manual' ? s.modeBtnActive : {}) }}
          onClick={() => setMode('manual')}
        >
          Manual Entry
        </button>
      </div>
      {mode === 'pdf' ? <PdfFlow /> : <ManualFlow />}
    </div>
  )
}

// ── PDF flow (existing logic, unchanged) ───────────────────

function PdfFlow() {
  const [stage, setStage]             = useState(STAGE.UPLOAD)
  const [uploading, setUploading]     = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [batch, setBatch]             = useState(null)
  const [callIndex, setCallIndex]     = useState(1)
  const [call, setCall]               = useState(null)
  const [loadingCall, setLoadingCall] = useState(false)
  const [confirming, setConfirming]   = useState(false)
  const [skipping, setSkipping]       = useState(false)
  const [releasing, setReleasing]     = useState(false)
  const [releaseResult, setReleaseResult] = useState(null)
  const [addressModal, setAddressModal]   = useState(null)
  const [fields, setFields]           = useState({})
  const [pdfUrl, setPdfUrl]           = useState(null)
  const fileInputRef = useRef(null)
  const dropRef      = useRef(null)

  useEffect(() => {
    return () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl) }
  }, [pdfUrl])

  const handleFile = useCallback(async (file) => {
    if (!file || file.type !== 'application/pdf') {
      setUploadError('Please select a PDF file.')
      return
    }
    setUploading(true)
    setUploadError('')
    const objectUrl = URL.createObjectURL(file)
    setPdfUrl(objectUrl)
    const form = new FormData()
    form.append('pdf', file)
    form.append('filename', file.name)
    try {
      const data = await api.upload('/dispatch/parse-pdf', form)
      setBatch({ batchId: data.batchId, totalCalls: data.totalCalls })
      setStage(STAGE.REVIEW)
      loadCall(data.batchId, 1)
    } catch (err) {
      setUploadError('Extraction failed. Check your connection and try again.')
      console.error('parse-pdf failed:', err)
    } finally {
      setUploading(false)
    }
  }, [])

  const onDrop     = useCallback((e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]) }, [handleFile])
  const onDragOver = (e) => e.preventDefault()

  async function loadCall(batchId, index) {
    setLoadingCall(true)
    setCall(null)
    try {
      const data = await api.get(`/dispatch/batch/${batchId}/call/${index}`)
      setCall(data.call)
      setFields(flattenCall(data.call))
    } catch (err) {
      console.error('load call failed:', err)
    } finally {
      setLoadingCall(false)
    }
  }

  function flattenCall(extracted) {
    if (!extracted) return {}
    return {
      scheduledTime:            extracted.scheduledTime            ?? '',
      address:                  extracted.address                  ?? '',
      city:                     extracted.city                     ?? '',
      subdivision:              extracted.subdivision              ?? '',
      orderNumber:              extracted.orderNumber              ?? '',
      builder:                  extracted.builder                  ?? '',
      builderContactName:       extracted.builderContactName       ?? '',
      builderContactPhone:      extracted.builderContactPhone      ?? '',
      workType:                 extracted.workType                 ?? '',
      preSpecifiedThermostat:   extracted.preSpecifiedThermostat   ?? '',
      preIdentifiedAccessories: (extracted.preIdentifiedAccessories ?? []).join(', '),
      companyNotes:             extracted.companyNotes             ?? '',
    }
  }

  async function handleConfirm() {
    setConfirming(true)
    try {
      const body = {
        ...fields,
        preIdentifiedAccessories: fields.preIdentifiedAccessories
          ? fields.preIdentifiedAccessories.split(',').map(s => s.trim()).filter(Boolean)
          : [],
        systems: call?.systems ?? [],
      }
      const result = await api.post(`/dispatch/batch/${batch.batchId}/call/${callIndex}/confirm`, body)
      if (result.comparisonRequired) {
        setAddressModal({
          extracted: fields.address,
          existing:  result.existingAddress,
          onResolve: async (action) => {
            setAddressModal(null)
            await api.post(`/addresses/${result.existingAddress.id}/resolve-comparison`, { action, incomingData: body, pendingVisitData: body })
            advanceCall()
          },
          onCancel: () => setAddressModal(null),
        })
        return
      }
      advanceCall()
    } catch (err) {
      console.error('confirm failed:', err)
    } finally {
      setConfirming(false)
    }
  }

  async function handleSkip() {
    setSkipping(true)
    try {
      await api.post(`/dispatch/batch/${batch.batchId}/call/${callIndex}/skip`)
      advanceCall()
    } catch (err) {
      console.error('skip failed:', err)
    } finally {
      setSkipping(false)
    }
  }

  function advanceCall() {
    const next = callIndex + 1
    if (next > batch.totalCalls) {
      setStage(STAGE.DONE)
    } else {
      setCallIndex(next)
      loadCall(batch.batchId, next)
    }
  }

  async function handleRelease() {
    setReleasing(true)
    try {
      const result = await api.post(`/dispatch/batch/${batch.batchId}/release-to-lobby`)
      if (result.mismatch) {
        setReleaseResult({ mismatch: true, expected: result.expected, actual: result.actual })
      } else {
        setReleaseResult({ success: true, count: result.releasedCount })
      }
    } catch (err) {
      console.error('release failed:', err)
    } finally {
      setReleasing(false)
    }
  }

  return (
    <>
      {stage === STAGE.UPLOAD && (
        <PdfUploadStage
          uploading={uploading} error={uploadError}
          dropRef={dropRef} fileInputRef={fileInputRef}
          onDrop={onDrop} onDragOver={onDragOver} onFile={handleFile}
        />
      )}
      {stage === STAGE.REVIEW && (
        <PdfReviewStage
          batch={batch} callIndex={callIndex} call={call} loading={loadingCall}
          fields={fields} onFieldChange={(k, v) => setFields(f => ({ ...f, [k]: v }))}
          onConfirm={handleConfirm} onSkip={handleSkip}
          confirming={confirming} skipping={skipping} pdfUrl={pdfUrl}
        />
      )}
      {stage === STAGE.DONE && (
        <PdfDoneStage batch={batch} onRelease={handleRelease} releasing={releasing} result={releaseResult} />
      )}
      {addressModal && (
        <AddressModal
          extracted={addressModal.extracted} existing={addressModal.existing}
          onResolve={addressModal.onResolve} onCancel={addressModal.onCancel}
        />
      )}
    </>
  )
}

function PdfUploadStage({ uploading, error, dropRef, fileInputRef, onDrop, onDragOver, onFile }) {
  return (
    <div style={s.center}>
      <div style={s.uploadCard}>
        <h1 style={s.uploadTitle}>PDF Intake</h1>
        <p style={s.uploadSub}>Upload today's route sheet to extract service calls.</p>
        <div ref={dropRef} style={s.dropZone} onDrop={onDrop} onDragOver={onDragOver} onClick={() => fileInputRef.current?.click()}>
          {uploading ? (
            <div style={s.uploadProgress}>
              <div style={s.spinner} />
              <p style={s.uploadProgressText}>Extracting calls…</p>
              <p style={s.uploadProgressSub}>This usually takes 3–8 seconds.</p>
            </div>
          ) : (
            <>
              <p style={s.dropIcon}>📄</p>
              <p style={s.dropText}>Drop PDF here or click to browse</p>
              <p style={s.dropSub}>PDF files only</p>
            </>
          )}
        </div>
        {error && <p style={s.errorText}>{error}</p>}
        <input ref={fileInputRef} type="file" accept="application/pdf" style={{ display: 'none' }} onChange={e => onFile(e.target.files[0])} />
      </div>
    </div>
  )
}

function PdfReviewStage({ batch, callIndex, call, loading, fields, onFieldChange, onConfirm, onSkip, confirming, skipping, pdfUrl }) {
  const pct = Math.round(((callIndex - 1) / batch.totalCalls) * 100)
  return (
    <div style={s.reviewLayout}>
      <div style={s.pdfPane}>
        <p style={s.pdfLabel}>Original PDF</p>
        {pdfUrl ? <iframe src={pdfUrl} style={s.pdfFrame} title="Route sheet PDF" /> : <div style={s.pdfPlaceholder}>PDF preview unavailable</div>}
      </div>
      <div style={s.formPane}>
        <div style={s.progressWrap}>
          <div style={s.progressBar}><div style={{ ...s.progressFill, width: `${pct}%` }} /></div>
          <p style={s.progressLabel}>Reviewing call {callIndex} of {batch.totalCalls}</p>
        </div>
        {loading ? (
          <div style={s.loadingCall}>Loading call…</div>
        ) : (
          <>
            {call?.systems?.length > 0 && (
              <div style={s.systemsBox}>
                {call.systems.map((sys, i) => (
                  <div key={i} style={s.sysRow}>
                    {call.systems.length > 1 && <p style={s.sysLabel}>System {i + 1}</p>}
                    <p style={s.sysLine}>Indoor: {sys.indoorModel ?? '—'}</p>
                    <p style={s.sysLine}>Outdoor: {sys.outdoorModel ?? '—'}</p>
                  </div>
                ))}
              </div>
            )}
            <div style={s.fieldsGrid}>
              {Object.entries(PDF_FIELD_LABELS).map(([key, label]) => (
                <div key={key} style={s.fieldRow}>
                  <label style={s.fieldLabel}>{label}</label>
                  {key === 'companyNotes' ? (
                    <textarea style={s.fieldTextarea} value={fields[key] ?? ''} onChange={e => onFieldChange(key, e.target.value)} rows={4} />
                  ) : (
                    <input style={s.fieldInput} value={fields[key] ?? ''} onChange={e => onFieldChange(key, e.target.value)} />
                  )}
                </div>
              ))}
              <div style={s.fieldRow}>
                <label style={s.fieldLabel}>Accessories</label>
                <input style={s.fieldInput} value={fields.preIdentifiedAccessories ?? ''} onChange={e => onFieldChange('preIdentifiedAccessories', e.target.value)} placeholder="Comma-separated" />
              </div>
            </div>
            <div style={s.reviewActions}>
              <button style={s.skipBtn} onClick={onSkip} disabled={skipping || confirming}>{skipping ? 'Skipping…' : 'Skip'}</button>
              <button style={s.confirmBtn} onClick={onConfirm} disabled={confirming || skipping}>{confirming ? 'Confirming…' : 'Confirm'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function PdfDoneStage({ batch, onRelease, releasing, result }) {
  if (result?.success) {
    return (
      <div style={s.center}>
        <div style={s.doneCard}>
          <p style={s.doneIcon}>✓</p>
          <h2 style={s.doneTitle}>{result.count} visit{result.count !== 1 ? 's' : ''} released to Lobby</h2>
          <p style={s.doneSub}>Technicians can now claim their calls.</p>
        </div>
      </div>
    )
  }
  if (result?.mismatch) {
    return (
      <div style={s.center}>
        <div style={s.doneCard}>
          <p style={s.doneIcon}>⚠</p>
          <h2 style={s.doneTitle}>Count mismatch — not released</h2>
          <p style={s.doneSub}>Expected {result.expected} visits, found {result.actual}. Contact support.</p>
        </div>
      </div>
    )
  }
  return (
    <div style={s.center}>
      <div style={s.doneCard}>
        <p style={s.doneIcon}>📋</p>
        <h2 style={s.doneTitle}>All calls reviewed</h2>
        <p style={s.doneSub}>Ready to release confirmed calls to the Lobby.</p>
        <button style={s.releaseBtn} onClick={onRelease} disabled={releasing}>
          {releasing ? 'Releasing…' : 'Release to Lobby'}
        </button>
      </div>
    </div>
  )
}

// ── Manual flow ────────────────────────────────────────────

function ManualFlow() {
  const { session: initSession, draft: initDraft } = loadStoredSession()
  const [session, setSession]           = useState(initSession)
  const [draft, setDraft]               = useState(initDraft)
  const [suggestions, setSuggestions]   = useState([])
  const [showSuggest, setShowSuggest]   = useState(false)
  const [detailsOpen, setDetailsOpen]   = useState(false)
  const [nearMatch, setNearMatch]       = useState(null)
  const [saving, setSaving]             = useState(false)
  const [releasing, setReleasing]       = useState(false)
  const [releaseResult, setReleaseResult] = useState(null)
  const searchTimer = useRef(null)
  const addressRef  = useRef(null)

  useEffect(() => {
    saveToStorage(session, draft)
  }, [session, draft])

  function setDraftField(key, val) {
    setDraft(d => ({ ...d, [key]: val }))
  }

  function updateSystem(i, key, val) {
    setDraft(d => {
      const systems = [...d.systems]
      systems[i] = { ...systems[i], [key]: val }
      return { ...d, systems }
    })
  }

  function addSystem() {
    setDraft(d => ({ ...d, systems: [...d.systems, { indoorModel: '', outdoorModel: '', coilModel: '' }] }))
  }

  function removeSystem(i) {
    setDraft(d => ({ ...d, systems: d.systems.filter((_, idx) => idx !== i) }))
  }

  function handleAddressInput(val) {
    setDraftField('address', val)
    clearTimeout(searchTimer.current)
    if (val.length < 3) { setSuggestions([]); setShowSuggest(false); return }
    searchTimer.current = setTimeout(async () => {
      try {
        const results = await api.get(`/addresses/search?q=${encodeURIComponent(val)}`)
        setSuggestions(results)
        setShowSuggest(results.length > 0)
      } catch { setSuggestions([]) }
    }, 300)
  }

  function selectSuggestion(sug) {
    setDraft(d => ({
      ...d,
      address:     sug.street,
      subdivision: sug.subdivision || d.subdivision,
      builder:     sug.builder     || d.builder,
    }))
    setSuggestions([])
    setShowSuggest(false)
  }

  async function handleConfirm() {
    if (!draft.address.trim()) { addressRef.current?.focus(); return }
    setSaving(true)
    try {
      const body = buildBody(draft, session.batchId)
      const result = await api.post('/dispatch/visits/create-manual', body)

      if (result.comparisonRequired) {
        if (!session.batchId) setSession(sess => ({ ...sess, batchId: result.batchId }))
        setNearMatch({ batchId: result.batchId, existingAddress: result.existingAddress, body })
        return
      }

      const call = { visitId: result.visitId, street: draft.address.trim(), subdivision: draft.subdivision.trim() }
      setSession(sess => ({ batchId: result.batchId, confirmedCalls: [...sess.confirmedCalls, call] }))
      setDraft(emptyDraft())
    } catch (err) {
      console.error('create-manual failed:', err)
    } finally {
      setSaving(false)
    }
  }

  async function handleResolve(action) {
    const { batchId, existingAddress, body } = nearMatch
    setNearMatch(null)
    try {
      const result = await api.post(`/addresses/${existingAddress.id}/resolve-comparison`, {
        action,
        incomingData: { address: body.address, city: body.city, state: body.state, zip: body.zip },
        pendingVisitData: body,
      })
      const call = { visitId: result.visitId, street: body.address, subdivision: body.subdivision || '' }
      setSession(sess => ({ batchId, confirmedCalls: [...sess.confirmedCalls, call] }))
      setDraft(emptyDraft())
    } catch (err) {
      console.error('resolve-comparison failed:', err)
    }
  }

  async function handleDeleteCall(visitId) {
    if (!session.batchId) return
    try {
      await api.delete(`/dispatch/batch/${session.batchId}/visits/${visitId}`)
    } catch (err) {
      console.error('delete call failed:', err)
    }
    setSession(sess => ({ ...sess, confirmedCalls: sess.confirmedCalls.filter(c => c.visitId !== visitId) }))
  }

  async function handleDeleteBatch() {
    if (!window.confirm('Delete the entire batch? All confirmed calls will be cancelled.')) return
    if (session.batchId) {
      try { await api.delete(`/dispatch/batch/${session.batchId}`) } catch {}
    }
    setSession(emptySession())
    setDraft(emptyDraft())
    localStorage.removeItem(STORAGE_KEY)
  }

  function handleDiscard() {
    setDraft(emptyDraft())
  }

  async function handleRelease() {
    if (!session.batchId || session.confirmedCalls.length === 0) return
    setReleasing(true)
    try {
      const result = await api.post(`/dispatch/batch/${session.batchId}/release-to-lobby`)
      if (result.mismatch) {
        setReleaseResult({ mismatch: true, expected: result.expected, actual: result.actual })
      } else {
        setReleaseResult({ success: true, count: result.releasedCount })
        setSession(emptySession())
        setDraft(emptyDraft())
        localStorage.removeItem(STORAGE_KEY)
      }
    } catch (err) {
      console.error('release failed:', err)
    } finally {
      setReleasing(false)
    }
  }

  if (releaseResult?.success) {
    return (
      <div style={m.successMsg}>
        <p>✓ {releaseResult.count} visit{releaseResult.count !== 1 ? 's' : ''} released to Lobby.</p>
        <button style={m.btnSolid} onClick={() => setReleaseResult(null)}>Start new session</button>
      </div>
    )
  }
  if (releaseResult?.mismatch) {
    return (
      <div style={m.successMsg}>
        <p>⚠ Count mismatch — not released. Expected {releaseResult.expected}, found {releaseResult.actual}.</p>
        <button style={m.btnSolid} onClick={() => setReleaseResult(null)}>Back</button>
      </div>
    )
  }

  return (
    <div style={m.layout}>
      {/* Left: batch list */}
      <div style={m.box}>
        <div style={m.boxTitle}>
          Batch <span style={m.mono}>· {session.confirmedCalls.length}</span>
        </div>

        {session.confirmedCalls.length === 0 && (
          <p style={m.emptyBatch}>No calls confirmed yet.</p>
        )}

        {session.confirmedCalls.map(c => (
          <div key={c.visitId} style={m.batchItem}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <span>{c.street}</span>
              <button style={m.deleteCallBtn} onClick={() => handleDeleteCall(c.visitId)} title="Remove call">×</button>
            </div>
            {c.subdivision && <div style={m.batchSub}>{c.subdivision}</div>}
          </div>
        ))}

        <div style={m.addCallDashed} onClick={() => addressRef.current?.focus()}>
          + Add another call
        </div>

        {session.confirmedCalls.length > 0 && (
          <div style={{ ...m.releaseBtn, opacity: releasing ? 0.6 : 1 }} onClick={releasing ? undefined : handleRelease}>
            {releasing ? 'Releasing…' : 'Release to lobby'}
          </div>
        )}

        {session.batchId && (
          <button style={m.deleteBatchBtn} onClick={handleDeleteBatch}>Delete entire batch</button>
        )}
      </div>

      {/* Right: entry form */}
      <div style={m.box}>
        <div style={m.boxTitle}>New call</div>

        {/* Address */}
        <div style={{ marginBottom: 14, position: 'relative' }}>
          <label style={m.label}>Address *</label>
          <input
            ref={addressRef}
            style={m.input}
            value={draft.address}
            onChange={e => handleAddressInput(e.target.value)}
            onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
            onFocus={() => suggestions.length > 0 && setShowSuggest(true)}
            placeholder="Street address"
          />
          {showSuggest && suggestions.length > 0 && (
            <div style={m.typeahead}>
              {suggestions.map(sug => (
                <div key={sug.id} style={m.typeaheadItem} onMouseDown={() => selectSuggestion(sug)}>
                  {sug.street}
                  {sug.city && ` — ${sug.city}`}
                  {sug.subdivision && <span style={{ color: '#5A5A5A' }}> ({sug.subdivision})</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Subdivision + Builder (recommended) */}
        <div style={m.row2}>
          <div>
            <label style={m.labelRec}>Subdivision (recommended)</label>
            <input style={m.inputRec} value={draft.subdivision} onChange={e => setDraftField('subdivision', e.target.value)} />
          </div>
          <div>
            <label style={m.labelRec}>Builder (recommended)</label>
            <input style={m.inputRec} value={draft.builder} onChange={e => setDraftField('builder', e.target.value)} />
          </div>
        </div>

        {/* Systems */}
        {draft.systems.map((sys, i) => (
          <div key={i}>
            <div style={m.sysLabel}>
              {draft.systems.length > 1 ? `System ${i + 1}` : 'System'}
              {draft.systems.length > 1 && i > 0 && (
                <button style={m.removeSysBtn} onClick={() => removeSystem(i)}>Remove</button>
              )}
            </div>
            <div style={m.sysRow}>
              <input style={m.inputSm} placeholder="Indoor model" value={sys.indoorModel} onChange={e => updateSystem(i, 'indoorModel', e.target.value)} />
              <input style={m.inputSm} placeholder="Outdoor model" value={sys.outdoorModel} onChange={e => updateSystem(i, 'outdoorModel', e.target.value)} />
              <input style={m.inputSm} placeholder="Coil model" value={sys.coilModel} onChange={e => updateSystem(i, 'coilModel', e.target.value)} />
            </div>
          </div>
        ))}
        <div style={m.addSystem} onClick={addSystem}>+ Add system</div>

        {/* Thermostat + Accessories */}
        <div style={m.row2}>
          <div>
            <label style={m.label}>Thermostat</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input style={{ ...m.input, flex: 1 }} value={draft.thermostat} onChange={e => setDraftField('thermostat', e.target.value)} placeholder="Model or N/A" />
              <input style={{ ...m.input, width: 52 }} type="number" min="1" value={draft.thermostatQty} onChange={e => setDraftField('thermostatQty', parseInt(e.target.value, 10) || 1)} />
            </div>
          </div>
          <div>
            <label style={m.label}>Accessories</label>
            <input style={m.input} value={draft.accessories} onChange={e => setDraftField('accessories', e.target.value)} placeholder="Comma-separated" />
          </div>
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 10 }}>
          <label style={m.label}>Notes</label>
          <textarea style={{ ...m.input, resize: 'none' }} rows={2} value={draft.notes} onChange={e => setDraftField('notes', e.target.value)} />
        </div>

        {/* Collapsible details */}
        <div style={m.expandLink} onClick={() => setDetailsOpen(v => !v)}>
          {detailsOpen ? '− Hide call details' : '+ Add call details (time, order #, contact, work type)'}
        </div>

        {detailsOpen && (
          <div style={{ marginBottom: 4 }}>
            <div style={m.row2}>
              <div>
                <label style={m.label}>Scheduled time</label>
                <input style={m.input} type="time" value={draft.scheduledTime} onChange={e => setDraftField('scheduledTime', e.target.value)} />
              </div>
              <div>
                <label style={m.label}>Order #</label>
                <input style={m.input} value={draft.orderNumber} onChange={e => setDraftField('orderNumber', e.target.value)} />
              </div>
            </div>
            <div style={m.row2}>
              <div>
                <label style={m.label}>Contact name</label>
                <input style={m.input} value={draft.contactName} onChange={e => setDraftField('contactName', e.target.value)} />
              </div>
              <div>
                <label style={m.label}>Contact phone</label>
                <input style={m.input} value={draft.contactPhone} onChange={e => setDraftField('contactPhone', e.target.value)} />
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={m.label}>Work type</label>
              <input style={m.input} value={draft.workType} onChange={e => setDraftField('workType', e.target.value)} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <input
                type="checkbox"
                id="isPriority"
                checked={draft.isPriority}
                onChange={e => setDraftField('isPriority', e.target.checked)}
                style={{ width: 'auto', margin: 0 }}
              />
              <label htmlFor="isPriority" style={{ ...m.label, marginBottom: 0 }}>Prioritario</label>
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={m.actions}>
          <button style={m.btnGhost} onClick={handleDiscard}>Discard</button>
          <button
            style={{ ...m.btnSolid, opacity: saving || !draft.address.trim() ? 0.5 : 1 }}
            onClick={handleConfirm}
            disabled={saving || !draft.address.trim()}
          >
            {saving ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      </div>

      {nearMatch && (
        <AddressModal
          extracted={nearMatch.body.address}
          existing={nearMatch.existingAddress}
          onResolve={handleResolve}
          onCancel={() => setNearMatch(null)}
        />
      )}
    </div>
  )
}

function buildBody(draft, batchId) {
  return {
    batchId: batchId || undefined,
    address:      draft.address.trim(),
    subdivision:  draft.subdivision.trim() || undefined,
    builder:      draft.builder.trim()     || undefined,
    systems:      draft.systems.map(sys => ({
      indoorModel:  sys.indoorModel.trim()  || undefined,
      outdoorModel: sys.outdoorModel.trim() || undefined,
      coilModel:    sys.coilModel.trim()    || undefined,
    })),
    thermostat:    draft.thermostat.trim()                   || undefined,
    thermostatQty: parseInt(draft.thermostatQty, 10)         || 1,
    accessories:   draft.accessories.trim()                  || undefined,
    notes:        draft.notes.trim()        || undefined,
    scheduledTime: draft.scheduledTime      || undefined,
    orderNumber:  draft.orderNumber.trim()  || undefined,
    contactName:  draft.contactName.trim()  || undefined,
    contactPhone: draft.contactPhone.trim() || undefined,
    workType:     draft.workType.trim()     || undefined,
    isPriority:   draft.isPriority,
  }
}

// ── PDF styles (dark theme — existing tokens) ──────────────

const s = {
  page: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--surface-base)', color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' },
  modeBar: { display: 'flex', gap: 0, borderBottom: '0.5px solid var(--border-subtle)', flexShrink: 0, background: 'var(--surface-1)' },
  modeBtn: { padding: '8px 20px', fontSize: '12px', background: 'none', border: 'none', borderBottom: '2px solid transparent', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font-sans)' },
  modeBtnActive: { color: 'var(--color-signal)', borderBottomColor: 'var(--color-signal)' },
  center: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' },
  uploadCard: { width: '100%', maxWidth: '480px', display: 'flex', flexDirection: 'column', gap: '16px' },
  uploadTitle: { fontSize: '22px', fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '-0.02em' },
  uploadSub: { fontSize: '14px', color: 'var(--text-muted)' },
  dropZone: { border: '1.5px dashed var(--border-default)', borderRadius: '12px', padding: '48px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer', background: 'var(--surface-1)' },
  dropIcon: { fontSize: '40px', lineHeight: 1 },
  dropText: { fontSize: '14px', fontWeight: 500, color: 'var(--text-secondary)' },
  dropSub:  { fontSize: '12px', color: 'var(--text-disabled)' },
  uploadProgress: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' },
  uploadProgressText: { fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' },
  uploadProgressSub:  { fontSize: '12px', color: 'var(--text-muted)' },
  errorText: { fontSize: '13px', color: 'var(--color-heat)' },
  spinner: { width: '28px', height: '28px', border: '2.5px solid var(--surface-3)', borderTopColor: 'var(--color-signal)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' },
  reviewLayout: { flex: 1, display: 'flex', overflow: 'hidden' },
  pdfPane: { flex: '0 0 50%', display: 'flex', flexDirection: 'column', borderRight: '0.5px solid var(--border-subtle)', padding: '16px', gap: '8px', background: 'var(--surface-1)' },
  pdfLabel: { fontSize: '11px', color: 'var(--text-disabled)', textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0 },
  pdfFrame: { flex: 1, border: 'none', borderRadius: '8px', background: '#fff' },
  pdfPlaceholder: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', color: 'var(--text-disabled)' },
  formPane: { flex: '0 0 50%', display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '16px', gap: '12px' },
  progressWrap: { display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0 },
  progressBar: { height: '3px', borderRadius: '2px', background: 'var(--surface-3)', overflow: 'hidden' },
  progressFill: { height: '100%', background: 'var(--color-signal)', transition: 'width 200ms ease' },
  progressLabel: { fontSize: '12px', color: 'var(--text-muted)' },
  loadingCall: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', color: 'var(--text-muted)' },
  systemsBox: { background: 'var(--surface-2)', borderRadius: '8px', padding: '10px 12px', border: '0.5px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 },
  sysRow:  { display: 'flex', flexDirection: 'column', gap: '2px' },
  sysLabel:{ fontSize: '10px', color: 'var(--text-disabled)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' },
  sysLine: { fontSize: '12px', color: 'var(--text-secondary)' },
  fieldsGrid: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' },
  fieldRow: { display: 'flex', flexDirection: 'column', gap: '3px' },
  fieldLabel: { fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 },
  fieldInput: { background: 'var(--surface-2)', border: '0.5px solid var(--border-default)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', padding: '6px 10px', outline: 'none', fontFamily: 'var(--font-sans)' },
  fieldTextarea: { background: 'var(--surface-2)', border: '0.5px solid var(--border-default)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', padding: '6px 10px', outline: 'none', resize: 'vertical', fontFamily: 'var(--font-sans)', lineHeight: 1.5 },
  reviewActions: { display: 'flex', gap: '8px', flexShrink: 0, paddingTop: '4px' },
  skipBtn: { flex: '0 0 auto', background: 'var(--surface-3)', color: 'var(--text-secondary)', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 500, padding: '10px 20px', cursor: 'pointer' },
  confirmBtn: { flex: 1, background: 'var(--color-signal)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 500, padding: '10px', cursor: 'pointer' },
  doneCard: { width: '100%', maxWidth: '400px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', textAlign: 'center' },
  doneIcon:  { fontSize: '48px', lineHeight: 1 },
  doneTitle: { fontSize: '18px', fontWeight: 500, color: 'var(--text-primary)' },
  doneSub:   { fontSize: '14px', color: 'var(--text-muted)' },
  releaseBtn: { marginTop: '8px', background: 'var(--color-signal)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 500, padding: '12px 32px', cursor: 'pointer' },
}

// ── Manual styles (monochrome light — per mockup) ──────────

const m = {
  layout:     { flex: 1, display: 'grid', gridTemplateColumns: '240px 1fr', gap: 20, padding: '20px 24px', overflowY: 'auto', background: '#EAEAE6', color: '#141414', fontFamily: '-apple-system, Helvetica, Arial, sans-serif', alignContent: 'start' },
  successMsg: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: '#EAEAE6', color: '#141414', fontFamily: '-apple-system, Helvetica, Arial, sans-serif', fontSize: '13px' },
  box:        { border: '2px solid #141414', padding: 16, background: '#F4F4F1', alignSelf: 'start' },
  boxTitle:   { fontSize: '12px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', borderBottom: '2px solid #141414', paddingBottom: 10, marginBottom: 14 },
  mono:       { fontFamily: "'Courier New', monospace", fontWeight: 400 },
  emptyBatch: { fontSize: '12px', color: '#5A5A5A', marginBottom: 12 },
  batchItem:  { fontSize: '12px', padding: '8px 0', borderBottom: '1px solid #DDD' },
  batchSub:   { color: '#5A5A5A', fontSize: '11px', marginTop: 2 },
  deleteCallBtn: { background: 'none', border: 'none', color: '#999', fontSize: '14px', cursor: 'pointer', padding: '0 2px', lineHeight: 1, flexShrink: 0 },
  addCallDashed: { marginTop: 16, border: '1px dashed #999', padding: 10, textAlign: 'center', fontSize: '11px', color: '#5A5A5A', cursor: 'pointer' },
  releaseBtn:    { marginTop: 10, border: '2px solid #141414', padding: 10, textAlign: 'center', fontSize: '12px', letterSpacing: '0.3px', cursor: 'pointer', userSelect: 'none' },
  deleteBatchBtn:{ marginTop: 10, border: 'none', background: 'none', fontSize: '11px', color: '#999', cursor: 'pointer', textDecoration: 'underline', display: 'block', textAlign: 'center', width: '100%', padding: '4px 0' },
  label:     { fontSize: '11px', color: '#141414', display: 'block', marginBottom: 4 },
  labelRec:  { fontSize: '11px', color: '#854F0B', display: 'block', marginBottom: 4 },
  input:     { width: '100%', boxSizing: 'border-box', fontSize: '13px', border: '1px solid #141414', padding: '8px 10px', background: '#EAEAE6', color: '#141414', fontFamily: 'inherit', outline: 'none', marginBottom: 0 },
  inputRec:  { width: '100%', boxSizing: 'border-box', fontSize: '13px', border: '1px solid #BA7517', padding: '8px 10px', background: '#FAEEDA', color: '#141414', fontFamily: 'inherit', outline: 'none' },
  inputSm:   { width: '100%', boxSizing: 'border-box', fontSize: '12px', border: '1px solid #141414', padding: '7px 8px', background: '#EAEAE6', color: '#141414', fontFamily: 'inherit', outline: 'none' },
  typeahead:     { position: 'absolute', left: 0, right: 0, border: '1px solid #141414', borderTop: 'none', background: '#EAEAE6', zIndex: 10 },
  typeaheadItem: { padding: '7px 10px', fontSize: '12px', borderBottom: '1px solid #DDD', cursor: 'pointer' },
  sysLabel:  { fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: '#5A5A5A', borderTop: '1px solid #999', paddingTop: 12, marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  sysRow:    { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 8 },
  removeSysBtn:{ background: 'none', border: 'none', fontSize: '11px', color: '#999', cursor: 'pointer', textDecoration: 'underline', padding: 0 },
  addSystem: { fontSize: '11px', color: '#5A5A5A', marginBottom: 18, cursor: 'pointer' },
  row2:      { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 },
  expandLink:{ fontSize: '11px', color: '#5A5A5A', textDecoration: 'underline', marginBottom: 18, cursor: 'pointer' },
  actions:   { display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 4 },
  btnGhost:  { border: '1px solid #999', color: '#5A5A5A', padding: '9px 18px', fontSize: '12px', letterSpacing: '0.3px', background: 'none', cursor: 'pointer', fontFamily: 'inherit' },
  btnSolid:  { border: '2px solid #141414', padding: '9px 18px', fontSize: '12px', letterSpacing: '0.3px', background: 'none', color: '#141414', cursor: 'pointer', fontFamily: 'inherit' },
}
