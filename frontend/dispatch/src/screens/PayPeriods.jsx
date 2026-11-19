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
      <div className="vd-unit">
        <div className="vd-unit-head"><span className="vd-unit-id">LDG</span><span className="vd-unit-name">Ledger</span><span className="vd-unit-note">Pay periods · Mon to Sun</span></div>
        <div className="vd-knurl" />
        <div className="vd-unit-body">
          {loading ? (
            <p className="vd-hint" style={styles.flush}>Loading…</p>
          ) : periods.length === 0 ? (
            <p className="vd-hint" style={styles.flush}>No pay periods found.</p>
          ) : (
            <div style={styles.scrollX}>
              <table className="vd-table">
                <thead>
                  <tr>
                    <th>Period</th><th>Status</th><th style={styles.right}>Total gross</th><th />
                  </tr>
                </thead>
                <tbody>
                  {periods.map(p => (
                    <tr key={p.id}>
                      <td className="num" style={styles.nowrap}>{formatRange(p.weekStart, p.weekEnd)}</td>
                      <td><StatusBadge status={p.status} /></td>
                      <td className="num" style={styles.right}>{formatPrice(p.totalGross)}</td>
                      <td style={styles.right}>
                        <button type="button" className="vd-key sm" onClick={() => openPeriod(p)}>Open</button>
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

// ── Period detail ──────────────────────────────────────────

function PeriodDetail ({ period, onBack, onUpdated }) {
  const [closing, setClosing]         = useState(false)
  const [paying, setPaying]           = useState(false)
  const [ackAnomalies, setAck]        = useState(false)
  const [actionError, setActionError] = useState('')

  // Adjustment forms: { [techId]: { open, amount, note, saving, error } }
  const [adjForms, setAdjForms] = useState({})

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

  const colSpan = isOpen ? 5 : 4
  const steps = ['open', 'closed', 'paid']
  const at = steps.indexOf(period.status)
  const stepClass = i => (i < at ? 'done' : i === at ? 'now' : 'next')
  const stepDate = [formatRange(period.weekStart, period.weekEnd), null, period.paidAt ? formatDay(period.paidAt) : null]
  const stepWhat = ['Work lands as it is reported.', 'Closes itself Wednesday. Totals locked.', 'Check received, marked paid.']

  return (
    <div style={styles.page}>
      <div className="vd-unit">
        <div className="vd-unit-head">
          <span className="vd-unit-id">CYC</span>
          <span className="vd-unit-name">Period {formatRange(period.weekStart, period.weekEnd)}</span>
          <span className="vd-unit-note">Mon to Sun · worked and reported</span>
        </div>
        <div className="vd-knurl" />
        <div className="vd-unit-body">
          <button type="button" className="vd-key sm" style={styles.back} onClick={onBack}>← Ledger</button>
          <div className="vd-rail" aria-label={`Status: ${period.status}`}>
            {steps.map((step, i) => (
              <Fragment key={step}>
                {i > 0 && <div className="op arrow">→</div>}
                <div className={`vd-step ${stepClass(i)}`}>
                  <div className="sn">{step}<span className="tick">{i < at ? '✓' : i === at ? 'NOW' : '—'}</span></div>
                  <div className="sdate">{stepDate[i] ?? '—'}</div>
                  <div className="swhat">{stepWhat[i]}</div>
                </div>
              </Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* Anomalies */}
      {hasAnomalies && (
        <div className="vd-alert" style={styles.column}>
          <span className="vd-stencil">Price anomalies detected</span>
          {period.anomalies.map((a, i) => (
            <p key={i} style={styles.flush}>
              {a.address} — {a.item_name}: <span className="vd-data">${a.price}</span> (catalog: <span className="vd-data">${a.expectedRange}</span>)
            </p>
          ))}
          <label style={styles.ackLabel}>
            <input type="checkbox" checked={ackAnomalies} onChange={e => setAck(e.target.checked)} />
            I've reviewed these anomalies and want to proceed
          </label>
        </div>
      )}

      {/* Lines table */}
      <div className="vd-unit">
        <div className="vd-unit-head"><span className="vd-unit-id">OUT</span><span className="vd-unit-name">Technician compensation</span></div>
        <div className="vd-unit-body" style={styles.scrollX}>
          <table className="vd-table">
            <thead>
              <tr>
                <th>Technician</th>
                <th style={styles.right}>Gross</th>
                <th style={styles.right}>Commission</th>
                <th style={styles.right}>Net</th>
                {isOpen && <th />}
              </tr>
            </thead>
            <tbody>
              {(period.lines ?? []).map(line => {
                const form = adjForms[line.technicianId]
                return (
                  <Fragment key={line.technicianId}>
                    <tr>
                      <td>{line.technicianName}</td>
                      <td className="num" style={styles.right}>{formatPrice(line.grossAmount)}</td>
                      <td className="num" style={styles.right}>{formatPrice(line.commissionRetained)}</td>
                      <td className="num" style={styles.net}>{formatPrice(line.netAmount)}</td>
                      {isOpen && (
                        <td style={styles.right}>
                          <button type="button" className="vd-key sm" onClick={() => openAdjForm(line.technicianId)}>
                            + Adjust
                          </button>
                        </td>
                      )}
                    </tr>

                    {/* Inline adjustment form */}
                    {isOpen && form?.open && (
                      <tr>
                        <td colSpan={colSpan} style={styles.subCell}>
                          <div style={styles.adjRow}>
                            <label style={styles.amountField}>
                              <span className="vd-label">Amount (negative = deduction)</span>
                              <input
                                type="number"
                                step="0.01"
                                className="vd-input sm data"
                                placeholder="e.g. -50 or 100"
                                value={form.amount}
                                onChange={e => setAdjForms(prev => ({ ...prev, [line.technicianId]: { ...prev[line.technicianId], amount: e.target.value } }))}
                              />
                            </label>
                            <label style={styles.noteField}>
                              <span className="vd-label">Note</span>
                              <input
                                type="text"
                                className="vd-input sm"
                                placeholder="Reason"
                                value={form.note}
                                onChange={e => setAdjForms(prev => ({ ...prev, [line.technicianId]: { ...prev[line.technicianId], note: e.target.value } }))}
                              />
                            </label>
                            <button type="button" className="vd-key dark" onClick={() => saveAdjustment(line.technicianId)} disabled={form.saving || !form.amount}>
                              {form.saving ? 'Saving…' : 'Save'}
                            </button>
                            <button type="button" className="vd-key" onClick={() => closeAdjForm(line.technicianId)}>
                              Cancel
                            </button>
                          </div>
                          {form.error && <p className="vd-error" style={styles.errorGap}>{form.error}</p>}
                        </td>
                      </tr>
                    )}

                    {/* Existing adjustments sub-rows */}
                    {(line.adjustments ?? []).map(adj => (
                      <tr key={adj.id}>
                        <td colSpan={colSpan} style={styles.adjCell}>
                          <span className="vd-data" style={styles.adjAmount}>
                            {adj.amount >= 0 ? '+' : ''}{formatPrice(adj.amount)}
                          </span>
                          {adj.note && <span className="vd-hint">{adj.note}</span>}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Actions */}
      <div className="vd-unit">
        <div className="vd-unit-body" style={styles.actions}>
          {actionError && <p className="vd-error" style={styles.actionError}>{actionError}</p>}

          {isOpen && (
            <button type="button" className="vd-key dark" onClick={handleClose} disabled={!canClose || closing}>
              {closing ? 'Closing…' : 'Close period'}
            </button>
          )}

          {canMarkPaid && (
            <button type="button" className="vd-key dark" onClick={handleMarkPaid} disabled={paying}>
              {paying ? 'Marking…' : 'Mark as paid'}
            </button>
          )}

          {period.status === 'paid' && <span className="vd-badge solid">✓ Paid</span>}
        </div>
      </div>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────

function StatusBadge ({ status }) {
  const variant = { closed: ' hatch', paid: ' solid' }[status] ?? ''
  return <span className={`vd-badge${variant}`}>{status}</span>
}

function formatRange (start, end) {
  if (!start || !end) return '—'
  const fmt = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${fmt(start)} – ${fmt(end)}`
}

function formatDay (iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatPrice (val) {
  if (val == null) return '—'
  return `$${Number(val).toFixed(2)}`
}

// Layout only; the look comes from dispatch.css (vd-*).
const styles = {
  page:        { flex: 1, overflowY: 'auto', padding: '16px 18px 18px', display: 'flex', flexDirection: 'column', gap: '18px' },
  flush:       { margin: 0 },
  scrollX:     { overflowX: 'auto' },
  right:       { textAlign: 'right' },
  nowrap:      { whiteSpace: 'nowrap' },
  net:         { textAlign: 'right', fontSize: '14px' },
  back:        { marginBottom: '16px' },
  column:      { flexDirection: 'column', gap: '8px' },
  ackLabel:    { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px' },
  subCell:     { background: 'var(--vd-panel)' },
  adjRow:      { display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' },
  amountField: { display: 'flex', flexDirection: 'column', width: '190px' },
  noteField:   { display: 'flex', flexDirection: 'column', flex: 1, minWidth: '160px' },
  adjCell:     { padding: '5px 8px 5px 28px', background: 'var(--vd-panel)' },
  adjAmount:   { marginRight: '12px' },
  errorGap:    { marginTop: '8px' },
  actions:     { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' },
  actionError: { width: '100%' },
}
