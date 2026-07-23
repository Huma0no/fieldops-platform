/**
 * src/screens/History.jsx
 * F6 — Completed visit history with filters, full edit, and edit log.
 */

import { useState, useEffect } from 'react'
import { api } from '@shared/api.js'

export default function History () {
  const [visits, setVisits]       = useState([])
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState(null)   // full visit detail
  const [editLog, setEditLog]     = useState([])
  const [filters, setFilters]     = useState({ dateFrom: '', dateTo: '', technician: '', builder: '' })
  const [saving, setSaving]         = useState(false)
  const [editFields, setEditFields] = useState({})
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
      const merged = { ...detail, weighInData: report?.weighInData ?? [] }
      setSelected(merged)
      setEditFields(flattenVisit(merged))
      setEditLog(log ?? [])
      setPropertyHistory((propHist ?? []).filter(v => v.id !== visit.id))
    } catch (err) {
      console.error('visit load failed:', err)
    }
  }

  function flattenVisit (v) {
    return {
      address:        v.address?.street ?? '',
      orderNumber:    v.orderNumber ?? '',
      builder:        v.address?.builder ?? '',
      workType:       v.workType ?? '',
      notes:          v.notes ?? '',
      scheduledTime:  v.scheduledTime ?? '',
    }
  }

  async function saveEdit () {
    setSaving(true)
    try {
      await api.patch(`/visits/${selected.id}`, editFields)
      await openVisit(selected)   // reload with updated data + new log entry
    } catch (err) {
      console.error('save failed:', err)
    } finally {
      setSaving(false)
    }
  }

  if (selected) {
    return (
      <VisitDetail
        visit={selected}
        editFields={editFields}
        onFieldChange={(k, v) => setEditFields(f => ({ ...f, [k]: v }))}
        onSave={saveEdit}
        saving={saving}
        editLog={editLog}
        propertyHistory={propertyHistory}
        onBack={() => setSelected(null)}
      />
    )
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h2 style={styles.title}>History</h2>
        <div style={styles.filters}>
          <input
            style={styles.filterInput}
            placeholder="From date"
            type="date"
            value={filters.dateFrom}
            onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
          />
          <input
            style={styles.filterInput}
            placeholder="To date"
            type="date"
            value={filters.dateTo}
            onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))}
          />
          <input
            style={styles.filterInput}
            placeholder="Technician"
            value={filters.technician}
            onChange={e => setFilters(f => ({ ...f, technician: e.target.value }))}
          />
          <input
            style={styles.filterInput}
            placeholder="Builder"
            value={filters.builder}
            onChange={e => setFilters(f => ({ ...f, builder: e.target.value }))}
          />
          <button style={styles.filterBtn} onClick={loadHistory}>Search</button>
        </div>
      </div>

      <div style={styles.tableWrap}>
        {loading ? (
          <div style={styles.loading}>Loading…</div>
        ) : visits.length === 0 ? (
          <div style={styles.empty}>No visits found for the selected filters.</div>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                {['Address','Date','Technician','Service','Total','Status',''].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visits.map(v => (
                <tr key={v.id} style={styles.tr}>
                  <td style={styles.td}>{v.address?.street ?? '—'}</td>
                  <td style={styles.td}>{formatDate(v.completedAt)}</td>
                  <td style={styles.td}>{v.technicianId ?? '—'}</td>
                  <td style={styles.td}>{v.workType ?? '—'}</td>
                  <td style={styles.td}>
                    {formatPrice(v.totalPrice)}
                    {v.has_price_anomaly && <span style={styles.anomalyIcon} title="Price outside catalog range">⚠</span>}
                  </td>
                  <td style={styles.td}>
                    <span style={styles.statusBadge}>{v.status}</span>
                  </td>
                  <td style={styles.td}>
                    <button style={styles.openBtn} onClick={() => openVisit(v)}>Open</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
    <div style={{ borderBottom: '0.5px solid var(--border-subtle)' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0', fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}
      >
        <span>System {data.systemNumber}</span>
        <span style={{ fontSize: '10px' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ paddingBottom: '8px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
          {entries.map(([k, label]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '2px 0' }}>
              <span style={{ color: 'var(--text-muted)' }}>{label}</span>
              <span style={{ color: 'var(--text-secondary)' }}>{data[k]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function VisitDetail ({ visit, editFields, onFieldChange, onSave, saving, editLog, propertyHistory, onBack }) {
  const FIELDS = [
    { key: 'address',       label: 'Address' },
    { key: 'orderNumber',   label: 'Order #' },
    { key: 'builder',       label: 'Builder' },
    { key: 'workType',      label: 'Work type' },
    { key: 'scheduledTime', label: 'Scheduled time' },
    { key: 'notes',         label: 'Notes', multiline: true },
  ]

  return (
    <div style={styles.page}>
      <div style={styles.detailHeader}>
        <button style={styles.backBtn} onClick={onBack}>← History</button>
        <h2 style={styles.title}>{visit.address?.street ?? 'Visit'}</h2>
        {visit.has_price_anomaly && (
          <span style={styles.anomalyBanner}>⚠ Price outside catalog range</span>
        )}
      </div>

      <div style={styles.detailBody}>
        {/* Left — edit form + visit data */}
        <div style={styles.detailLeft}>
          <div style={styles.sectionTitle}>Edit visit</div>
          <div style={styles.fieldsCol}>
            {FIELDS.map(({ key, label, multiline }) => (
              <div key={key} style={styles.fieldRow}>
                <label style={styles.fieldLabel}>{label}</label>
                {multiline ? (
                  <textarea
                    style={styles.fieldTextarea}
                    value={editFields[key] ?? ''}
                    onChange={e => onFieldChange(key, e.target.value)}
                    rows={3}
                  />
                ) : (
                  <input
                    style={styles.fieldInput}
                    value={editFields[key] ?? ''}
                    onChange={e => onFieldChange(key, e.target.value)}
                  />
                )}
              </div>
            ))}
          </div>
          <button style={styles.saveBtn} onClick={onSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <p style={styles.catalogNote}>Changes to the catalog do not affect historical visits.</p>

          {/* Services (B3) */}
          {(visit.services ?? []).length > 0 && <>
            <div style={styles.sectionTitle}>Services</div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {visit.services.map((s, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--text-secondary)', padding: '5px 0', borderBottom: '0.5px solid var(--border-subtle)' }}>
                  <span>{s.serviceName}{s.isFinish ? ' · Finish' : ''}{s.isTemporarily ? ' · Temporarily' : ''}</span>
                  {s.price != null && <span>${Number(s.price).toFixed(2)}</span>}
                </div>
              ))}
            </div>
          </>}

          {/* Items (B3) */}
          {(visit.items ?? []).length > 0 && <>
            <div style={styles.sectionTitle}>Items</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <tbody>
                {visit.items.map((item, i) => (
                  <tr key={i} style={{ borderBottom: '0.5px solid var(--border-subtle)' }}>
                    <td style={{ padding: '4px 0', color: 'var(--text-secondary)' }}>{item.itemName}</td>
                    <td style={{ padding: '4px 0', color: 'var(--text-muted)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {item.quantity} × ${Number(item.price ?? 0).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>}

          {/* Weigh-in (B3) */}
          {(visit.weighInData ?? []).length > 0 && <>
            <div style={styles.sectionTitle}>Weigh-in</div>
            {visit.weighInData.map(w => <WeighInSection key={w.systemNumber} data={w} />)}
          </>}

          {/* Photos (B3) */}
          {(visit.photos ?? []).length > 0 && <>
            <div style={styles.sectionTitle}>Photos</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
              {visit.photos.map(p => (
                <span key={p.id} style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'var(--surface-3)', padding: '2px 8px', borderRadius: '99px', border: '0.5px solid var(--border-subtle)' }}>
                  {[p.tag, p.category].filter(Boolean).join(' · ')}
                </span>
              ))}
            </div>
          </>}
        </div>

        {/* Right — property history + edit log */}
        <div style={styles.detailRight}>
          {/* Property history (B2) */}
          {propertyHistory.length > 0 && <>
            <div style={styles.sectionTitle}>Property history</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
              {propertyHistory.map(v => (
                <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)', borderBottom: '0.5px solid var(--border-subtle)', paddingBottom: '6px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{formatDate(v.completedAt ?? v.createdAt)}</span>
                    <span>{v.technicianName ?? '—'}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ display: 'block', color: 'var(--text-secondary)' }}>{v.status}</span>
                    <span>{v.totalPrice != null ? `$${Number(v.totalPrice).toFixed(2)}` : '—'}</span>
                  </div>
                </div>
              ))}
            </div>
          </>}

          <div style={styles.sectionTitle}>Edit log</div>
          {editLog.length === 0 ? (
            <p style={styles.logEmpty}>No edits recorded.</p>
          ) : (
            <div style={styles.logList}>
              {editLog.map((entry, i) => (
                <div key={i} style={styles.logEntry}>
                  <p style={styles.logMeta}>{formatDate(entry.changedAt)} · {entry.source}</p>
                  <p style={styles.logSummary}>{entry.summary}</p>
                </div>
              ))}
            </div>
          )}
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

const styles = {
  page:     { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--surface-base)' },
  header:   { padding: '16px 24px', borderBottom: '0.5px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', flexShrink: 0, background: 'var(--surface-1)' },
  title:    { fontSize: '16px', fontWeight: 500, color: 'var(--text-primary)', flexShrink: 0 },
  filters:  { display: 'flex', gap: '8px', flexWrap: 'wrap', flex: 1 },
  filterInput: { background: 'var(--surface-2)', border: '0.5px solid var(--border-default)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', padding: '6px 10px', outline: 'none' },
  filterBtn:   { background: 'var(--color-signal)', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 500, padding: '6px 14px', cursor: 'pointer' },
  tableWrap:   { flex: 1, overflowY: 'auto', padding: '16px 24px' },
  loading:     { color: 'var(--text-muted)', fontSize: '14px', padding: '24px 0' },
  empty:       { color: 'var(--text-muted)', fontSize: '14px', padding: '24px 0' },
  table:       { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th:          { text: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 500, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '0.5px solid var(--border-subtle)' },
  tr:          { borderBottom: '0.5px solid var(--border-subtle)' },
  td:          { padding: '10px 12px', color: 'var(--text-secondary)', verticalAlign: 'middle' },
  anomalyIcon: { marginLeft: '6px', color: 'var(--color-plasma)', fontSize: '13px' },
  anomalyBanner: { fontSize: '12px', color: 'var(--color-plasma)', background: 'var(--plasma-tint)', padding: '4px 10px', borderRadius: '99px', border: '0.5px solid var(--plasma-border)' },
  statusBadge: { fontSize: '11px', color: 'var(--text-muted)', background: 'var(--surface-3)', padding: '2px 8px', borderRadius: '99px' },
  openBtn:     { background: 'none', border: '0.5px solid var(--border-default)', borderRadius: '6px', color: 'var(--text-muted)', fontSize: '12px', padding: '4px 10px', cursor: 'pointer' },

  detailHeader: { padding: '14px 24px', borderBottom: '0.5px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: '16px', flexShrink: 0, background: 'var(--surface-1)' },
  backBtn:      { background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '13px', cursor: 'pointer', padding: 0 },
  detailBody:   { flex: 1, display: 'flex', overflow: 'hidden' },
  detailLeft:   { flex: '0 0 50%', padding: '20px 24px', overflowY: 'auto', borderRight: '0.5px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '12px' },
  detailRight:  { flex: '0 0 50%', padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' },
  sectionTitle: { fontSize: '11px', color: 'var(--text-disabled)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500 },
  fieldsCol:    { display: 'flex', flexDirection: 'column', gap: '10px' },
  fieldRow:     { display: 'flex', flexDirection: 'column', gap: '3px' },
  fieldLabel:   { fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 },
  fieldInput:   { background: 'var(--surface-2)', border: '0.5px solid var(--border-default)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', padding: '6px 10px', outline: 'none', fontFamily: 'var(--font-sans)' },
  fieldTextarea:{ background: 'var(--surface-2)', border: '0.5px solid var(--border-default)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', padding: '6px 10px', outline: 'none', resize: 'vertical', fontFamily: 'var(--font-sans)', lineHeight: 1.5 },
  saveBtn:      { background: 'var(--color-signal)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 500, padding: '10px 20px', cursor: 'pointer', alignSelf: 'flex-start' },
  catalogNote:  { fontSize: '11px', color: 'var(--text-disabled)', fontStyle: 'italic' },
  logEmpty:     { fontSize: '13px', color: 'var(--text-disabled)' },
  logList:      { display: 'flex', flexDirection: 'column', gap: '12px' },
  logEntry:     { display: 'flex', flexDirection: 'column', gap: '2px' },
  logMeta:      { fontSize: '11px', color: 'var(--text-disabled)' },
  logSummary:   { fontSize: '13px', color: 'var(--text-secondary)' },
}
