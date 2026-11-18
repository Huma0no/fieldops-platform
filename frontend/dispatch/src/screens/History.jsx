/**
 * src/screens/History.jsx
 * F6 — Completed visit history with checklist and edit log context.
 */

import { useState, useEffect } from 'react'
import { api } from '@shared/api.js'

const CHECKLIST_ITEMS = [
  ['pdrain_ecoil', 'P-drain [eCoil]'],
  ['pdrain_disch', 'P-drain [Discharge]'],
  ['tstat_locked', 'Tstat Locked?'],
  ['media_filter', 'Media Filter'],
  ['electric_meter', 'Electric Meter'],
  ['breaker_cond', 'Breaker — Condenser'],
  ['breaker_ah', 'Breaker — Air Handler'],
  ['disconnect_box', 'Disconnect box'],
  ['whip_220v', 'Whip 220v'],
  ['furnace_switch', 'Furnace disconnect switch'],
  ['cable_110v', '110v cable'],
  ['gas_meter', 'Gas Meter'],
  ['gas_pipes', 'Gas Pipes/Tubing at Furnace'],
  ['gas_valve', 'Gas Valve'],
]

export default function History ({ onCorrectReport }) {
  const [visits, setVisits]       = useState([])
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState(null)   // full visit detail
  const [editLog, setEditLog]     = useState([])
  const [filters, setFilters]     = useState({ dateFrom: '', dateTo: '', technician: '', builder: '' })
  const [propertyHistory, setPropertyHistory] = useState([])

  useEffect(() => { loadHistory() }, [])

  async function loadHistory () {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.dateFrom)    params.set('dateFrom', filters.dateFrom)
      if (filters.dateTo)      params.set('dateTo', filters.dateTo)
      if (filters.technician)  params.set('technician', filters.technician)
      if (filters.builder)     params.set('builder', filters.builder)
      const data = await api.get(`/dispatch/history?${params}`)
      setVisits(data ?? [])
    } catch (err) {
      console.error('history load failed:', err)
    } finally {
      setLoading(false)
    }
  }

  async function openVisit (visit) {
    setPropertyHistory([])
    try {
      const [detail, log, report, propHist] = await Promise.all([
        api.get(`/visits/${visit.id}`),
        api.get(`/dispatch/visits/${visit.id}/edit-log`),
        api.get(`/visits/${visit.id}/download`),
        visit.addressId ? api.get(`/dispatch/history/address/${visit.addressId}`) : Promise.resolve([]),
      ])
      const merged = { ...detail, weighInData: report?.weighInData ?? [], priceDiscrepancies: report?.priceDiscrepancies ?? [], weighInWarnings: report?.weighInWarnings ?? [] }
      setSelected(merged)
      setEditLog(log ?? [])
      setPropertyHistory((propHist ?? []).filter(v => v.id !== visit.id))
    } catch (err) {
      console.error('visit load failed:', err)
    }
  }

  if (selected) {
    return (
      <VisitDetail
        visit={selected}
        editLog={editLog}
        propertyHistory={propertyHistory}
        onBack={() => setSelected(null)}
        onCorrectReport={onCorrectReport}
      />
    )
  }

  return (
    <div style={styles.page}>
      <div className="vd-unit">
        <div className="vd-unit-head"><span className="vd-unit-id">HST</span><span className="vd-unit-name">History</span><span className="vd-unit-note">All technicians · one feed</span></div>
        <div className="vd-knurl" />
        <div className="vd-unit-body">
          <div style={styles.filters}>
            <input className="vd-input sm" style={styles.filterInput} aria-label="From date" placeholder="From date" type="date" value={filters.dateFrom} onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))} />
            <input className="vd-input sm" style={styles.filterInput} aria-label="To date" placeholder="To date" type="date" value={filters.dateTo} onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))} />
            <input className="vd-input sm" style={styles.filterInput} placeholder="Technician" value={filters.technician} onChange={e => setFilters(f => ({ ...f, technician: e.target.value }))} />
            <input className="vd-input sm" style={styles.filterInput} placeholder="Builder" value={filters.builder} onChange={e => setFilters(f => ({ ...f, builder: e.target.value }))} />
            <button type="button" className="vd-key sm dark" onClick={loadHistory}>Search</button>
            {!loading && (
              <div className="vd-readout inline" style={styles.count}>
                <span className="num">{String(visits.length).padStart(2, '0')}</span><span className="cap">loaded</span>
              </div>
            )}
          </div>

          {loading ? (
            <p className="vd-hint">Loading…</p>
          ) : visits.length === 0 ? (
            <p className="vd-hint">No visits found for the selected filters.</p>
          ) : (
            <div style={styles.tableScroll}>
            <table className="vd-table">
              <thead>
                <tr>
                  {['Order #','Address','Date','Technician','Service','Total','Status',''].map(h => <th key={h}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {visits.map(v => (
                  <tr key={v.id}>
                    <td className="num">{v.orderNumber ?? '—'}</td>
                    <td style={styles.addr}>{v.address?.street ?? '—'}</td>
                    <td className="num" style={styles.nowrap}>{formatDate(v.completedAt)}</td>
                    <td>{v.technicianName ?? '—'}</td>
                    <td>{v.workType ?? '—'}</td>
                    <td className="num" style={styles.nowrap}>
                      {formatPrice(v.totalPrice)}
                      {v.has_price_anomaly && <span style={styles.anomalyIcon} title="Price outside catalog range">⚠</span>}
                    </td>
                    <td><span className="vd-badge">{v.status}</span></td>
                    <td style={styles.acts}>
                      <button type="button" className="vd-key sm" onClick={() => openVisit(v)}>Details</button>
                      <button type="button" className="vd-key sm off" style={styles.gap} onClick={() => onCorrectReport?.(v.id)}>Correct</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function WeighInSection ({ data }) {
  const [open, setOpen] = useState(false)
  const LABELS = {
    linesetLength: 'Lineset length', factoryChargeOz: 'Factory charge oz',
    factoryLineConfig: 'Factory line config', adjustedOz: 'Adjusted oz',
    fanSpeedCfm: 'Fan speed CFM', liquidLineTemp: 'Liquid line temp',
    suctionLineTemp: 'Suction line temp', condenserSatTemp: 'Condenser sat temp',
    subcoolingValue: 'Subcooling', oemSubcoolingGoal: 'OEM subcooling goal',
    subcoolingDeviation: 'Subcooling deviation',
  }
  const entries = Object.entries(LABELS).filter(([k]) => data[k] != null)
  if (entries.length === 0) return null
  return (
    <div>
      <button type="button" className={`vd-fold${open ? ' open' : ''}`} aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <span className="mark">{open ? '−' : '+'}</span>
        <span>System {data.systemNumber}</span>
      </button>
      {open && (
        <div className="vd-fold-body">
          <div className="vd-wi-grid">
            {entries.map(([k, label]) => (
              <div key={k}><span className="vd-stencil">{label}</span><span className="vd-data">{data[k]}</span></div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ChecklistSection ({ answers }) {
  const byItem = new Map((answers ?? []).map(answer => [answer.item, answer.answer]))
  return (
    <section className="vd-section">
      <h4 className="vd-sub">Checklist</h4>
      <table className="vd-table">
        <tbody>
          {CHECKLIST_ITEMS.map(([key, label]) => {
            const answer = byItem.get(key)
            return (
              <tr key={key}>
                <td>{label}</td>
                <td style={styles.right}>
                  {answer === 'yes' ? <span className="vd-badge">Yes</span>
                    : answer === 'no' ? <span className="vd-badge solid">No</span>
                    : <span className="vd-hint">Unanswered</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

const DISCREPANCY_FIELDS = {
  totalPrice: 'Total',
  'service.price': 'Service price',
  'services.price': 'Service price',
  'items.price': 'Price',
  'items.techSupplied': 'Tech supplied',
}

function equipmentText (equipment) {
  const parts = [
    equipment?.outdoorModel ?? '—',
    equipment?.indoorModel && `indoor ${equipment.indoorModel}`,
    equipment?.coilModel && `coil ${equipment.coilModel}`,
    equipment?.refrigerant,
  ].filter(Boolean)
  return parts.join(' · ')
}

function formatChangeTime (iso) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function discrepancyLabel (d) {
  const field = DISCREPANCY_FIELDS[d.field] ?? d.field
  return d.row ? `${d.row} · ${field}` : field
}

function discrepancyValue (value) {
  if (typeof value === 'number') return `$${value.toFixed(2)}`
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return value ?? '—'
}

function VisitDetail ({ visit, editLog, propertyHistory, onBack, onCorrectReport }) {
  const FIELDS = [
    { label: 'Address',        value: visit.address?.street },
    { label: 'Order #',        value: visit.orderNumber },
    { label: 'Technician',     value: visit.technician?.name },
    { label: 'Builder',        value: visit.address?.builder },
    { label: 'Subdivision',    value: visit.address?.subdivision },
    { label: 'Work type',      value: visit.workType },
    { label: 'Scheduled date', value: formatDate(visit.scheduledDate) },
    { label: 'Scheduled time', value: visit.scheduledTime },
    { label: 'Completed',      value: formatDate(visit.completedAt) },
    { label: 'Status',         value: visit.status },
    { label: 'Notes',          value: visit.notes },
  ]

  return (
    <div style={styles.page}>
      <div style={styles.detailHeader}>
        <button type="button" className="vd-key sm" onClick={onBack}>← History</button>
        <h2 className="vd-unit-name" style={styles.detailTitle}>{visit.address?.street ?? 'Visit'}</h2>
        <button type="button" className="vd-key sm dark" onClick={() => onCorrectReport?.(visit.id)}>Correct Report</button>
        {visit.has_price_anomaly && <span className="vd-badge hatch">⚠ Price outside catalog range</span>}
        {(visit.priceDiscrepancies ?? []).length > 0 && <span className="vd-badge hatch">⚠ Device prices differ from catalog</span>}
        {(visit.systemChanges ?? []).length > 0 && <span className="vd-badge hatch">Changed by tech</span>}
        {(visit.weighInWarnings ?? []).length > 0 && <span className="vd-badge solid">Incomplete</span>}
      </div>

      <div className="vd-detail-cols">
        {/* Left — finalized source visit data. */}
        <div className="vd-unit" style={styles.detailCol}>
          <div className="vd-unit-head"><span className="vd-unit-id">RPT</span><span className="vd-unit-name">Visit record</span><span className="vd-unit-note">{visit.technician?.name ?? ''}</span></div>
          <div className="vd-knurl" />
          <div className="vd-unit-body" style={styles.scroll}>
          <section className="vd-section">
            <h4 className="vd-sub">Visit details</h4>
            <dl className="vd-kv">
              {FIELDS.map(({ label, value }) => (
                <div key={label} style={{ display: 'contents' }}>
                  <dt>{label}</dt>
                  <dd>{value || '—'}</dd>
                </div>
              ))}
            </dl>
          </section>

          {(visit.systems ?? []).length > 0 && <section className="vd-section">
            <h4 className="vd-sub">Systems and equipment</h4>
            <div className="vd-cols-2">
              {visit.systems.map(system => (
                <div key={system.systemNumber} className="vd-readout">
                  <div className="vd-stencil">System {system.systemNumber}{system.addedByTechnician && <span className="vd-badge" style={{ marginLeft: '8px' }}>Added by tech</span>}</div>
                  <div className="vd-data" style={styles.model}>{system.indoorModel ?? '—'}</div>
                  <div className="vd-data" style={styles.model}>{system.outdoorModel ?? '—'}</div>
                  {system.coilModel && <div className="vd-data" style={styles.model}>{system.coilModel}</div>}
                  <div className="cap">indoor · outdoor{system.coilModel ? ' · coil' : ''}{system.refrigerant ? ` · ${system.refrigerant}` : ''}</div>
                </div>
              ))}
            </div>
          </section>}

          {/* Weigh-In sent incomplete: the technician's device listed what was missing. */}
          {(visit.weighInWarnings ?? []).length > 0 && <section className="vd-section">
            <h4 className="vd-sub">Incomplete Weigh-In</h4>
            <table className="vd-table"><tbody>
              {visit.weighInWarnings.map((text, i) => <tr key={i}><td>{text}</td></tr>)}
            </tbody></table>
          </section>}

          {/* W1b: systems the technician added or whose equipment changed.
              The original order data is kept as "before". */}
          {(visit.systemChanges ?? []).length > 0 && <section className="vd-section">
            <h4 className="vd-sub">Changed by tech</h4>
            <div style={styles.tableScroll}>
            <table className="vd-table">
              <thead><tr><th>System</th><th>Change</th><th>Before → After</th><th>Who</th><th>When</th></tr></thead>
              <tbody>
                {visit.systemChanges.map((c, i) => (
                  <tr key={i}>
                    <td className="num">{c.systemNumber}</td>
                    <td>{c.change === 'added' ? 'System added' : 'Equipment modified'}</td>
                    <td>{c.before ? `${equipmentText(c.before)} → ` : ''}{equipmentText(c.after)}</td>
                    <td>{c.technicianName}</td>
                    <td className="num">{formatChangeTime(c.changedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </section>}

          <ChecklistSection answers={visit.checklistAnswers} />

          {/* PP-01: values the technician's device sent that differ from the catalog.
              The Report uses the catalog (server) value. */}
          {(visit.priceDiscrepancies ?? []).length > 0 && <section className="vd-section">
            <h4 className="vd-sub">Price check</h4>
            <table className="vd-table">
              <thead><tr><th>Line</th><th style={styles.right}>Device</th><th style={styles.right}>Catalog</th></tr></thead>
              <tbody>
                {visit.priceDiscrepancies.map((d, i) => (
                  <tr key={i}>
                    <td>{discrepancyLabel(d)}</td>
                    <td className="num" style={styles.right}>{discrepancyValue(d.submitted)}</td>
                    <td className="num" style={styles.right}>{discrepancyValue(d.accepted)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>}

          {/* Services (B3) */}
          {(visit.services ?? []).length > 0 && <section className="vd-section">
            <h4 className="vd-sub">Services</h4>
            <table className="vd-table"><tbody>
              {visit.services.map((s, i) => (
                <tr key={i}>
                  <td>{s.systemNumber != null ? `System ${s.systemNumber} · ` : ''}{s.serviceName}{s.isFinish ? ' · Finish' : ''}{s.isTemporarily ? ' · Temporarily' : ''}</td>
                  <td className="num" style={styles.right}>{s.price != null ? `$${Number(s.price).toFixed(2)}` : ''}</td>
                </tr>
              ))}
            </tbody></table>
          </section>}

          {/* Items (B3) */}
          {(visit.items ?? []).length > 0 && <section className="vd-section">
            <h4 className="vd-sub">Items</h4>
            <table className="vd-table"><tbody>
              {visit.items.map((item, i) => (
                <tr key={i}>
                  <td>{item.itemName}{item.description ? ` — ${item.description}` : ''}</td>
                  <td className="num" style={styles.right}>{item.quantity} × ${Number(item.price ?? 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody></table>
          </section>}

          {/* Weigh-in (B3) */}
          {(visit.weighInData ?? []).length > 0 && <section className="vd-section">
            <h4 className="vd-sub">Weigh-in</h4>
            {visit.weighInData.map(w => <WeighInSection key={w.systemNumber} data={w} />)}
          </section>}

          {/* Photos (B3). A photo can reach the server after its Report; until
              then it shows as pending. */}
          {(visit.photos ?? []).length > 0 && <section className="vd-section">
            <h4 className="vd-sub">Photos</h4>
            <div style={styles.photos}>
              {visit.photos.map(p => (
                <figure key={p.id} className="vd-photo">
                  {p.storedAt
                    ? <a href={`/api/visits/${visit.id}/photos/${p.id}`} target="_blank" rel="noreferrer">
                        <img src={`/api/visits/${visit.id}/photos/${p.id}`} alt={p.slug} />
                      </a>
                    : <div className="pending">Upload pending</div>}
                  <figcaption>
                    {p.label || p.tag || p.category || 'Evidence'}{p.systemNumber ? ` · System ${p.systemNumber}` : ''}
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>}
          </div>
        </div>

        {/* Right — property history + edit log */}
        <div className="vd-unit" style={styles.detailCol}>
          <div className="vd-unit-head"><span className="vd-unit-id">LOG</span><span className="vd-unit-name">Property · Edit log</span></div>
          <div className="vd-unit-body" style={styles.scroll}>
          {/* Property history (B2) */}
          {propertyHistory.length > 0 && <section className="vd-section">
            <h4 className="vd-sub">Property history</h4>
            <table className="vd-table">
              <tbody>
                {propertyHistory.map(v => (
                  <tr key={v.id}>
                    <td className="num" style={styles.nowrap}>{formatDate(v.completedAt ?? v.createdAt)}</td>
                    <td>{v.technicianName ?? '—'}</td>
                    <td><span className="vd-badge">{v.status}</span></td>
                    <td className="num" style={styles.right}>{v.totalPrice != null ? `$${Number(v.totalPrice).toFixed(2)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>}

          <section className="vd-section">
            <h4 className="vd-sub">Edit log</h4>
            {editLog.length === 0 ? (
              <p className="vd-hint">No edits recorded.</p>
            ) : (
              <table className="vd-table">
                <tbody>
                  {editLog.map((entry, i) => (
                    <tr key={i}>
                      <td>
                        <div className="vd-data" style={styles.logMeta}>{formatDate(entry.changedAt)} · {entry.source}</div>
                        <div>{entry.summary}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          </div>
        </div>
      </div>
    </div>
  )
}

function formatDate (iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch (_) { return '—' }
}

function formatPrice (val) {
  if (val == null) return '—'
  return `$${Number(val).toFixed(2)}`
}

// Layout only; the look comes from dispatch.css (vd-*).
const styles = {
  page:        { flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: '16px 18px 18px', gap: '14px' },
  filters:     { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '16px' },
  filterInput: { width: 'auto', minWidth: '140px' },
  count:       { marginLeft: 'auto' },
  tableScroll: { overflowX: 'auto' },
  addr:        { fontWeight: 600 },
  nowrap:      { whiteSpace: 'nowrap' },
  right:       { textAlign: 'right', whiteSpace: 'nowrap' },
  acts:        { textAlign: 'right', whiteSpace: 'nowrap' },
  gap:         { marginLeft: '8px' },
  anomalyIcon: { marginLeft: '6px' },
  detailHeader: { display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', flexShrink: 0 },
  detailTitle:  { margin: 0, fontSize: '15px' },
  detailCol:    { minWidth: 0 },
  scroll:       { overflowX: 'auto' },
  model:        { fontSize: '14px', marginTop: '6px' },
  photos:       { display: 'flex', flexWrap: 'wrap', gap: '12px' },
  logMeta:      { fontSize: '11px', marginBottom: '2px' },
}
