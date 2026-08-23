/**
 * src/screens/Corrections.jsx
 * F8 — Corrections queue for Dispatch. One-way message from technician to dispatcher;
 * Apply just marks the correction resolved — it does not edit the visit itself.
 */

import { useState, useEffect, useRef } from 'react'
import { api } from '@shared/api.js'

const STATUS_LABEL = {
  open:    { text: 'Open',    color: 'var(--color-plasma)', bg: 'var(--plasma-tint)'   },
  applied: { text: 'Applied', color: '#22C55E',              bg: 'rgba(34,197,94,0.12)' },
  expired: { text: 'Expired', color: 'var(--text-disabled)', bg: 'var(--surface-3)'     },
}

const CHECKLIST_ITEMS = [
  ['pdrain_ecoil', 'P-drain [eCoil]'], ['pdrain_disch', 'P-drain [Discharge]'],
  ['tstat_locked', 'Tstat Locked?'], ['media_filter', 'Media Filter'],
  ['electric_meter', 'Electric Meter'], ['breaker_cond', 'Breaker — Condenser'],
  ['breaker_ah', 'Breaker — Air Handler'], ['disconnect_box', 'Disconnect box'],
  ['whip_220v', 'Whip 220v'], ['furnace_switch', 'Furnace disconnect switch'],
  ['cable_110v', '110v cable'], ['gas_meter', 'Gas Meter'],
  ['gas_pipes', 'Gas Pipes/Tubing at Furnace'], ['gas_valve', 'Gas Valve'],
]

