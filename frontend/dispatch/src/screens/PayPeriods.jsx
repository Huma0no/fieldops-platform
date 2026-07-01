/**
 * src/screens/PayPeriods.jsx
 * F7 — Pay period management for Dispatch.
 *
 * List view → Period detail (lines per technician + anomalies) → Close / Mark paid
 */

import { useState, useEffect } from 'react'
import { api } from '@shared/api.js'

export default function PayPeriods () {
  const [periods, setPeriods]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [selected, setSelected] = useState(null)

  useEffect(() => { loadPeriods() }, [])

  async function loadPeriods () {
    setLoading(true)
    try {
      const data = await api.get('/dispatch/pay-periods')
      setPeriods(data ?? [])
    } catch (err) {
      console.error('pay periods load failed:', err)
    } finally {
      setLoading(false)
    }
  }

  async function openPeriod (period) {
    try {
      const [detail, anomalies] = await Promise.all([
        api.get(`/dispatch/pay-periods/${period.id}`),
        api.get(`/dispatch/pay-periods/${period.id}/anomalies`),
      ])
      setSelected({ ...detail, anomalies: anomalies ?? [] })
    } catch (err) {
      console.error('period load failed:', err)
    }
  }

  if (selected) {
    return (
      <PeriodDetail
        period={selected}
        onBack={() => { setSelected(null); loadPeriods() }}
        onUpdated={openPeriod}
      />
    )
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h2 style={styles.title}>Pay Periods</h2>
      </div>

      <div style={styles.tableWrap}>
        {loading ? (
          <p style={styles.muted}>Loading…</p>
        ) : periods.length === 0 ? (
          <p style={styles.muted}>No pay periods found.</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                {['Period','Status','Total gross',''].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periods.map(p => (
                <tr key={p.id} style={styles.tr}>
                  <td style={styles.td}>{formatRange(p.week_start, p.week_end)}</td>
                  <td style={styles.td}>
                    <StatusBadge status={p.status} />
                  </td>
                  <td style={styles.td}>{formatPrice(p.total_gross)}</td>
                  <td style={styles.td}>
                    <button style={styles.openBtn} onClick={() => openPeriod(p)}>
                      Open
                    </button>
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

// ── Period detail ──────────────────────────────────────────

function PeriodDetail ({ period, onBack, onUpdated }) {
  const [closing, setClosing]   = useState(false)
  const [paying, setPaying]     = useState(false)
  const [ackAnomalies, setAck]  = useState(false)
  const [actionError, setActionError] = useState('')

  const hasAnomalies   = period.anomalies?.length > 0
  const canClose       = period.status === 'open' && (!hasAnomalies || ackAnomalies)
  const canMarkPaid    = period.status === 'closed'

  async function handleClose () {
    setClosing(true)
    setActionError('')
    try {
      await api.post('/dispatch/pay-periods/close', { periodId: period.id })
      onUpdated(period)
    } catch (err) {
      setActionError(err.message ?? 'Close failed.')
      console.error('close failed:', err)
    } finally {
      setClosing(false)
    }
  }

  async function handleMarkPaid () {
    setPaying(true)
    setActionError('')
    try {
      await api.patch(`/dispatch/pay-periods/${period.id}/mark-paid`)
      onUpdated(period)
    } catch (err) {
      setActionError(err.message ?? 'Mark paid failed.')
      console.error('mark paid failed:', err)
    } finally {
      setPaying(false)
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={onBack}>← Pay Periods</button>
        <h2 style={styles.title}>{formatRange(period.week_start, period.week_end)}</h2>
        <StatusBadge status={period.status} />
      </div>

      <div style={styles.detailBody}>

        {/* Anomalies — collapsible warning */}
        {hasAnomalies && (
          <div style={styles.anomalyBox}>
            <p style={styles.anomalyTitle}>⚠ Price anomalies detected</p>
            <div style={styles.anomalyList}>
              {period.anomalies.map((a, i) => (
                <p key={i} style={styles.anomalyItem}>
                  {a.address} — {a.item_name}: ${a.actual_price} (catalog: ${a.catalog_price})
                </p>
              ))}
            </div>
            <label style={styles.ackLabel}>
              <input
                type="checkbox"
                checked={ackAnomalies}
                onChange={e => setAck(e.target.checked)}
                style={{ marginRight: '8px' }}
              />
              I've reviewed these anomalies and want to proceed
            </label>
          </div>
        )}

        {/* Lines table */}
        <div style={styles.linesWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                {['Technician','Gross','Commission','Net'].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(period.lines ?? []).map(line => (
                <tr key={line.technician_id} style={styles.tr}>
                  <td style={styles.td}>{line.technician_name}</td>
                  <td style={styles.td}>{formatPrice(line.gross)}</td>
                  <td style={styles.td}>
                    {line.commission_rate === 0 ? '—' : `${(line.commission_rate * 100).toFixed(0)}%`}
                  </td>
                  <td style={{ ...styles.td, fontWeight: 500, color: 'var(--text-primary)' }}>
                    {formatPrice(line.net)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Actions */}
        <div style={styles.actions}>
          {actionError && <p style={styles.errorText}>{actionError}</p>}

          {period.status === 'open' && (
            <button
              style={{ ...styles.actionBtn, opacity: canClose ? 1 : 0.5 }}
              onClick={handleClose}
              disabled={!canClose || closing}
            >
              {closing ? 'Closing…' : 'Close period'}
            </button>
          )}

          {canMarkPaid && (
            <button
              style={{ ...styles.actionBtn, background: '#22C55E' }}
              onClick={handleMarkPaid}
              disabled={paying}
            >
              {paying ? 'Marking…' : 'Mark as paid'}
            </button>
          )}

          {period.status === 'paid' && (
            <p style={styles.paidLabel}>✓ Paid</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────

function StatusBadge ({ status }) {
  const map = {
    open:   { color: 'var(--color-signal)',  bg: 'var(--signal-tint)'  },
    closed: { color: 'var(--color-plasma)',  bg: 'var(--plasma-tint)'  },
    paid:   { color: '#22C55E',              bg: 'rgba(34,197,94,0.12)'},
  }
  const s = map[status] ?? { color: 'var(--text-muted)', bg: 'var(--surface-3)' }
  return (
    <span style={{ fontSize: '11px', fontWeight: 500, color: s.color, background: s.bg, padding: '2px 10px', borderRadius: '99px', textTransform: 'capitalize' }}>
      {status}
    </span>
  )
}

function formatRange (start, end) {
  if (!start || !end) return '—'
  const fmt = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${fmt(start)} – ${fmt(end)}`
}

function formatPrice (val) {
  if (val == null) return '—'
  return `$${Number(val).toFixed(2)}`
}

const styles = {
  page:       { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--surface-base)' },
  header:     { padding: '16px 24px', borderBottom: '0.5px solid var(--border-subtle)', background: 'var(--surface-1)', display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0, flexWrap: 'wrap' },
  title:      { fontSize: '16px', fontWeight: 500, color: 'var(--text-primary)' },
  backBtn:    { background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '13px', cursor: 'pointer', padding: 0, flexShrink: 0 },
  tableWrap:  { flex: 1, overflowY: 'auto', padding: '16px 24px' },
  table:      { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th:         { textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 500, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '0.5px solid var(--border-subtle)' },
  tr:         { borderBottom: '0.5px solid var(--border-subtle)' },
  td:         { padding: '10px 12px', color: 'var(--text-secondary)' },
  openBtn:    { background: 'none', border: '0.5px solid var(--border-default)', borderRadius: '6px', color: 'var(--text-muted)', fontSize: '12px', padding: '4px 10px', cursor: 'pointer' },
  muted:      { color: 'var(--text-muted)', fontSize: '14px' },

  detailBody: { flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '20px' },
  linesWrap:  { background: 'var(--surface-1)', borderRadius: '8px', border: '0.5px solid var(--border-subtle)', overflow: 'hidden' },

  anomalyBox:   { background: 'var(--plasma-tint)', border: '0.5px solid var(--plasma-border)', borderRadius: '8px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' },
  anomalyTitle: { fontSize: '13px', fontWeight: 500, color: 'var(--color-plasma)' },
  anomalyList:  { display: 'flex', flexDirection: 'column', gap: '4px' },
  anomalyItem:  { fontSize: '12px', color: 'var(--text-secondary)' },
  ackLabel:     { fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', cursor: 'pointer' },

  actions:    { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' },
  actionBtn:  { background: 'var(--color-signal)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 500, padding: '10px 24px', cursor: 'pointer' },
  errorText:  { fontSize: '12px', color: 'var(--color-heat)' },
  paidLabel:  { fontSize: '13px', color: '#22C55E', fontWeight: 500 },
}
