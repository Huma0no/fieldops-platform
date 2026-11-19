/**
 * src/screens/Corrections.jsx
 * F8 — Corrections queue for Dispatch. One-way message from technician to dispatcher;
 * Apply just marks the correction resolved — it does not edit the visit itself.
 */

import { useState, useEffect, useRef } from 'react'
import { api } from '@shared/api.js'
import { openCorrectionFor } from '../lib/corrections.mjs'

const STATUS_LABEL = {
  open:    { text: 'Open',    variant: ' solid' },
  applied: { text: 'Applied', variant: ''       },
  expired: { text: 'Expired', variant: ' hatch' },
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
        setSelected(await openCorrectionFor(api, initialVisitId))
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
      <div className="vd-unit-head" style={styles.header}>
        <h2 className="vd-unit-name" style={styles.title}>Corrections</h2>
        <div style={{ display: 'flex', gap: '6px' }}>
          {openCount > 0 && (
            <span className="vd-badge solid">{openCount} open</span>
          )}
          <button className="vd-key sm" onClick={() => setFinding(true)}>Find Report</button>
        </div>
      </div>

      <div style={styles.tableWrap}>
        {loading ? (
          <p className="vd-hint" style={styles.flush}>Loading…</p>
        ) : corrections.length === 0 ? (
          <p className="vd-hint" style={styles.flush}>No correction requests. Use Find Report to start a dispatcher correction.</p>
        ) : (
          <table className="vd-table">
            <thead>
              <tr>
                {['Technician','Address','Date','Message','Status',''].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {corrections.map(c => {
                const s = STATUS_LABEL[c.status] ?? STATUS_LABEL.open
                return (
                  <tr key={c.id}>
                    <td>{c.requestedBy?.name ?? '—'}</td>
                    <td>{c.address?.street ?? '—'}</td>
                    <td>{formatDate(c.requestedAt)}</td>
                    <td style={styles.message}>
                      {c.message ?? '—'}
                    </td>
                    <td>
                      <span className={`vd-badge${s.variant}`}>{s.text}</span>
                    </td>
                    <td>
                      <button className="vd-key sm" onClick={() => openCorrection(c)}>Open</button>
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
  const [service, setService] = useState(() => normalizeService(snapshot.services, snapshot.systems))
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
      if (dirty.service) changes.services = service.driveRun ? [{ serviceName: 'Drive Run' }] : service.rows
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
        <div className="vd-unit-head" style={styles.header}>
          <button className="vd-key sm" onClick={onBack}>← Corrections</button>
        </div>
        <div style={styles.doneWrap}>
          <span className="vd-badge solid">✓ Applied</span>
          <p className="vd-stencil" style={styles.flush}>Correction applied</p>
          <p className="vd-hint" style={styles.doneText}>
            The structured source data was corrected and the report will regenerate from it. Resolved total: ${Number(appliedTotal ?? snapshot.totalPrice ?? 0).toFixed(2)}. History remains read-only.
          </p>
          <button className="vd-key sm" onClick={onBack}>Back to list</button>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <div className="vd-unit-head" style={styles.header}>
        <button className="vd-key sm" onClick={onBack}>← Corrections</button>
        <h2 className="vd-unit-name" style={styles.title}>{correction.address?.street ?? 'Correction request'}</h2>
      </div>

      <div style={styles.detailBody}>

        {/* Request info */}
        <div style={styles.section}>
          <h4 className="vd-sub">Request</h4>
          <dl className="vd-kv">
            <InfoRow label="Initiator" value={correction.initiator?.name} />
            <InfoRow label="Origin" value={correction.origin === 'dispatcher_initiated' ? 'Dispatcher initiated' : 'Technician requested'} />
            <InfoRow label="Date"       value={formatDate(correction.requestedAt)} />
          </dl>
        </div>

        {correction.requestMessage && <div style={styles.section}>
          <h4 className="vd-sub">Technician request</h4>
          <div style={styles.messageBox}>
            <p style={styles.messageText}>{correction.requestMessage}</p>
          </div>
        </div>}

        {isOpen && (
          <div style={styles.section}>
            <h4 className="vd-sub">Job and property</h4>
            <div className="vd-form-grid">
              <label>Order #<input className="vd-input sm" value={jobContext.orderNumber} onChange={e => updateJob('orderNumber', e.target.value)} /></label>
              <label>Scheduled date<input type="date" className="vd-input sm" value={jobContext.scheduledDate} onChange={e => updateJob('scheduledDate', e.target.value)} /></label>
              <label>Scheduled time<input className="vd-input sm" value={jobContext.scheduledTime} onChange={e => updateJob('scheduledTime', e.target.value)} /></label>
              <label>Work type<input className="vd-input sm" value={jobContext.workType} onChange={e => updateJob('workType', e.target.value)} /></label>
              <label>Builder<input className="vd-input sm" value={propertyContext.builder} onChange={e => updateProperty('builder', e.target.value)} /></label>
              <label style={{ gridColumn:'1 / -1' }}>Street<input className="vd-input sm" value={propertyContext.street} onChange={e => updateProperty('street', e.target.value)} /></label>
              <label>City<input className="vd-input sm" value={propertyContext.city} onChange={e => updateProperty('city', e.target.value)} /></label>
              <label>State<input className="vd-input sm" value={propertyContext.state} onChange={e => updateProperty('state', e.target.value)} /></label>
              <label>ZIP<input className="vd-input sm" value={propertyContext.zip} onChange={e => updateProperty('zip', e.target.value)} /></label>
              <label>Subdivision<input className="vd-input sm" value={propertyContext.subdivision} onChange={e => updateProperty('subdivision', e.target.value)} /></label>
              <label>Contact name<input className="vd-input sm" value={jobContext.contactName} onChange={e => updateJob('contactName', e.target.value)} /></label>
              <label>Contact phone<input className="vd-input sm" value={jobContext.contactPhone} onChange={e => updateJob('contactPhone', e.target.value)} /></label>
              <label>Contact channel<input className="vd-input sm" value={jobContext.contactChannel} onChange={e => updateJob('contactChannel', e.target.value)} /></label>
              <label style={{ gridColumn:'1 / -1' }}>Company notes<textarea className="vd-input sm" value={jobContext.companyNotes} onChange={e => updateJob('companyNotes', e.target.value)} rows={2} /></label>
            </div>
          </div>
        )}

        {isOpen && <div style={styles.section}>
          <h4 className="vd-sub">Service</h4>
          {/* W1c: one service per system, or a call-wide Drive Run. */}
          <label style={styles.checkRow}>Drive Run (whole call)
            <input type="checkbox" checked={service.driveRun} onChange={e => { setService(current => ({ ...current, driveRun: e.target.checked })); setDirty(current => ({ ...current, service: true })) }} />
          </label>
          {!service.driveRun && service.rows.map(row => {
            const update = patch => { setService(current => ({ ...current, rows: current.rows.map(r => r.systemNumber === row.systemNumber ? { ...r, ...patch } : r) })); setDirty(current => ({ ...current, service: true })) }
            const acHeat = AC_HEAT_SERVICES.has(row.serviceName)
            return <div key={row.systemNumber} className="vd-form-grid">
              <label>System {row.systemNumber}
                <select className="vd-input sm" value={row.serviceName} onChange={e => {
                  const name = e.target.value
                  update({ serviceName: name, isFinish: name === 'Finish' ? true : name === 'Prestart' ? false : row.isFinish, isTemporarily: AC_HEAT_SERVICES.has(name) ? row.isTemporarily : false })
                }}>
                  {SYSTEM_SERVICE_NAMES.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
              {row.serviceName !== 'Finish' && row.serviceName !== 'Prestart' && <label style={styles.checkRow}>Finish
                <input type="checkbox" checked={row.isFinish} onChange={e => update({ isFinish: e.target.checked })} />
              </label>}
              {acHeat && <label style={styles.checkRow}>Temporarily
                <input type="checkbox" checked={row.isTemporarily} onChange={e => update({ isTemporarily: e.target.checked })} />
              </label>}
            </div>
          })}
          {snapshot.terminalStatus === 'temporarily' && <p className="vd-hint" style={styles.flush}>This report remains Temporarily; terminal status is not editable in Corrections.</p>}
          <p className="vd-hint" style={styles.flush}>Current resolved total: ${Number(snapshot.totalPrice ?? 0).toFixed(2)}. The server recalculates it only when Apply is used.</p>
        </div>}

        {isOpen && <details style={styles.collapsible}>
          <summary style={styles.collapsibleSummary}>Systems and equipment <span>▸</span></summary>
          <div className="vd-form-grid">
            {systems.map(system => {
              const measurement = weighIn.find(row => row.systemNumber === system.systemNumber)
              return <div key={system.systemNumber} style={{ gridColumn:'1 / -1', ...styles.systemPanel }}>
              <strong>System {system.systemNumber}</strong>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:'8px', marginTop:'6px' }}>
                <CatalogModelSelect label="Indoor equipment" value={system.indoorModel} onChange={value => updateSystem(system.systemNumber, 'indoorModel', value)} models={catalog.equipment.filter(item => item.unit_type === 'furnace' || item.unit_type === 'air_handler')} />
                <CatalogModelSelect label="Outdoor equipment" value={system.outdoorModel} onChange={value => updateSystem(system.systemNumber, 'outdoorModel', value)} models={catalog.equipment.filter(item => item.unit_type === 'condenser' || item.unit_type === 'heat_pump')} />
                <CatalogModelSelect label="Coil" value={system.coilModel} onChange={value => updateSystem(system.systemNumber, 'coilModel', value)} models={catalog.equipment.filter(item => item.unit_type === 'coil')} />
                <label>Refrigerant (catalog-derived)<input className="vd-input sm" value={catalog.equipment.find(item => item.model === system.outdoorModel)?.refrigerant ?? system.refrigerant ?? ''} readOnly /></label>
              </div>
              {measurement ? <details style={styles.weighDisclosure}>
                <summary style={styles.systemSummary}>Weigh-In {system.systemNumber} <span>▸</span></summary>
                <WeighInFields row={measurement} catalog={catalog} onChange={updateWeighIn} />
              </details> : <button type="button" className="vd-key sm" onClick={() => { setWeighIn(current => [...current, { systemNumber: system.systemNumber, linesetLength: null, factoryLineConfig: '', factoryChargeOz: null, adjustedOz: null, fanSpeedCfm: null, liquidLineTemp: null, suctionLineTemp: null, condenserSatTemp: null }]); setDirty(current => ({ ...current, weighIn: true })) }}>Add Weigh-In</button>}
            </div>})}
          </div>
          <p className="vd-hint" style={styles.flush}>Existing systems can be corrected; system count/topology is not changed here.</p>
        </details>}

        {isOpen && <div style={styles.section}>
          <h4 className="vd-sub">Thermostat</h4>
          <div className="vd-form-grid">
            <label>Catalog thermostat
              <select className="vd-input sm" value={thermostat?.itemName ?? ''} onChange={e => {
                const next = e.target.value
                setItems(current => [...current.filter(item => item.category !== 'thermostat'), ...(next ? [{ itemName: next, category: 'thermostat', quantity: 1, price: 0, description: '' }] : [])]); setDirty(current => ({ ...current, items: true }))
              }}>
                <option value="">None</option>{thermostats.map(item => <option key={item.item_name} value={item.item_name}>{item.item_name}</option>)}
              </select>
            </label>
            {thermostat && <label>Quantity
              <input className="vd-input sm" type="number" min="1" value={thermostat.quantity} onChange={e => updateItem(thermostat.itemName, { quantity: Number(e.target.value) })} />
            </label>}
          </div>
        </div>}

        {isOpen && <div style={styles.section}>
          <h4 className="vd-sub">Accessories and fixes</h4>
          <div className="vd-form-grid">
            <label style={{ gridColumn: '1 / -1' }}>Add catalog item
              <select className="vd-input sm" defaultValue="" onChange={e => { addItem(e.target.value); e.target.value = '' }}>
                <option value="">Select…</option>{selectableItems.filter(item => !items.some(selected => selected.itemName === item.item_name)).map(item => <option key={item.item_name} value={item.item_name}>{item.category === 'fix' ? 'Fix — ' : 'Accessory — '}{item.item_name}</option>)}
              </select>
            </label>
            {workItems.map(item => {
              const definition = catalog.items.find(entry => entry.item_name === item.itemName)
              const custom = definition?.custom_price
              const needsDescription = item.itemName === 'Other' || item.itemName === 'Other Fix'
              return <div key={item.itemName} style={styles.itemRow}>
                <strong style={styles.itemName}>{item.itemName}</strong> <button type="button" className="vd-key sm" onClick={() => { setItems(current => current.filter(selected => selected.itemName !== item.itemName)); setDirty(current => ({ ...current, items: true })) }}>Remove</button>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(130px, 1fr))', gap:'8px', marginTop:'6px' }}>
                  <label>Quantity<input className="vd-input sm" type="number" min="1" value={item.quantity} onChange={e => updateItem(item.itemName, { quantity: Number(e.target.value) })} /></label>
                  {custom && <label>Price<input className="vd-input sm" type="number" min="0" step="0.01" value={item.price} onChange={e => updateItem(item.itemName, { price: Number(e.target.value) })} /></label>}
                  {needsDescription && <label>Description<input className="vd-input sm" value={item.description ?? ''} onChange={e => updateItem(item.itemName, { description: e.target.value })} /></label>}
                </div>
              </div>
            })}
          </div>
        </div>}

        {isOpen && <details style={styles.collapsible}>
          <summary style={styles.collapsibleSummary}>Checklist <span>▸</span></summary>
          <div className="vd-form-grid">
            <div style={{ gridColumn:'1 / -1' }}>
              {CHECKLIST_ITEMS.map(([key, label]) => <label key={key} style={styles.checkRow}>{label}
                <select className="vd-input sm" style={styles.select} value={answers[key] ?? ''} onChange={e => { setAnswers(prev => ({ ...prev, [key]: e.target.value || undefined })); setDirty(current => ({ ...current, checklist: true })) }}>
                  <option value="">Unanswered</option><option value="yes">Yes</option><option value="no">No</option>
                </select>
              </label>)}
            </div>
          </div>
        </details>}

        {isOpen && <div style={styles.section}>
          <h4 className="vd-sub">Notes</h4>
          <label>Notes<textarea className="vd-input sm" value={notes} onChange={e => { setNotes(e.target.value); setDirty(current => ({ ...current, notes: true })) }} rows={3} /></label>
          <label>Note (optional)<textarea className="vd-input sm" value={note} onChange={e => setNote(e.target.value)} rows={2} /></label>
        </div>}

        {(snapshot.photos ?? []).length > 0 && <div style={styles.section}>
          <h4 className="vd-sub">Photos / evidence</h4>
          <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
            {snapshot.photos.map(photo => <span key={photo.id} className="vd-chip" title="Evidence is read-only after completion">
              {photo.label || photo.tag || photo.category || 'Evidence'}{photo.system_number ? ` · System ${photo.system_number}` : ''}
            </span>)}
          </div>
          <p className="vd-hint" style={styles.flush}>Evidence is read-only in Corrections. Image preview is unavailable until Dispatch has an authorized image-serving endpoint.</p>
        </div>}

        {/* Actions */}
        {isOpen && (
          <div style={styles.actionsWrap}>
            {actionError && <p className="vd-error">{actionError}</p>}
            <p className="vd-hint" style={styles.flush}>
              Total is recalculated by the server when this correction is applied; it cannot be edited here. Applied changes preserve the terminal status.
            </p>
            <button className="vd-key dark" onClick={handleApply} disabled={applying}>
              {applying ? 'Applying…' : 'Apply'}
            </button>
          </div>
        )}

        {!isOpen && (
          <div style={styles.resolvedNote}>
            <p style={styles.flush}>
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
      onStarted(await openCorrectionFor(api, selected.id))
    } catch (err) { setError(err.message ?? 'Could not begin correction.') }
  }
  return <div style={styles.page}><div className="vd-unit-head" style={styles.header}><button className="vd-key sm" onClick={onBack}>Requested Corrections</button><h2 className="vd-unit-name" style={styles.title}>Find Report</h2></div>
    <div style={styles.detailBody}><div className="vd-form-grid">
      <label>Order #<input className="vd-input sm" value={filters.orderNumber} onChange={e => setFilters(f => ({ ...f, orderNumber:e.target.value }))} /></label>
      <label>Address<input className="vd-input sm" value={filters.address} onChange={e => setFilters(f => ({ ...f, address:e.target.value }))} /></label>
      <label>Technician<input className="vd-input sm" value={filters.technician} onChange={e => setFilters(f => ({ ...f, technician:e.target.value }))} /></label>
      <label>Exact date<input className="vd-input sm" type="date" value={filters.date} onChange={e => setFilters(f => ({ ...f, date:e.target.value }))} /></label>
      <label>From<input className="vd-input sm" type="date" value={filters.dateFrom} onChange={e => setFilters(f => ({ ...f, dateFrom:e.target.value }))} /></label>
      <label>To<input className="vd-input sm" type="date" value={filters.dateTo} onChange={e => setFilters(f => ({ ...f, dateTo:e.target.value }))} /></label>
    </div><button type="button" className="vd-key dark" style={styles.searchBtn} onClick={search}>Search</button>
    {results.map(visit => <button type="button" key={visit.id} style={styles.resultRow} onClick={() => setSelected(visit)}>{formatDate(visit.completedAt)} · {visit.orderNumber || 'No order #'} · {visit.address.street} · {visit.technician?.name || 'Unassigned'} · {visit.status} · ${Number(visit.totalPrice ?? 0).toFixed(2)}</button>)}
    {selected && <div style={styles.messageBox}><p style={styles.messageText}>Selected: {selected.address.street} — current report data remains read-only until Apply.</p><button className="vd-key dark" onClick={begin}>Open Correction</button></div>}
    {error && <p className="vd-error">{error}</p>}</div></div>
}

const SYSTEM_SERVICE_NAMES = ['AC', 'Heat', 'AC & Heat', 'Prestart', 'Finish']
const AC_HEAT_SERVICES = new Set(['AC', 'Heat', 'AC & Heat'])

// One editable row per system. A legacy call-wide row applies to every system.
function normalizeService (services = [], systems = []) {
  const driveRun = services.some(s => s.service_name === 'Drive Run')
  const numbers = systems.length ? systems.map(s => s.system_number) : [1]
  const callWide = services.find(s => s.system_number == null && s.service_name !== 'Drive Run')
  const rows = numbers.map(systemNumber => {
    const s = services.find(row => row.system_number === systemNumber) ?? callWide
    return {
      systemNumber,
      serviceName: s && SYSTEM_SERVICE_NAMES.includes(s.service_name) ? s.service_name : 'AC',
      isFinish: Boolean(s?.is_finish),
      isTemporarily: Boolean(s?.is_temporarily),
    }
  })
  return { driveRun, rows }
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
  return <label>{label}<select className="vd-input sm" value={value ?? ''} onChange={event => onChange(event.target.value)}>
    <option value="">Not recorded</option>
    {hasCurrent && <option value={value}>{value} (stored)</option>}
    {models.map(model => <option key={model.model} value={model.model}>{model.brand} {model.model}</option>)}
  </select></label>
}

function WeighInFields ({ row, catalog, onChange }) {
  return <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(130px, 1fr))', gap:'8px', marginTop:'6px' }}>
    <NumberField label="Lineset length" value={row.linesetLength} onChange={value => onChange(row.systemNumber, 'linesetLength', value)} />
    <label>Factory line config<select className="vd-input sm" value={row.factoryLineConfig ?? ''} onChange={e => onChange(row.systemNumber, 'factoryLineConfig', e.target.value)}><option value="">Select…</option>{catalog.linesets.map(config => <option key={config.config_key} value={config.config_key}>{config.config_key}</option>)}</select></label>
    <NumberField label="Factory charge oz" value={row.factoryChargeOz} onChange={value => onChange(row.systemNumber, 'factoryChargeOz', value)} />
    <NumberField label="Adjusted oz" value={row.adjustedOz} onChange={value => onChange(row.systemNumber, 'adjustedOz', value)} />
    <NumberField label="Fan speed CFM" value={row.fanSpeedCfm} onChange={value => onChange(row.systemNumber, 'fanSpeedCfm', value)} />
    <NumberField label="Liquid line temp" value={row.liquidLineTemp} onChange={value => onChange(row.systemNumber, 'liquidLineTemp', value)} />
    <NumberField label="Suction line temp" value={row.suctionLineTemp} onChange={value => onChange(row.systemNumber, 'suctionLineTemp', value)} />
    <NumberField label="Condenser saturation temp" value={row.condenserSatTemp} onChange={value => onChange(row.systemNumber, 'condenserSatTemp', value)} />
    <label>Approx. adjustment (derived)<input className="vd-input sm" value={row.approxAdjustOz ?? ''} readOnly /></label>
    <label>Subcooling (derived)<input className="vd-input sm" value={row.subcoolingValue ?? ''} readOnly /></label>
    <label>Subcooling deviation (derived)<input className="vd-input sm" value={row.subcoolingDeviation ?? ''} readOnly /></label>
  </div>
}

function NumberField ({ label, value, onChange }) {
  return <label>{label}<input className="vd-input sm" type="number" value={value ?? ''} onChange={event => onChange(event.target.value === '' ? null : Number(event.target.value))} /></label>
}

function InfoRow ({ label, value }) {
  return <><dt>{label}</dt><dd>{value || '—'}</dd></>
}

function formatDate (iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch (_) { return '—' }
}

// Layout only; the look comes from dispatch.css (vd-*).
const styles = {
  page:       { flex:1, overflowY:'auto', padding:'16px 18px 18px', display:'flex', flexDirection:'column', gap:'18px' },
  header:     { border:'2px solid var(--vd-ink)', flexWrap:'wrap', flexShrink:0 },
  title:      { margin:0 },
  tableWrap:  { overflowX:'auto' },
  message:    { maxWidth:'260px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' },
  flush:      { margin:0 },

  detailBody:  { display:'flex', flexDirection:'column', gap:'20px', border:'2px solid var(--vd-ink)', background:'var(--vd-plate)', padding:'18px' },
  section:     { display:'flex', flexDirection:'column', gap:'8px' },
  collapsible: { display:'flex', flexDirection:'column', gap:'10px', border:'2px solid var(--vd-ink)', padding:'10px 14px', background:'var(--vd-plate)' },
  collapsibleSummary: { cursor:'pointer', color:'var(--vd-dim)', fontFamily:'var(--vd-font-stencil)', fontSize:'11px', textTransform:'uppercase', letterSpacing:'2px', display:'flex', justifyContent:'space-between' },
  systemPanel: { borderTop:'1px solid var(--vd-line)', paddingTop:'10px', display:'flex', flexDirection:'column', gap:'8px' },
  weighDisclosure: { borderTop:'1px solid var(--vd-line)', paddingTop:'8px' },
  systemSummary: { cursor:'pointer', fontFamily:'var(--vd-font-stencil)', fontSize:'11px', textTransform:'uppercase', letterSpacing:'1.4px', fontWeight:700, display:'flex', justifyContent:'space-between' },
  messageBox:  { border:'2px solid var(--vd-ink)', background:'var(--vd-plate)', padding:'12px 14px', display:'flex', flexDirection:'column', gap:'10px', alignItems:'flex-start' },
  searchBtn:   { alignSelf:'flex-start' },
  resultRow:   { border:'2px solid var(--vd-ink)', background:'var(--vd-plate)', padding:'10px 14px', textAlign:'left', cursor:'pointer', font:'inherit', color:'inherit' },
  messageText: { margin:0, fontSize:'13px', lineHeight:1.5, whiteSpace:'pre-wrap' },
  checkRow:    { display:'flex', justifyContent:'space-between', alignItems:'center', gap:'12px', padding:'5px 0', borderBottom:'1px solid var(--vd-line)' },
  select:      { width:'auto' },
  itemRow:     { gridColumn:'1 / -1', borderTop:'1px solid var(--vd-line)', paddingTop:'10px' },
  itemName:    { color:'var(--vd-ink)', marginRight:'8px' },
  actionsWrap: { display:'flex', flexDirection:'column', gap:'10px', alignItems:'flex-start' },
  resolvedNote:{ border:'2px solid var(--vd-ink)', background:'var(--vd-plate)', padding:'12px 14px' },
  doneWrap:    { flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:'12px', padding:'40px 24px' },
  doneText:    { maxWidth:'360px', textAlign:'center', margin:0 },
}