export default function Corrections ({ initialVisitId }) {
  const [corrections, setCorrections] = useState([])
  const [loading, setLoading]         = useState(true)
  const [selected, setSelected]       = useState(null)
  const [finding, setFinding]         = useState(true)
  const openedVisitRef = useRef(null)

  useEffect(() => { loadCorrections() }, [])

  useEffect(() => {
    if (!initialVisitId || openedVisitRef.current === initialVisitId) return
    openedVisitRef.current = initialVisitId
    ;(async () => {
      try {
        const existing = await api.get(`/dispatch/corrections?visitId=${encodeURIComponent(initialVisitId)}&status=open`)
        const correction = existing?.[0] ?? await api.post('/dispatch/corrections', { visitId: initialVisitId })
        const id = correction.correctionId ?? correction.id
        setSelected(await api.get(`/dispatch/corrections/${id}`))
        setFinding(false)
      } catch (err) { console.error('direct correction open failed:', err) }
    })()
  }, [initialVisitId])

  async function loadCorrections () {
    setLoading(true)
    try {
      const data = await api.get('/dispatch/corrections')
      setCorrections(data ?? [])
    } catch (err) {
      console.error('corrections load failed:', err)
    } finally {
      setLoading(false)
    }
  }

  async function openCorrection (c) {
    try {
      const detail = await api.get(`/dispatch/corrections/${c.id}`)
      setSelected(detail)
    } catch (err) {
      console.error('correction detail failed:', err)
      setSelected(c)
    }
  }

  if (selected) {
    return (
      <CorrectionDetail
        correction={selected}
        onBack={() => { setSelected(null); loadCorrections() }}
      />
    )
  }

  if (finding) return <Finder onBack={() => setFinding(false)} onStarted={setSelected} initialVisitId={initialVisitId} />

  const openCount = corrections.filter(c => c.status === 'open').length

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h2 style={styles.title}>Corrections</h2>
        <div style={{ display: 'flex', gap: '6px' }}>
          {openCount > 0 && (
            <span style={styles.count}>{openCount} open</span>
          )}
          <button style={styles.openBtn} onClick={() => setFinding(true)}>Find Report</button>
        </div>
      </div>

      <div style={styles.tableWrap}>
        {loading ? (
          <p style={styles.muted}>Loading…</p>
        ) : corrections.length === 0 ? (
          <p style={styles.muted}>No correction requests. Use Find Report to start a dispatcher correction.</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                {['Technician','Address','Date','Message','Status',''].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {corrections.map(c => {
                const s = STATUS_LABEL[c.status] ?? STATUS_LABEL.open
                return (
                  <tr key={c.id} style={styles.tr}>
                    <td style={styles.td}>{c.requestedBy?.name ?? '—'}</td>
                    <td style={styles.td}>{c.address?.street ?? '—'}</td>
                    <td style={styles.td}>{formatDate(c.requestedAt)}</td>
                    <td style={{ ...styles.td, maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.message ?? '—'}
                    </td>
                    <td style={styles.td}>
                      <span style={{ fontSize: '11px', fontWeight: 500, color: s.color, background: s.bg, padding: '2px 10px', borderRadius: '99px' }}>
                        {s.text}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <button style={styles.openBtn} onClick={() => openCorrection(c)}>Open</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Correction detail ──────────────────────────────────────

function CorrectionDetail ({ correction, onBack }) {
  const [applying, setApplying]       = useState(false)
  const [actionError, setActionError] = useState('')
  const [applied, setApplied]         = useState(false)
  const [appliedTotal, setAppliedTotal] = useState(null)

  const isOpen = correction.status === 'open'

  const snapshot = correction.visitSnapshot ?? {}
  const [jobContext, setJobContext] = useState(() => normalizeJobContext(snapshot.jobContext))
  const [propertyContext, setPropertyContext] = useState(() => normalizePropertyContext(snapshot.propertyContext))
  const [notes, setNotes] = useState(snapshot.notes ?? '')
  const [note, setNote] = useState(correction.note ?? '')
  const [answers, setAnswers] = useState(() => Object.fromEntries((snapshot.checklistAnswers ?? []).map(a => [a.item, a.answer])))
  const [catalog, setCatalog] = useState({ items: [], services: [], linesets: [], equipment: [] })
  const [service, setService] = useState(() => normalizeService(snapshot.services))
  const [items, setItems] = useState(() => normalizeItems(snapshot.items))
  const [weighIn, setWeighIn] = useState(() => normalizeWeighIn(snapshot.weighIn))
  const [systems, setSystems] = useState(() => normalizeSystems(snapshot.systems))
  const [dirty, setDirty] = useState({ jobContext: false, propertyContext: false, notes: false, checklist: false, service: false, items: false, systems: false, weighIn: false })

  useEffect(() => {
    Promise.all([api.get('/catalog/items'), api.get('/catalog/services'), api.get('/catalog/lineset-configs'), api.get('/catalog/equipment')])
      .then(([items, services, linesets, equipment]) => setCatalog({ items: items ?? [], services: services ?? [], linesets: linesets ?? [], equipment: equipment ?? [] }))
      .catch(err => setActionError(err.message ?? 'Catalog could not be loaded.'))
  }, [])

  const thermostats = catalog.items.filter(item => item.category === 'thermostat')
  const selectableItems = catalog.items.filter(item => item.category === 'accessory' || item.category === 'fix')
  const thermostat = items.find(item => item.category === 'thermostat') ?? null
  const workItems = items.filter(item => item.category !== 'thermostat')

  function updateItem (itemName, patch) {
    setItems(current => current.map(item => item.itemName === itemName ? { ...item, ...patch } : item))
    setDirty(current => ({ ...current, items: true }))
  }
  function addItem (itemName) {
    const entry = catalog.items.find(item => item.item_name === itemName)
    if (!entry || items.some(item => item.itemName === itemName)) return
    setItems(current => [...current, { itemName, category: entry.category, quantity: 1, price: entry.default_price ?? 0, description: '' }])
    setDirty(current => ({ ...current, items: true }))
  }
  function updateJob (field, value) {
    setJobContext(current => ({ ...current, [field]: value }))
    setDirty(current => ({ ...current, jobContext: true }))
  }
  function updateProperty (field, value) {
    setPropertyContext(current => ({ ...current, [field]: value }))
    setDirty(current => ({ ...current, propertyContext: true }))
  }
  function updateSystem (systemNumber, field, value) {
    setSystems(current => current.map(system => system.systemNumber === systemNumber ? { ...system, [field]: value } : system))
    setDirty(current => ({ ...current, systems: true }))
  }
  function updateWeighIn (systemNumber, field, value) {
    setWeighIn(current => current.map(row => row.systemNumber === systemNumber ? { ...row, [field]: value } : row))
    setDirty(current => ({ ...current, weighIn: true }))
  }

  async function handleApply () {
    setApplying(true); setActionError('')
    try {
      const checklistAnswers = CHECKLIST_ITEMS
        .filter(([key]) => answers[key] === 'yes' || answers[key] === 'no')
        .map(([item]) => ({ item, answer: answers[item] }))
      const changes = {}
      if (dirty.jobContext) changes.jobContext = jobContext
      if (dirty.propertyContext) changes.propertyContext = propertyContext
      if (dirty.notes) changes.notes = notes
      if (dirty.checklist) changes.checklistAnswers = checklistAnswers
      if (dirty.service) changes.services = [service]
      if (dirty.items) changes.items = items
      if (dirty.systems) changes.systems = systems
      if (dirty.weighIn) {
        if (weighIn.some(row => !row.factoryLineConfig)) {
          setActionError('Each Weigh-In measurement requires a factory line config.')
          return
        }
        changes.weighIn = weighIn
      }
      const result = await api.patch(`/dispatch/corrections/${correction.id}/apply`, { changes, note })
      setAppliedTotal(result.totalPrice)
      setApplied(true)
    } catch (err) {
      setActionError(err.message ?? 'Apply failed.')
    } finally { setApplying(false) }
  }

  if (applied) {
    return (
      <div style={styles.page}>
        <div style={styles.header}>
          <button style={styles.backBtn} onClick={onBack}>← Corrections</button>
        </div>
        <div style={styles.doneWrap}>
          <p style={{ fontSize: '32px' }}>✓</p>
          <p style={{ fontSize: '16px', fontWeight: 500, color: 'var(--text-primary)' }}>Correction applied</p>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', maxWidth: '320px', textAlign: 'center' }}>
            The structured source data was corrected and the report will regenerate from it. Resolved total: ${Number(appliedTotal ?? snapshot.totalPrice ?? 0).toFixed(2)}. History remains read-only.
          </p>
          <button style={styles.openBtn} onClick={onBack}>Back to list</button>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={onBack}>← Corrections</button>
        <h2 style={styles.title}>{correction.address?.street ?? 'Correction request'}</h2>
      </div>

      <div style={styles.detailBody}>

        {/* Request info */}
        <div style={styles.section}>
          <p style={styles.sectionTitle}>Request</p>
          <div style={styles.infoGrid}>
            <InfoRow label="Initiator" value={correction.initiator?.name} />
            <InfoRow label="Origin" value={correction.origin === 'dispatcher_initiated' ? 'Dispatcher initiated' : 'Technician requested'} />
            <InfoRow label="Date"       value={formatDate(correction.requestedAt)} />
          </div>
        </div>

        {correction.requestMessage && <div style={styles.section}>
          <p style={styles.sectionTitle}>Technician request</p>
          <div style={styles.messageBox}>
            <p style={styles.messageText}>{correction.requestMessage}</p>
          </div>
        </div>}

        {isOpen && (
          <div style={styles.section}>
            <p style={styles.sectionTitle}>Job and property</p>
            <div style={styles.editorGrid}>
              <label>Order #<input style={styles.input} value={jobContext.orderNumber} onChange={e => updateJob('orderNumber', e.target.value)} /></label>
              <label>Scheduled date<input type="date" style={styles.input} value={jobContext.scheduledDate} onChange={e => updateJob('scheduledDate', e.target.value)} /></label>
              <label>Scheduled time<input style={styles.input} value={jobContext.scheduledTime} onChange={e => updateJob('scheduledTime', e.target.value)} /></label>
              <label>Work type<input style={styles.input} value={jobContext.workType} onChange={e => updateJob('workType', e.target.value)} /></label>
              <label>Builder<input style={styles.input} value={propertyContext.builder} onChange={e => updateProperty('builder', e.target.value)} /></label>
              <label style={{ gridColumn:'1 / -1' }}>Street<input style={styles.input} value={propertyContext.street} onChange={e => updateProperty('street', e.target.value)} /></label>
              <label>City<input style={styles.input} value={propertyContext.city} onChange={e => updateProperty('city', e.target.value)} /></label>
              <label>State<input style={styles.input} value={propertyContext.state} onChange={e => updateProperty('state', e.target.value)} /></label>
              <label>ZIP<input style={styles.input} value={propertyContext.zip} onChange={e => updateProperty('zip', e.target.value)} /></label>
              <label>Subdivision<input style={styles.input} value={propertyContext.subdivision} onChange={e => updateProperty('subdivision', e.target.value)} /></label>
              <label>Contact name<input style={styles.input} value={jobContext.contactName} onChange={e => updateJob('contactName', e.target.value)} /></label>
              <label>Contact phone<input style={styles.input} value={jobContext.contactPhone} onChange={e => updateJob('contactPhone', e.target.value)} /></label>
              <label>Contact channel<input style={styles.input} value={jobContext.contactChannel} onChange={e => updateJob('contactChannel', e.target.value)} /></label>
              <label style={{ gridColumn:'1 / -1' }}>Company notes<textarea style={styles.textarea} value={jobContext.companyNotes} onChange={e => updateJob('companyNotes', e.target.value)} rows={2} /></label>
            </div>
          </div>
        )}

        {isOpen && <div style={styles.section}>
          <p style={styles.sectionTitle}>Service</p>
          <div style={styles.editorGrid}>
            <label>Service
              <select style={styles.input} value={service.serviceName} onChange={e => { setService(current => ({ ...current, serviceName: e.target.value, isFinish: e.target.value === 'Finish' ? true : current.isFinish })); setDirty(current => ({ ...current, service: true })) }}>
                {catalog.services.filter(s => s.service_name !== 'Cancel').map(s => <option key={s.service_name} value={s.service_name}>{s.service_name}</option>)}
              </select>
            </label>
            {service.serviceName !== 'Finish' && <label style={styles.checkRow}>Finish modifier
              <input type="checkbox" checked={service.isFinish} onChange={e => { setService(current => ({ ...current, isFinish: e.target.checked })); setDirty(current => ({ ...current, service: true })) }} />
            </label>}
          </div>
          {snapshot.terminalStatus === 'temporarily' && <p style={styles.hintText}>This report remains Temporarily; terminal status is not editable in Corrections.</p>}
          <p style={styles.hintText}>Current resolved total: ${Number(snapshot.totalPrice ?? 0).toFixed(2)}. The server recalculates it only when Apply is used.</p>
        </div>}

        {isOpen && <details style={styles.collapsible}>
          <summary style={styles.collapsibleSummary}>Systems and equipment <span>▸</span></summary>
          <div style={styles.editorGrid}>
            {systems.map(system => {
              const measurement = weighIn.find(row => row.systemNumber === system.systemNumber)
              return <div key={system.systemNumber} style={{ gridColumn:'1 / -1', ...styles.systemPanel }}>
              <strong>System {system.systemNumber}</strong>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:'8px', marginTop:'6px' }}>
                <CatalogModelSelect label="Indoor equipment" value={system.indoorModel} onChange={value => updateSystem(system.systemNumber, 'indoorModel', value)} models={catalog.equipment.filter(item => item.unit_type === 'furnace' || item.unit_type === 'air_handler')} />
                <CatalogModelSelect label="Outdoor equipment" value={system.outdoorModel} onChange={value => updateSystem(system.systemNumber, 'outdoorModel', value)} models={catalog.equipment.filter(item => item.unit_type === 'condenser' || item.unit_type === 'heat_pump')} />
                <CatalogModelSelect label="Coil" value={system.coilModel} onChange={value => updateSystem(system.systemNumber, 'coilModel', value)} models={catalog.equipment.filter(item => item.unit_type === 'coil')} />
                <label>Refrigerant (catalog-derived)<input style={styles.input} value={catalog.equipment.find(item => item.model === system.outdoorModel)?.refrigerant ?? system.refrigerant ?? ''} readOnly /></label>
              </div>
              {measurement ? <details style={styles.weighDisclosure}>
                <summary style={styles.systemSummary}>Weigh-In {system.systemNumber} <span>▸</span></summary>
                <WeighInFields row={measurement} catalog={catalog} onChange={updateWeighIn} />
              </details> : <button type="button" style={styles.openBtn} onClick={() => { setWeighIn(current => [...current, { systemNumber: system.systemNumber, linesetLength: null, factoryLineConfig: '', factoryChargeOz: null, adjustedOz: null, fanSpeedCfm: null, liquidLineTemp: null, suctionLineTemp: null, condenserSatTemp: null }]); setDirty(current => ({ ...current, weighIn: true })) }}>Add Weigh-In</button>}
            </div>})}
          </div>
          <p style={styles.hintText}>Existing systems can be corrected; system count/topology is not changed here.</p>
        </details>}

        {isOpen && <div style={styles.section}>
          <p style={styles.sectionTitle}>Thermostat</p>
          <div style={styles.editorGrid}>
            <label>Catalog thermostat
              <select style={styles.input} value={thermostat?.itemName ?? ''} onChange={e => {
                const next = e.target.value
                setItems(current => [...current.filter(item => item.category !== 'thermostat'), ...(next ? [{ itemName: next, category: 'thermostat', quantity: 1, price: 0, description: '' }] : [])]); setDirty(current => ({ ...current, items: true }))
              }}>
                <option value="">None</option>{thermostats.map(item => <option key={item.item_name} value={item.item_name}>{item.item_name}</option>)}
              </select>
            </label>
            {thermostat && <label>Quantity
              <input style={styles.input} type="number" min="1" value={thermostat.quantity} onChange={e => updateItem(thermostat.itemName, { quantity: Number(e.target.value) })} />
            </label>}
          </div>
        </div>}

        {isOpen && <div style={styles.section}>
          <p style={styles.sectionTitle}>Accessories and fixes</p>
          <div style={styles.editorGrid}>
            <label style={{ gridColumn: '1 / -1' }}>Add catalog item
              <select style={styles.input} defaultValue="" onChange={e => { addItem(e.target.value); e.target.value = '' }}>
                <option value="">Select…</option>{selectableItems.filter(item => !items.some(selected => selected.itemName === item.item_name)).map(item => <option key={item.item_name} value={item.item_name}>{item.category === 'fix' ? 'Fix — ' : 'Accessory — '}{item.item_name}</option>)}
              </select>
            </label>
            {workItems.map(item => {
              const definition = catalog.items.find(entry => entry.item_name === item.itemName)
              const custom = definition?.custom_price
              const needsDescription = item.itemName === 'Other' || item.itemName === 'Other Fix'
              return <div key={item.itemName} style={{ gridColumn: '1 / -1', borderTop: '0.5px solid var(--border-subtle)', paddingTop: '8px' }}>
                <strong>{item.itemName}</strong> <button type="button" style={styles.backBtn} onClick={() => { setItems(current => current.filter(selected => selected.itemName !== item.itemName)); setDirty(current => ({ ...current, items: true })) }}>Remove</button>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(130px, 1fr))', gap:'8px', marginTop:'6px' }}>
                  <label>Quantity<input style={styles.input} type="number" min="1" value={item.quantity} onChange={e => updateItem(item.itemName, { quantity: Number(e.target.value) })} /></label>
                  {custom && <label>Price<input style={styles.input} type="number" min="0" step="0.01" value={item.price} onChange={e => updateItem(item.itemName, { price: Number(e.target.value) })} /></label>}
                  {needsDescription && <label>Description<input style={styles.input} value={item.description ?? ''} onChange={e => updateItem(item.itemName, { description: e.target.value })} /></label>}
                </div>
              </div>
            })}
          </div>
        </div>}

        {isOpen && <details style={styles.collapsible}>
          <summary style={styles.collapsibleSummary}>Checklist <span>▸</span></summary>
          <div style={styles.editorGrid}>
            <div style={{ gridColumn:'1 / -1' }}>
              {CHECKLIST_ITEMS.map(([key, label]) => <label key={key} style={styles.checkRow}>{label}
                <select style={styles.select} value={answers[key] ?? ''} onChange={e => { setAnswers(prev => ({ ...prev, [key]: e.target.value || undefined })); setDirty(current => ({ ...current, checklist: true })) }}>
                  <option value="">Unanswered</option><option value="yes">Yes</option><option value="no">No</option>
                </select>
              </label>)}
            </div>
          </div>
        </details>}

        {isOpen && <div style={styles.section}>
          <p style={styles.sectionTitle}>Notes</p>
          <label>Notes<textarea style={styles.textarea} value={notes} onChange={e => { setNotes(e.target.value); setDirty(current => ({ ...current, notes: true })) }} rows={3} /></label>
          <label>Note (optional)<textarea style={styles.textarea} value={note} onChange={e => setNote(e.target.value)} rows={2} /></label>
        </div>}

        {(snapshot.photos ?? []).length > 0 && <div style={styles.section}>
          <p style={styles.sectionTitle}>Photos / evidence</p>
          <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
            {snapshot.photos.map(photo => <span key={photo.id} style={styles.evidenceChip} title="Evidence is read-only after completion">
              {photo.label || photo.tag || photo.category || 'Evidence'}{photo.system_number ? ` · System ${photo.system_number}` : ''}
            </span>)}
          </div>
          <p style={styles.hintText}>Evidence is read-only in Corrections. Image preview is unavailable until Dispatch has an authorized image-serving endpoint.</p>
        </div>}

        {/* Actions */}
        {isOpen && (
          <div style={styles.actionsWrap}>
            {actionError && <p style={styles.errorText}>{actionError}</p>}
            <p style={styles.hintText}>
              Total is recalculated by the server when this correction is applied; it cannot be edited here. Applied changes preserve the terminal status.
            </p>
            <button style={styles.approveBtn} onClick={handleApply} disabled={applying}>
              {applying ? 'Applying…' : 'Apply'}
            </button>
          </div>
        )}

        {!isOpen && (
          <div style={styles.resolvedNote}>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              This correction is <strong>{correction.status}</strong>.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function Finder ({ onBack, onStarted, initialVisitId }) {
  const [filters, setFilters] = useState({ orderNumber: '', address: '', technician: '', date: '', dateFrom: '', dateTo: '' })
  const [results, setResults] = useState([])
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!initialVisitId) return
    api.get(`/visits/${initialVisitId}`).then(visit => setSelected({
      id: visit.id, orderNumber: visit.orderNumber, status: visit.status,
      completedAt: visit.completedAt, totalPrice: visit.totalPrice,
      address: visit.address, technician: visit.technician,
    })).catch(err => setError(err.message ?? 'Selected report could not be opened.'))
  }, [initialVisitId])
  async function search () {
    const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value))
    setError('')
    try { setResults(await api.get(`/dispatch/corrections/finder?${params}`)) } catch (err) { setError(err.message ?? 'Search failed.') }
  }
  async function begin () {
    if (!selected) return setError('Select a report first.')
    try {
      const created = await api.post('/dispatch/corrections', { visitId: selected.id })
      onStarted(await api.get(`/dispatch/corrections/${created.correctionId}`))
    } catch (err) { setError(err.message ?? 'Could not begin correction.') }
  }
  return <div style={styles.page}><div style={styles.header}><button style={styles.backBtn} onClick={onBack}>Requested Corrections</button><h2 style={styles.title}>Find Report</h2></div>
    <div style={styles.detailBody}><div style={styles.editorGrid}>
      <label>Order #<input style={styles.input} value={filters.orderNumber} onChange={e => setFilters(f => ({ ...f, orderNumber:e.target.value }))} /></label>
      <label>Address<input style={styles.input} value={filters.address} onChange={e => setFilters(f => ({ ...f, address:e.target.value }))} /></label>
      <label>Technician<input style={styles.input} value={filters.technician} onChange={e => setFilters(f => ({ ...f, technician:e.target.value }))} /></label>
      <label>Exact date<input style={styles.input} type="date" value={filters.date} onChange={e => setFilters(f => ({ ...f, date:e.target.value }))} /></label>
      <label>From<input style={styles.input} type="date" value={filters.dateFrom} onChange={e => setFilters(f => ({ ...f, dateFrom:e.target.value }))} /></label>
      <label>To<input style={styles.input} type="date" value={filters.dateTo} onChange={e => setFilters(f => ({ ...f, dateTo:e.target.value }))} /></label>
    </div><button style={styles.openBtn} onClick={search}>Search</button>
    {results.map(visit => <button key={visit.id} style={{ ...styles.messageBox, textAlign:'left', cursor:'pointer' }} onClick={() => setSelected(visit)}>{formatDate(visit.completedAt)} · {visit.orderNumber || 'No order #'} · {visit.address.street} · {visit.technician?.name || 'Unassigned'} · {visit.status} · ${Number(visit.totalPrice ?? 0).toFixed(2)}</button>)}
    {selected && <div style={styles.messageBox}><p style={styles.messageText}>Selected: {selected.address.street} — current report data remains read-only until Apply.</p><button style={styles.approveBtn} onClick={begin}>Open Correction</button></div>}
    {error && <p style={styles.errorText}>{error}</p>}</div></div>
}

function normalizeService (services) {
  const service = services?.[0]
  return {
    serviceName: service?.service_name ?? 'AC',
    isFinish: Boolean(service?.is_finish),
    isTemporarily: Boolean(service?.is_temporarily),
  }
}

function normalizeJobContext (job = {}) {
  return {
    orderNumber: job.orderNumber ?? '', scheduledDate: job.scheduledDate ?? '', scheduledTime: job.scheduledTime ?? '',
    workType: job.workType ?? '', companyNotes: job.companyNotes ?? '',
    contactName: job.contactName ?? '', contactPhone: job.contactPhone ?? '',
    contactChannel: job.contactChannel ?? '',
  }
}

function normalizePropertyContext (property = {}) {
  return {
    street: property.street ?? '', city: property.city ?? '', state: property.state ?? '',
    zip: property.zip ?? '', subdivision: property.subdivision ?? '', builder: property.builder ?? '',
  }
}

function normalizeItems (items) {
  return (items ?? []).map(item => ({
    itemName: item.item_name,
    category: item.category,
    description: item.description ?? '',
    quantity: item.quantity ?? 1,
    price: item.price ?? 0,
  }))
}

function normalizeWeighIn (rows) {
  return (rows ?? []).map(row => ({
    systemNumber: row.system_number,
    linesetLength: row.lineset_length,
    factoryChargeOz: row.factory_charge_oz,
    factoryLineConfig: row.factory_line_config,
    approxAdjustOz: row.approx_adjust_oz,
    adjustedOz: row.adjusted_oz,
    fanSpeedCfm: row.fan_speed_cfm,
    liquidLineTemp: row.liquid_line_temp,
    suctionLineTemp: row.suction_line_temp,
    condenserSatTemp: row.condenser_sat_temp,
    subcoolingValue: row.subcooling_value,
    subcoolingDeviation: row.subcooling_deviation,
  }))
}

function normalizeSystems (rows) {
  return (rows ?? []).map(row => ({
    systemNumber: row.system_number,
    indoorModel: row.indoor_model ?? '', outdoorModel: row.outdoor_model ?? '',
    coilModel: row.coil_model ?? '', refrigerant: row.refrigerant ?? '',
  }))
}

function CatalogModelSelect ({ label, value, onChange, models }) {
  const hasCurrent = value && !models.some(model => model.model === value)
  return <label>{label}<select style={styles.input} value={value ?? ''} onChange={event => onChange(event.target.value)}>
    <option value="">Not recorded</option>
    {hasCurrent && <option value={value}>{value} (stored)</option>}
    {models.map(model => <option key={model.model} value={model.model}>{model.brand} {model.model}</option>)}
  </select></label>
}

function WeighInFields ({ row, catalog, onChange }) {
  return <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(130px, 1fr))', gap:'8px', marginTop:'6px' }}>
    <NumberField label="Lineset length" value={row.linesetLength} onChange={value => onChange(row.systemNumber, 'linesetLength', value)} />
    <label>Factory line config<select style={styles.input} value={row.factoryLineConfig ?? ''} onChange={e => onChange(row.systemNumber, 'factoryLineConfig', e.target.value)}><option value="">Select…</option>{catalog.linesets.map(config => <option key={config.config_key} value={config.config_key}>{config.config_key}</option>)}</select></label>
    <NumberField label="Factory charge oz" value={row.factoryChargeOz} onChange={value => onChange(row.systemNumber, 'factoryChargeOz', value)} />
    <NumberField label="Adjusted oz" value={row.adjustedOz} onChange={value => onChange(row.systemNumber, 'adjustedOz', value)} />
    <NumberField label="Fan speed CFM" value={row.fanSpeedCfm} onChange={value => onChange(row.systemNumber, 'fanSpeedCfm', value)} />
    <NumberField label="Liquid line temp" value={row.liquidLineTemp} onChange={value => onChange(row.systemNumber, 'liquidLineTemp', value)} />
    <NumberField label="Suction line temp" value={row.suctionLineTemp} onChange={value => onChange(row.systemNumber, 'suctionLineTemp', value)} />
    <NumberField label="Condenser saturation temp" value={row.condenserSatTemp} onChange={value => onChange(row.systemNumber, 'condenserSatTemp', value)} />
    <label>Approx. adjustment (derived)<input style={styles.input} value={row.approxAdjustOz ?? ''} readOnly /></label>
    <label>Subcooling (derived)<input style={styles.input} value={row.subcoolingValue ?? ''} readOnly /></label>
    <label>Subcooling deviation (derived)<input style={styles.input} value={row.subcoolingDeviation ?? ''} readOnly /></label>
  </div>
}

function NumberField ({ label, value, onChange }) {
  return <label>{label}<input style={styles.input} type="number" value={value ?? ''} onChange={event => onChange(event.target.value === '' ? null : Number(event.target.value))} /></label>
}

function InfoRow ({ label, value }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', gap:'16px', padding:'6px 0', borderBottom:'0.5px solid var(--border-subtle)' }}>
      <span style={{ fontSize:'12px', color:'var(--text-muted)', flexShrink:0 }}>{label}</span>
      <span style={{ fontSize:'13px', color:'var(--text-secondary)', textAlign:'right' }}>{value || '—'}</span>
    </div>
  )
}

function formatDate (iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch (_) { return '—' }
}

const styles = {
  page:       { flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:'var(--surface-base)' },
  header:     { padding:'16px 24px', borderBottom:'0.5px solid var(--border-subtle)', background:'var(--surface-1)', display:'flex', alignItems:'center', gap:'12px', flexShrink:0, flexWrap:'wrap' },
  title:      { fontSize:'16px', fontWeight:500, color:'var(--text-primary)' },
  backBtn:    { background:'none', border:'none', color:'var(--text-muted)', fontSize:'13px', cursor:'pointer', padding:0, flexShrink:0 },
  count:      { fontSize:'12px', color:'var(--text-muted)', background:'var(--surface-3)', padding:'2px 10px', borderRadius:'99px' },
  tableWrap:  { flex:1, overflowY:'auto', padding:'16px 24px' },
  table:      { width:'100%', borderCollapse:'collapse', fontSize:'13px' },
  th:         { textAlign:'left', padding:'8px 12px', color:'var(--text-muted)', fontWeight:500, fontSize:'11px', textTransform:'uppercase', letterSpacing:'0.04em', borderBottom:'0.5px solid var(--border-subtle)' },
  tr:         { borderBottom:'0.5px solid var(--border-subtle)' },
  td:         { padding:'10px 12px', color:'var(--text-secondary)', verticalAlign:'middle' },
  openBtn:    { background:'none', border:'0.5px solid var(--border-default)', borderRadius:'6px', color:'var(--text-muted)', fontSize:'12px', padding:'4px 10px', cursor:'pointer' },
  muted:      { color:'var(--text-muted)', fontSize:'14px' },

  detailBody:  { flex:1, overflowY:'auto', padding:'20px 24px', display:'flex', flexDirection:'column', gap:'20px' },
  section:     { display:'flex', flexDirection:'column', gap:'8px' },
  collapsible: { display:'flex', flexDirection:'column', gap:'8px', border:'0.5px solid var(--border-subtle)', borderRadius:'8px', padding:'10px 12px', background:'var(--surface-1)' },
  collapsibleSummary: { cursor:'pointer', color:'var(--text-disabled)', fontSize:'11px', textTransform:'uppercase', letterSpacing:'0.05em', fontWeight:500, display:'flex', justifyContent:'space-between' },
  systemDisclosure: { borderTop:'0.5px solid var(--border-subtle)', paddingTop:'8px' },
  systemPanel: { borderTop:'0.5px solid var(--border-subtle)', paddingTop:'10px', display:'flex', flexDirection:'column', gap:'8px' },
  weighDisclosure: { borderTop:'0.5px solid var(--border-subtle)', paddingTop:'8px' },
  systemSummary: { cursor:'pointer', color:'var(--text-secondary)', fontSize:'12px', fontWeight:600, display:'flex', justifyContent:'space-between' },
  sectionTitle:{ fontSize:'11px', color:'var(--text-disabled)', textTransform:'uppercase', letterSpacing:'0.05em', fontWeight:500 },
  infoGrid:    { background:'var(--surface-1)', borderRadius:'8px', padding:'8px 12px', border:'0.5px solid var(--border-subtle)' },
  messageBox:  { background:'var(--surface-1)', borderRadius:'8px', border:'0.5px solid var(--border-subtle)', padding:'12px 14px' },
  messageText: { fontSize:'13px', color:'var(--text-secondary)', lineHeight:1.5, whiteSpace:'pre-wrap' },
  snapshot:    { background:'var(--surface-1)', borderRadius:'8px', border:'0.5px solid var(--border-subtle)', overflow:'hidden', maxHeight:'200px', overflowY:'auto' },
  snapshotPre: { fontSize:'11px', color:'var(--text-muted)', padding:'12px', margin:0, fontFamily:'var(--font-mono)', lineHeight:1.5 },
  editorGrid: { display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:'10px', background:'var(--surface-1)', border:'0.5px solid var(--border-subtle)', borderRadius:'8px', padding:'12px', color:'var(--text-muted)', fontSize:'12px' },
  input: { display:'block', width:'100%', boxSizing:'border-box', marginTop:'4px', background:'var(--surface-2)', border:'0.5px solid var(--border-default)', borderRadius:'6px', color:'var(--text-primary)', padding:'6px 8px' },
  textarea: { display:'block', width:'100%', boxSizing:'border-box', marginTop:'4px', background:'var(--surface-2)', border:'0.5px solid var(--border-default)', borderRadius:'6px', color:'var(--text-primary)', padding:'6px 8px', resize:'vertical' },
  checkRow: { display:'flex', justifyContent:'space-between', gap:'12px', padding:'4px 0', borderBottom:'0.5px solid var(--border-subtle)' },
  select: { background:'var(--surface-2)', color:'var(--text-primary)', border:'0.5px solid var(--border-default)', borderRadius:'5px' },

  actionsWrap: { display:'flex', flexDirection:'column', gap:'10px' },
  hintText:    { fontSize:'12px', color:'var(--text-muted)' },
  approveBtn:  { background:'var(--color-signal)', color:'#fff', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:500, padding:'10px', cursor:'pointer' },
  resolvedNote:{ background:'var(--surface-1)', borderRadius:'8px', padding:'12px 14px', border:'0.5px solid var(--border-subtle)' },
  errorText:   { fontSize:'12px', color:'var(--color-heat)' },
  evidenceChip:{ fontSize:'11px', color:'var(--text-muted)', background:'var(--surface-3)', padding:'3px 8px', borderRadius:'99px', border:'0.5px solid var(--border-subtle)' },
  doneWrap:    { flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:'12px', padding:'0 24px' },
}
