/**
 * src/screens/PayPeriods.jsx
 * F7 — Pay period management for Dispatch.
 *
 * List view → Period detail (lines per technician + anomalies) → Close / Mark paid
 */

import { useState, useEffect, Fragment } from 'react'
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
                  <td style={styles.td}>{formatRange(p.weekStart, p.weekEnd)}</td>
                  <td style={styles.td}>
                    <StatusBadge status={p.status} />
                  </td>
                  <td style={styles.td}>{formatPrice(p.totalGross)}</td>
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
  const [closing, setClosing]         = useState(false)
  const [paying, setPaying]           = useState(false)
  const [ackAnomalies, setAck]        = useState(false)
  const [actionError, setActionError] = useState('')

  // Adjustment forms: { [techId]: { open, amount, note, saving, error } }
  const [adjForms, setAdjForms] = useState({})

  // Ghost deduction
  const [ghostInput,  setGhostInput]  = useState(period.ghostDeduction != null ? String(period.ghostDeduction) : '')
  const [savingGhost, setSavingGhost] = useState(false)
  const [ghostError,  setGhostError]  = useState('')
  useEffect(() => {
    setGhostInput(period.ghostDeduction != null ? String(period.ghostDeduction) : '')
  }, [period.ghostDeduction])

  const isOpen       = period.status === 'open'
  const hasAnomalies = period.anomalies?.length > 0
  const canClose     = isOpen && (!hasAnomalies || ackAnomalies)
  const canMarkPaid  = period.status === 'closed'

  async function handleClose () {
    setClosing(true); setActionError('')
    try {
      await api.post('/dispatch/pay-periods/close', { periodId: period.id })
      onUpdated(period)
    } catch (err) {
      setActionError(err.message ?? 'Close failed.')
    } finally { setClosing(false) }
  }

  async function handleMarkPaid () {
    setPaying(true); setActionError('')
    try {
      await api.patch(`/dispatch/pay-periods/${period.id}/mark-paid`)
      onUpdated(period)
    } catch (err) {
      setActionError(err.message ?? 'Mark paid failed.')
    } finally { setPaying(false) }
  }

  function openAdjForm (techId) {
    setAdjForms(prev => ({ ...prev, [techId]: { open: true, amount: '', note: '', saving: false, error: '' } }))
  }

  function closeAdjForm (techId) {
    setAdjForms(prev => { const s = { ...prev }; delete s[techId]; return s })
  }

  async function saveAdjustment (techId) {
    const form = adjForms[techId]
    if (!form?.amount) return
    setAdjForms(prev => ({ ...prev, [techId]: { ...prev[techId], saving: true, error: '' } }))
    try {
      await api.post(`/dispatch/pay-periods/${period.id}/adjustments`, {
        technicianId: techId,
        amount: Number(form.amount),
        note: form.note || null,
      })
      closeAdjForm(techId)
      onUpdated(period)
    } catch (err) {
      setAdjForms(prev => ({ ...prev, [techId]: { ...prev[techId], saving: false, error: err.message ?? 'Save failed' } }))
    }
  }

  async function saveGhostDeduction () {
    setSavingGhost(true); setGhostError('')
    try {
      await api.post(`/dispatch/pay-periods/${period.id}/ghost-deduction`, { amount: Number(ghostInput) })
      onUpdated(period)
    } catch (err) {
      setGhostError(err.message ?? 'Save failed')
    } finally { setSavingGhost(false) }
  }

  const colSpan = isOpen ? 5 : 4

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={onBack}>← Pay Periods</button>
        <h2 style={styles.title}>{formatRange(period.weekStart, period.weekEnd)}</h2>
        <StatusBadge status={period.status} />
      </div>

      <div style={styles.detailBody}>

        {/* Anomalies */}
        {hasAnomalies && (
          <div style={styles.anomalyBox}>
            <p style={styles.anomalyTitle}>⚠ Price anomalies detected</p>
            <div style={styles.anomalyList}>
              {period.anomalies.map((a, i) => (
                <p key={i} style={styles.anomalyItem}>
                  {a.address} — {a.item_name}: ${a.price} (catalog: ${a.expectedRange})
                </p>
              ))}
            </div>
            <label style={styles.ackLabel}>
              <input type="checkbox" checked={ackAnomalies} onChange={e => setAck(e.target.checked)} style={{ marginRight: '8px' }} />
              I've reviewed these anomalies and want to proceed
            </label>
          </div>
        )}

        {/* Lines table */}
        <div style={styles.linesWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Technician</th>
                <th style={styles.th}>Gross</th>
                <th style={styles.th}>Commission</th>
                <th style={styles.th}>Net</th>
                {isOpen && <th style={styles.th} />}
              </tr>
            </thead>
            <tbody>
              {(period.lines ?? []).map(line => {
                const form = adjForms[line.technicianId]
                return (
                  <Fragment key={line.technicianId}>
                    <tr style={styles.tr}>
                      <td style={styles.td}>{line.technicianName}</td>
                      <td style={styles.td}>{formatPrice(line.grossAmount)}</td>
                      <td style={styles.td}>{formatPrice(line.commissionRetained)}</td>
                      <td style={{ ...styles.td, fontWeight: 500, color: 'var(--text-primary)' }}>
                        {formatPrice(line.netAmount)}
                      </td>
                      {isOpen && (
                        <td style={styles.td}>
                          <button style={styles.adjBtn} onClick={() => openAdjForm(line.technicianId)}>
                            + Adjust
                          </button>
                        </td>
                      )}
                    </tr>

                    {/* Inline adjustment form */}
                    {isOpen && form?.open && (
                      <tr style={{ borderBottom: '0.5px solid var(--border-subtle)' }}>
                        <td colSpan={colSpan} style={{ padding: '8px 12px 12px', background: 'var(--surface-2)' }}>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                            <div>
                              <div style={styles.adjLabel}>Amount (negative = deduction)</div>
                              <input
                                type="number"
                                step="0.01"
                                style={styles.adjInput}
                                placeholder="e.g. -50 or 100"
                                value={form.amount}
                                onChange={e => setAdjForms(prev => ({ ...prev, [line.technicianId]: { ...prev[line.technicianId], amount: e.target.value } }))}
                              />
                            </div>
                            <div style={{ flex: 1, minWidth: '160px' }}>
                              <div style={styles.adjLabel}>Note</div>
                              <input
                                type="text"
                                style={{ ...styles.adjInput, width: '100%' }}
                                placeholder="Reason"
                                value={form.note}
                                onChange={e => setAdjForms(prev => ({ ...prev, [line.technicianId]: { ...prev[line.technicianId], note: e.target.value } }))}
                              />
                            </div>
                            <button style={styles.adjSaveBtn} onClick={() => saveAdjustment(line.technicianId)} disabled={form.saving || !form.amount}>
                              {form.saving ? 'Saving…' : 'Save'}
                            </button>
                            <button style={styles.adjCancelBtn} onClick={() => closeAdjForm(line.technicianId)}>
                              Cancel
                            </button>
                          </div>
                          {form.error && <p style={styles.errorText}>{form.error}</p>}
                        </td>
                      </tr>
                    )}

                    {/* Existing adjustments sub-rows */}
                    {(line.adjustments ?? []).map(adj => (
                      <tr key={adj.id} style={{ borderBottom: '0.5px solid var(--border-subtle)', background: 'var(--surface-2)' }}>
                        <td colSpan={colSpan} style={{ padding: '5px 12px 5px 32px', fontSize: '12px', color: 'var(--text-muted)', display: 'flex', gap: '12px' }}>
                          <span style={{ color: adj.amount >= 0 ? '#22C55E' : 'var(--color-heat)', fontWeight: 500 }}>
                            {adj.amount >= 0 ? '+' : ''}{formatPrice(adj.amount)}
                          </span>
                          {adj.note && <span>{adj.note}</span>}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Ghost deduction — closed periods only */}
        {(period.status === 'closed' || period.status === 'paid') && (
          <div style={styles.ghostBox}>
            <p style={styles.ghostTitle}>Ghost Deduction</p>
            <div style={styles.ghostRow}>
              <span style={styles.ghostLabel}>Total Generated</span>
              <span style={styles.ghostValue}>{formatPrice(period.totalGenerated)}</span>
            </div>
            <div style={styles.ghostRow}>
              <span style={styles.ghostLabel}>Ghost Deduction</span>
              {period.status === 'closed' ? (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="number"
                    step="0.01"
                    style={styles.adjInput}
                    placeholder="0.00"
                    value={ghostInput}
                    onChange={e => setGhostInput(e.target.value)}
                  />
                  <button style={styles.adjSaveBtn} onClick={saveGhostDeduction} disabled={savingGhost || ghostInput === ''}>
                    {savingGhost ? 'Saving…' : 'Save'}
                  </button>
                </div>
              ) : (
                <span style={styles.ghostValue}>{formatPrice(period.ghostDeduction)}</span>
              )}
            </div>
            <div style={styles.ghostRow}>
              <span style={styles.ghostLabel}>Difference</span>
              <span style={{ ...styles.ghostValue, fontWeight: 600 }}>
                {period.totalGenerated != null && period.ghostDeduction != null
                  ? formatPrice(period.totalGenerated - period.ghostDeduction)
                  : '—'}
              </span>
            </div>
            {ghostError && <p style={styles.errorText}>{ghostError}</p>}
          </div>
        )}

        {/* Actions */}
        <div style={styles.actions}>
          {actionError && <p style={styles.errorText}>{actionError}</p>}

          {isOpen && (
            <button
              style={{ ...styles.actionBtn, opacity: canClose ? 1 : 0.5 }}
              onClick={handleClose}
              disabled={!canClose || closing}
            >
              {closing ? 'Closing…' : 'Close period'}
            </button>
          )}

          {canMarkPaid && (
            <button style={{ ...styles.actionBtn, background: '#22C55E' }} onClick={handleMarkPaid} disabled={paying}>
              {paying ? 'Marking…' : 'Mark as paid'}
            </button>
          )}

          {period.status === 'paid' && <p style={styles.paidLabel}>✓ Paid</p>}
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
  errorText:  { fontSize: '12px', color: 'var(--color-heat)', marginTop: '4px' },
  paidLabel:  { fontSize: '13px', color: '#22C55E', fontWeight: 500 },

  adjBtn:       { background: 'none', border: '0.5px solid var(--border-default)', borderRadius: '6px', color: 'var(--text-muted)', fontSize: '11px', padding: '3px 8px', cursor: 'pointer', whiteSpace: 'nowrap' },
  adjLabel:     { fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' },
  adjInput:     { background: 'var(--surface-1)', border: '0.5px solid var(--border-default)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', padding: '5px 8px', outline: 'none', width: '120px' },
  adjSaveBtn:   { background: 'var(--color-signal)', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 500, padding: '6px 12px', cursor: 'pointer', whiteSpace: 'nowrap' },
  adjCancelBtn: { background: 'none', border: '0.5px solid var(--border-default)', borderRadius: '6px', color: 'var(--text-muted)', fontSize: '12px', padding: '6px 12px', cursor: 'pointer', whiteSpace: 'nowrap' },

  ghostBox:   { background: 'var(--surface-1)', border: '0.5px solid var(--border-subtle)', borderRadius: '8px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' },
  ghostTitle: { fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' },
  ghostRow:   { display: 'flex', alignItems: 'center', gap: '16px', justifyContent: 'space-between' },
  ghostLabel: { fontSize: '13px', color: 'var(--text-muted)' },
  ghostValue: { fontSize: '13px', color: 'var(--text-secondary)' },
}
