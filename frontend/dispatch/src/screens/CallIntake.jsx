import { useState, useRef, useCallback, useEffect } from 'react'
import { api } from '@shared/api.js'
import AddressModal from '../components/AddressModal.jsx'

// ── Stage constants (PDF flow) ─────────────────────────────
const STAGE = { UPLOAD: 'upload', REVIEW: 'review', DONE: 'done' }

const PDF_FIELD_LABELS = {
  scheduledTime:           'Scheduled time',
  address:                 'Address',
  city:                    'City',
  state:                   'State',
  zip:                     'ZIP',
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

// ── Catalog-driven pickers ──────────────────────────────────
// GET /catalog/items and /catalog/equipment return the full table with no
// filtering support — fetched once per flow mount and filtered client-side.

function useCatalogLists() {
  const [items, setItems]         = useState([])
  const [equipment, setEquipment] = useState([])

  useEffect(() => {
    api.get('/catalog/items').then(setItems).catch(() => setItems([]))
    api.get('/catalog/equipment').then(setEquipment).catch(() => setEquipment([]))
  }, [])

  return {
    thermostats:     items.filter(i => i.category === 'thermostat'),
    accessories:     items.filter(i => i.category === 'accessory'),
    // catalog_equipment has no indoor/outdoor field — derived from unit_type
    indoorEquipment:  equipment.filter(e => e.unit_type === 'furnace' || e.unit_type === 'air_handler'),
    outdoorEquipment: equipment.filter(e => e.unit_type === 'condenser' || e.unit_type === 'heat_pump'),
  }
}

function itemOptions(list) {
  return list.map(i => ({ value: i.item_name, label: i.item_name }))
}

function equipmentOptions(list) {
  return list.map(e => ({ value: e.model, label: `${e.brand} ${e.model}` }))
}

// Single-value typeahead. Free-text entry is optional for fields that are not
// catalog-backed. `options`: [{ value, label }]. `classes`: CSS class names
// from dispatch.css (.vd-select-*).
function SearchableSelect({ value, onChange, options, placeholder, classes, allowFreeText = true }) {
  const [query, setQuery] = useState(value || '')
  const [open, setOpen]   = useState(false)

  useEffect(() => { if (!open) setQuery(value || '') }, [value, open])

  const filtered    = query ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase())) : options
  const exactMatch   = options.some(o => o.value.toLowerCase() === query.trim().toLowerCase())
  const showAddNew   = allowFreeText && query.trim() && !exactMatch

  function commit(val) {
    onChange(val)
    setQuery(val)
    setOpen(false)
  }

  return (
    <div className="vd-select">
      <input
        className={classes.input}
        value={query}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onBlur={() => setTimeout(() => { setOpen(false); setQuery(value || '') }, 150)}
      />
      {open && (
        <div className={classes.dropdown}>
          {filtered.map(o => (
            <div key={o.value} className={classes.dropdownItem} onMouseDown={() => commit(o.value)}>{o.label}</div>
          ))}
          {filtered.length === 0 && !showAddNew && <div className={classes.empty}>No matches</div>}
          {showAddNew && (
            <div className={classes.addNewItem} onMouseDown={() => commit(query.trim())}>
              + Add new: "{query.trim()}"
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Multi-select chip picker over a comma-separated string value. Free-text
// entry is optional, as with SearchableSelect. `options`: [{ value, label }].
function MultiSelectChips({ value, onChange, options, placeholder, classes, allowFreeText = true }) {
  const selected = value ? value.split(',').map(s => s.trim()).filter(Boolean) : []
  const [query, setQuery] = useState('')
  const [open, setOpen]   = useState(false)

  const filtered  = options.filter(o => !selected.includes(o.value) && o.label.toLowerCase().includes(query.toLowerCase()))
  const exactMatch = options.some(o => o.value.toLowerCase() === query.trim().toLowerCase())
  const showAddNew = allowFreeText && query.trim() && !exactMatch && !selected.includes(query.trim())

  function addChip(name) {
    if (selected.includes(name)) return
    onChange([...selected, name].join(', '))
    setQuery('')
  }

  function removeChip(name) {
    onChange(selected.filter(s => s !== name).join(', '))
  }

  return (
    <div>
      {selected.length > 0 && (
        <div className={classes.chipsWrap}>
          {selected.map(name => (
            <span key={name} className={classes.chip}>
              {name}
              <span className={classes.chipRemove} onMouseDown={() => removeChip(name)}>×</span>
            </span>
          ))}
        </div>
      )}
      <div className="vd-select">
        <input
          className={classes.input}
          value={query}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onBlur={() => setTimeout(() => { setOpen(false); setQuery('') }, 150)}
        />
        {open && (
          <div className={classes.dropdown}>
            {filtered.map(o => (
              <div key={o.value} className={classes.dropdownItem} onMouseDown={() => addChip(o.value)}>{o.label}</div>
            ))}
            {filtered.length === 0 && !showAddNew && <div className={classes.empty}>No matches</div>}
            {showAddNew && (
              <div className={classes.addNewItem} onMouseDown={() => addChip(query.trim())}>
                + Add new: "{query.trim()}"
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Root ───────────────────────────────────────────────────

export default function CallIntake() {
  const stored = loadStoredSession()
  const [mode, setMode] = useState(stored.session.batchId ? 'manual' : 'pdf')

  return (
    <div style={s.page}>
      <div style={s.modeBar}>
        <div className="vd-rocker" role="group" aria-label="Intake mode">
          <button type="button" className={mode === 'pdf' ? 'on' : ''} aria-pressed={mode === 'pdf'} onClick={() => setMode('pdf')}>
            PDF Upload
          </button>
          <button type="button" className={mode === 'manual' ? 'on' : ''} aria-pressed={mode === 'manual'} onClick={() => setMode('manual')}>
            Manual Entry
          </button>
        </div>
      </div>
      {mode === 'pdf' ? <PdfFlow onManualEntry={() => setMode('manual')} /> : <ManualFlow />}
    </div>
  )
}

// ── PDF flow (existing logic, unchanged) ───────────────────

function PdfFlow({ onManualEntry }) {
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
  const [editedSystems, setEditedSystems] = useState([])
  const [pdfUrl, setPdfUrl]           = useState(null)
  const [unreadable, setUnreadable]   = useState(false)
  const fileInputRef = useRef(null)
  const dropRef      = useRef(null)
  const catalog = useCatalogLists()
  const thermostatOptions = itemOptions(catalog.thermostats)
  const accessoryOptions  = itemOptions(catalog.accessories)
  const indoorOptions     = equipmentOptions(catalog.indoorEquipment)
  const outdoorOptions    = equipmentOptions(catalog.outdoorEquipment)

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
    setUnreadable(false)
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
      setUploadError(err.status === 422
        ? "Couldn't read this PDF. Enter the calls by hand instead."
        : 'Extraction failed. Check your connection and try again.')
      setUnreadable(err.status === 422)
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
      setEditedSystems((data.call?.systems ?? []).map(sys => ({ ...sys })))
    } catch (err) {
      console.error('load call failed:', err)
    } finally {
      setLoadingCall(false)
    }
  }

  function updateEditedSystem(i, key, val) {
    setEditedSystems(systems => {
      const next = [...systems]
      next[i] = { ...next[i], [key]: val }
      return next
    })
  }

  function flattenCall(extracted) {
    if (!extracted) return {}
    return {
      scheduledTime:            extracted.scheduledTime            ?? '',
      address:                  extracted.address                  ?? '',
      city:                     extracted.city                     ?? '',
      state:                    extracted.state                    ?? '',
      zip:                      extracted.zip                      ?? '',
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
        systems: editedSystems,
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
          uploading={uploading} error={uploadError} unreadable={unreadable} onManualEntry={onManualEntry}
          dropRef={dropRef} fileInputRef={fileInputRef}
          onDrop={onDrop} onDragOver={onDragOver} onFile={handleFile}
        />
      )}
      {stage === STAGE.REVIEW && (
        <PdfReviewStage
          batch={batch} callIndex={callIndex} call={call} loading={loadingCall}
          fields={fields} onFieldChange={(k, v) => setFields(f => ({ ...f, [k]: v }))}
          editedSystems={editedSystems} onSystemChange={updateEditedSystem} flags={call?.flags ?? {}} ocr={call?.ocr ?? {}}
          thermostatOptions={thermostatOptions} accessoryOptions={accessoryOptions}
          indoorOptions={indoorOptions} outdoorOptions={outdoorOptions}
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

function PdfUploadStage({ uploading, error, unreadable, onManualEntry, dropRef, fileInputRef, onDrop, onDragOver, onFile }) {
  return (
    <div style={s.center}>
      <div className="vd-unit" style={s.uploadCard}>
        <div className="vd-unit-head"><span className="vd-unit-id">PDF</span><span className="vd-unit-name">PDF Intake</span></div>
        <div className="vd-knurl" />
        <div className="vd-unit-body" style={s.stack}>
          <p className="vd-hint" style={s.flush}>Upload today's route sheet to extract service calls.</p>
          <div
            ref={dropRef} className="vd-placeholder" role="button" tabIndex={0}
            onDrop={onDrop} onDragOver={onDragOver}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click() } }}
          >
            {uploading ? (
              <div style={s.uploadProgress}>
                <div style={s.spinner} />
                <p className="vd-stencil" style={s.flush}>Reading the route sheet…</p>
                <p className="vd-hint" style={s.flush}>About 5–10 seconds per page.</p>
              </div>
            ) : (
              <>
                <p className="vd-stencil" style={{ ...s.flush, color: 'var(--vd-ink)' }}>Drop PDF here or click to browse</p>
                <p className="vd-hint" style={s.flush}>PDF files only</p>
              </>
            )}
          </div>
          {error && <p className="vd-error">{error}</p>}
          {unreadable && <button type="button" className="vd-key" style={{ alignSelf: 'flex-start' }} onClick={onManualEntry}>Manual Entry</button>}
          <input ref={fileInputRef} type="file" accept="application/pdf" style={{ display: 'none' }} onChange={e => onFile(e.target.files[0])} />
        </div>
      </div>
    </div>
  )
}

function PdfReviewStage({ batch, callIndex, call, loading, fields, flags, ocr, onFieldChange, editedSystems, onSystemChange, thermostatOptions, accessoryOptions, indoorOptions, outdoorOptions, onConfirm, onSkip, confirming, skipping, pdfUrl }) {
  const pct = Math.round(((callIndex - 1) / batch.totalCalls) * 100)
  return (
    <div style={s.reviewLayout}>
      <div className="vd-unit" style={s.pdfPane}>
        <div className="vd-unit-head"><span className="vd-unit-id">PDF</span><span className="vd-unit-name">Original PDF</span></div>
        {pdfUrl ? <iframe src={pdfUrl} style={s.pdfFrame} title="Route sheet PDF" /> : <div className="vd-hint" style={s.pdfPlaceholder}>PDF preview unavailable</div>}
      </div>
      <div className="vd-unit" style={s.formPane}>
        <div className="vd-unit-head">
          <span className="vd-unit-id">REV</span><span className="vd-unit-name">Review extraction</span>
          <span className="vd-unit-note vd-data">Call {callIndex} / {batch.totalCalls}</span>
        </div>
        <div className="vd-knurl" />
        <div style={s.formBody}>
        <div style={s.progressWrap}>
          <div className="vd-progress"><i style={{ width: `${pct}%` }} /></div>
          <p className="vd-hint" style={s.flush}>Reviewing call {callIndex} of {batch.totalCalls}</p>
        </div>
        {loading ? (
          <div className="vd-hint" style={s.loadingCall}>Loading call…</div>
        ) : (
          <>
            {editedSystems.length > 0 && (
              <div style={s.systemsBox}>
                {editedSystems.map((sys, i) => (
                  <div key={i} style={s.sysRow}>
                    {editedSystems.length > 1 && <h4 className="vd-sub">System {i + 1}</h4>}
                    <FlagNote flag={flags[`systems.${i}`]} />
                    <SearchableSelect
                      value={sys.indoorModel ?? ''} onChange={v => onSystemChange(i, 'indoorModel', v)}
                      options={indoorOptions} placeholder="Indoor model" classes={flagged(s.selectClasses, flags[`systems.${i}.indoorModel`])}
                    />
                    <FlagNote flag={flags[`systems.${i}.indoorModel`]} raw={ocr[`systems.${i}.indoorModel`]} />
                    <SearchableSelect
                      value={sys.outdoorModel ?? ''} onChange={v => onSystemChange(i, 'outdoorModel', v)}
                      options={outdoorOptions} placeholder="Outdoor model" classes={flagged(s.selectClasses, flags[`systems.${i}.outdoorModel`])}
                    />
                    <FlagNote flag={flags[`systems.${i}.outdoorModel`]} raw={ocr[`systems.${i}.outdoorModel`]} />
                    <input className={`vd-input${flags[`systems.${i}.coilModel`] ? ' flag' : ''}`} value={sys.coilModel ?? ''} onChange={e => onSystemChange(i, 'coilModel', e.target.value)} placeholder="Coil model" />
                    <FlagNote flag={flags[`systems.${i}.coilModel`]} />
                  </div>
                ))}
              </div>
            )}
            <FlagNote flag={flags.systems} />
            <div style={s.fieldsGrid}>
              {Object.entries(PDF_FIELD_LABELS).filter(([key]) => key !== 'preSpecifiedThermostat').map(([key, label]) => (
                <div key={key} style={s.fieldRow}>
                  <label className="vd-label">{label}</label>
                  {key === 'companyNotes' ? (
                    <textarea className={`vd-input${flags[key] ? ' flag' : ''}`} value={fields[key] ?? ''} onChange={e => onFieldChange(key, e.target.value)} rows={6} />
                  ) : (
                    <input className={`vd-input${flags[key] ? ' flag' : ''}`} value={fields[key] ?? ''} onChange={e => onFieldChange(key, e.target.value)} />
                  )}
                  <FlagNote flag={flags[key]} />
                </div>
              ))}
              <div style={s.fieldRow}>
                <label className="vd-label">{PDF_FIELD_LABELS.preSpecifiedThermostat}</label>
                <SearchableSelect
                  value={fields.preSpecifiedThermostat ?? ''} onChange={v => onFieldChange('preSpecifiedThermostat', v)}
                  options={thermostatOptions} placeholder="Model or N/A" classes={s.selectClasses} allowFreeText={false}
                />
              </div>
              <div style={s.fieldRow}>
                <label className="vd-label">Accessories</label>
                <MultiSelectChips
                  value={fields.preIdentifiedAccessories ?? ''} onChange={v => onFieldChange('preIdentifiedAccessories', v)}
                  options={accessoryOptions} placeholder="Search accessories…" classes={s.selectClasses} allowFreeText={false}
                />
                <FlagNote flag={flags.preIdentifiedAccessories} />
              </div>
            </div>
            <div style={s.reviewActions}>
              <button type="button" className="vd-key off" onClick={onSkip} disabled={skipping || confirming}>{skipping ? 'Skipping…' : 'Skip'}</button>
              <button type="button" className="vd-key dark" onClick={onConfirm} disabled={confirming || skipping}>{confirming ? 'Confirming…' : 'Confirm'}</button>
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  )
}

// Route sheet OCR: fields Dispatch must check before Confirm.
function FlagNote({ flag, raw }) {
  if (flag) return <p className="vd-flag-note">Check: {flag}</p>
  return raw ? <p className="vd-hint" style={{ margin: '4px 0 0' }}>Catalog match · OCR read "{raw}"</p> : null
}

function flagged(classes, flag) {
  return flag ? { ...classes, input: `${classes.input} flag` } : classes
}

function PdfDoneStage({ batch, onRelease, releasing, result }) {
  const card = (mark, title, sub, action) => (
    <div style={s.center}>
      <div className="vd-unit" style={s.doneCard}>
        <div className="vd-unit-head"><span className="vd-unit-id">PDF</span><span className="vd-unit-name">{title}</span></div>
        <div className="vd-unit-body" style={s.doneBody}>
          {mark && <div className="vd-readout inline"><span className="num">{mark}</span></div>}
          <p className="vd-hint" style={s.flush}>{sub}</p>
          {action}
        </div>
      </div>
    </div>
  )
  if (result?.success) {
    return card('✓', `${result.count} visit${result.count !== 1 ? 's' : ''} released to Lobby`, 'Technicians can now claim their calls.')
  }
  if (result?.mismatch) {
    return card('⚠', 'Count mismatch — not released', `Expected ${result.expected} visits, found ${result.actual}. Contact support.`)
  }
  return card(null, 'All calls reviewed', 'Ready to release confirmed calls to the Lobby.',
    <button type="button" className="vd-key dark" onClick={onRelease} disabled={releasing}>
      {releasing ? 'Releasing…' : 'Release to Lobby'}
    </button>)
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
  const catalog = useCatalogLists()
  const thermostatOptions = itemOptions(catalog.thermostats)
  const accessoryOptions  = itemOptions(catalog.accessories)
  const indoorOptions     = equipmentOptions(catalog.indoorEquipment)
  const outdoorOptions    = equipmentOptions(catalog.outdoorEquipment)

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

  // A pending address search must not reopen the list after the draft moves on.
  function closeSuggestions() {
    clearTimeout(searchTimer.current)
    setSuggestions([])
    setShowSuggest(false)
  }

  function resetDraft() {
    closeSuggestions()
    setDraft(emptyDraft())
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
    closeSuggestions()
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
      resetDraft()
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
      resetDraft()
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
    resetDraft()
    localStorage.removeItem(STORAGE_KEY)
  }

  function handleDiscard() {
    resetDraft()
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
        resetDraft()
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
        <p className="vd-stencil" style={{ color: 'var(--vd-ink)' }}>✓ {releaseResult.count} visit{releaseResult.count !== 1 ? 's' : ''} released to Lobby.</p>
        <button type="button" className="vd-key dark" onClick={() => setReleaseResult(null)}>Start new session</button>
      </div>
    )
  }
  if (releaseResult?.mismatch) {
    return (
      <div style={m.successMsg}>
        <p className="vd-stencil" style={{ color: 'var(--vd-ink)' }}>⚠ Count mismatch — not released. Expected {releaseResult.expected}, found {releaseResult.actual}.</p>
        <button type="button" className="vd-key" onClick={() => setReleaseResult(null)}>Back</button>
      </div>
    )
  }

  return (
    <div className="vd-cols" style={m.layout}>
      {/* Left: batch list */}
      <div className="vd-unit">
        <div className="vd-unit-head"><span className="vd-unit-id">BATCH</span><span className="vd-unit-name">Batch</span></div>
        <div className="vd-unit-body">
        <div className="vd-readout" style={{ marginBottom: 14 }}>
          <div className="num">{String(session.confirmedCalls.length).padStart(2, '0')}</div>
          <div className="cap">calls held</div>
        </div>

        {session.confirmedCalls.length === 0 && (
          <p className="vd-hint" style={m.emptyBatch}>No calls confirmed yet.</p>
        )}

        {session.confirmedCalls.map(c => (
          <div key={c.visitId} style={m.batchItem}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <span>{c.street}</span>
              <button type="button" className="vd-key sm off" onClick={() => handleDeleteCall(c.visitId)} title="Remove call" aria-label={`Remove ${c.street}`}>×</button>
            </div>
            {c.subdivision && <div className="vd-hint">{c.subdivision}</div>}
          </div>
        ))}

        <button type="button" className="vd-key sm wide" style={{ marginTop: 14 }} onClick={() => addressRef.current?.focus()}>
          + Add another call
        </button>

        {session.confirmedCalls.length > 0 && (
          <button type="button" className="vd-key dark wide" style={{ marginTop: 12 }} onClick={handleRelease} disabled={releasing}>
            {releasing ? 'Releasing…' : 'Release to lobby'}
          </button>
        )}

        {session.batchId && (
          <button type="button" className="vd-key sm off wide" style={{ marginTop: 12 }} onClick={handleDeleteBatch}>Delete entire batch</button>
        )}
        </div>
      </div>

      {/* Right: entry form */}
      <div className="vd-unit">
        <div className="vd-unit-head"><span className="vd-unit-id">MAN</span><span className="vd-unit-name">New call — manual entry</span></div>
        <div className="vd-unit-body">

        {/* Address */}
        <div className="vd-select" style={{ marginBottom: 14 }}>
          <label className="vd-label">Address *</label>
          <input
            ref={addressRef}
            className="vd-input"
            value={draft.address}
            onChange={e => handleAddressInput(e.target.value)}
            onBlur={() => { clearTimeout(searchTimer.current); setTimeout(() => setShowSuggest(false), 150) }}
            onFocus={() => suggestions.length > 0 && setShowSuggest(true)}
            placeholder="Street address"
          />
          {showSuggest && suggestions.length > 0 && (
            <div className="vd-select-dropdown">
              {suggestions.map(sug => (
                <div key={sug.id} className="vd-select-item" onMouseDown={() => selectSuggestion(sug)}>
                  {sug.street}
                  {sug.city && ` — ${sug.city}`}
                  {sug.subdivision && <span className="vd-stencil"> ({sug.subdivision})</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Subdivision + Builder (recommended) */}
        <div className="vd-cols-2" style={m.row2}>
          <div>
            <label className="vd-label rec">Subdivision (recommended)</label>
            <input className="vd-input rec" value={draft.subdivision} onChange={e => setDraftField('subdivision', e.target.value)} />
          </div>
          <div>
            <label className="vd-label rec">Builder (recommended)</label>
            <input className="vd-input rec" value={draft.builder} onChange={e => setDraftField('builder', e.target.value)} />
          </div>
        </div>

        {/* Systems */}
        {draft.systems.map((sys, i) => (
          <div key={i}>
            <h4 className="vd-sub">
              {draft.systems.length > 1 ? `System ${i + 1}` : 'System'}
              {draft.systems.length > 1 && i > 0 && (
                <button type="button" className="vd-key sm off" onClick={() => removeSystem(i)}>Remove</button>
              )}
            </h4>
            <div className="vd-cols-3" style={m.sysRow}>
              <SearchableSelect
                value={sys.indoorModel} onChange={v => updateSystem(i, 'indoorModel', v)}
                options={indoorOptions} placeholder="Indoor model" classes={m.selectClassesSm}
              />
              <SearchableSelect
                value={sys.outdoorModel} onChange={v => updateSystem(i, 'outdoorModel', v)}
                options={outdoorOptions} placeholder="Outdoor model" classes={m.selectClassesSm}
              />
              <input className="vd-input sm" placeholder="Coil model" value={sys.coilModel} onChange={e => updateSystem(i, 'coilModel', e.target.value)} />
            </div>
          </div>
        ))}
        <button type="button" className="vd-key sm" style={m.addSystem} onClick={addSystem}>+ Add system</button>

        {/* Thermostat + Accessories */}
        <div className="vd-cols-2" style={m.row2}>
          <div>
            <label className="vd-label">Thermostat</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <div style={{ flex: 1 }}>
                <SearchableSelect
                  value={draft.thermostat} onChange={v => setDraftField('thermostat', v)}
                  options={thermostatOptions} placeholder="Model or N/A" classes={m.selectClasses} allowFreeText={false}
                />
              </div>
              <input className="vd-input data" style={{ width: 64 }} type="number" min="1" aria-label="Thermostat quantity" value={draft.thermostatQty} onChange={e => setDraftField('thermostatQty', parseInt(e.target.value, 10) || 1)} />
            </div>
          </div>
          <div>
            <label className="vd-label">Accessories</label>
            <MultiSelectChips
              value={draft.accessories} onChange={v => setDraftField('accessories', v)}
              options={accessoryOptions} placeholder="Search accessories…" classes={m.selectClasses} allowFreeText={false}
            />
          </div>
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 10 }}>
          <label className="vd-label">Notes</label>
          <textarea className="vd-input" style={{ resize: 'none' }} rows={2} value={draft.notes} onChange={e => setDraftField('notes', e.target.value)} />
        </div>

        {/* Collapsible details */}
        <button type="button" className="vd-key sm" style={m.expandLink} aria-expanded={detailsOpen} onClick={() => setDetailsOpen(v => !v)}>
          {detailsOpen ? '− Hide call details' : '+ Add call details (time, order #, contact, work type)'}
        </button>

        {detailsOpen && (
          <div style={{ marginBottom: 4 }}>
            <div className="vd-cols-2" style={m.row2}>
              <div>
                <label className="vd-label">Scheduled time</label>
                <input className="vd-input" type="time" value={draft.scheduledTime} onChange={e => setDraftField('scheduledTime', e.target.value)} />
              </div>
              <div>
                <label className="vd-label">Order #</label>
                <input className="vd-input" value={draft.orderNumber} onChange={e => setDraftField('orderNumber', e.target.value)} />
              </div>
            </div>
            <div className="vd-cols-2" style={m.row2}>
              <div>
                <label className="vd-label">Contact name</label>
                <input className="vd-input" value={draft.contactName} onChange={e => setDraftField('contactName', e.target.value)} />
              </div>
              <div>
                <label className="vd-label">Contact phone</label>
                <input className="vd-input" value={draft.contactPhone} onChange={e => setDraftField('contactPhone', e.target.value)} />
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label className="vd-label">Work type</label>
              <input className="vd-input" value={draft.workType} onChange={e => setDraftField('workType', e.target.value)} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <input
                type="checkbox"
                id="isPriority"
                checked={draft.isPriority}
                onChange={e => setDraftField('isPriority', e.target.checked)}
                style={{ width: 'auto', margin: 0 }}
              />
              <label htmlFor="isPriority" className="vd-label" style={{ marginBottom: 0 }}>Prioritario</label>
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={m.actions}>
          <button type="button" className="vd-key off" onClick={handleDiscard}>Discard</button>
          <button
            type="button"
            className="vd-key dark"
            onClick={handleConfirm}
            disabled={saving || !draft.address.trim()}
          >
            {saving ? 'Saving…' : 'Confirm'}
          </button>
        </div>
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

// ── Styles: layout only. Look comes from dispatch.css (vd-*) ─

const s = {
  page: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  modeBar: { display: 'flex', alignItems: 'center', gap: 16, padding: '16px 18px 0', flexShrink: 0 },
  center: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', overflowY: 'auto' },
  uploadCard: { width: '100%', maxWidth: '520px' },
  stack: { display: 'flex', flexDirection: 'column', gap: '14px' },
  flush: { margin: 0 },
  uploadProgress: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' },
  spinner: { width: '24px', height: '24px', border: '3px solid var(--vd-line)', borderTopColor: 'var(--vd-ink)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' },
  reviewLayout: { flex: 1, display: 'flex', gap: '18px', padding: '16px 18px 18px', overflow: 'hidden', minHeight: 0 },
  pdfPane: { flex: '1 1 50%', display: 'flex', flexDirection: 'column', minWidth: 0 },
  pdfFrame: { flex: 1, border: 'none', background: 'var(--vd-plate)' },
  pdfPlaceholder: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  formPane: { flex: '1 1 50%', display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' },
  formBody: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '14px', padding: '14px 18px 18px' },
  progressWrap: { display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0 },
  loadingCall: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  systemsBox: { display: 'flex', flexDirection: 'column', gap: '10px', flexShrink: 0 },
  sysRow: { display: 'flex', flexDirection: 'column', gap: '6px' },
  fieldsGrid: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', paddingRight: '4px' },
  fieldRow: { display: 'flex', flexDirection: 'column' },
  reviewActions: { display: 'flex', justifyContent: 'flex-end', gap: '12px', flexShrink: 0, paddingTop: '4px', paddingBottom: '4px' },
  doneCard: { width: '100%', maxWidth: '440px' },
  doneBody: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '14px' },
}

// Typeahead and chips (dispatch.css .vd-select-*), shared by both flows.
s.selectClasses = {
  input:        'vd-input',
  dropdown:     'vd-select-dropdown',
  dropdownItem: 'vd-select-item',
  addNewItem:   'vd-select-add',
  empty:        'vd-select-empty',
  chipsWrap:    'vd-chips',
  chip:         'vd-chip',
  chipRemove:   'vd-chip-remove',
}

const m = {
  layout:     { flex: 1, padding: '16px 18px 18px', overflowY: 'auto', alignContent: 'start' },
  successMsg: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 },
  emptyBatch: { margin: '0 0 12px' },
  batchItem:  { fontSize: '12px', padding: '8px 0', borderBottom: '1px solid var(--vd-line)' },
  sysRow:     { marginBottom: 8 },
  addSystem:  { marginBottom: 18 },
  row2:       { marginBottom: 18 },
  expandLink: { marginBottom: 18 },
  actions:    { display: 'flex', justifyContent: 'flex-end', gap: 12, paddingTop: 4 },
}

m.selectClasses = s.selectClasses
m.selectClassesSm = { ...s.selectClasses, input: 'vd-input sm' }
