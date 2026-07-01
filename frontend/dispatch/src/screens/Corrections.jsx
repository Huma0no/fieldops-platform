/**
 * src/screens/Corrections.jsx
 * F8 — Corrections queue for Dispatch. Approve or reject technician correction requests.
 */

import { useState, useEffect } from 'react'
import { api } from '@shared/api.js'

const STATUS_LABEL = {
  pending:  { text: 'Pending',  color: 'var(--color-plasma)',  bg: 'var(--plasma-tint)'  },
  approved: { text: 'Approved', color: '#22C55E',              bg: 'rgba(34,197,94,0.12)'},
  rejected: { text: 'Rejected', color: 'var(--color-heat)',    bg: 'var(--heat-tint)'    },
}

const FIELD_LABELS = {
  service:    'Service',
  thermostat: 'Thermostat',
  accessories:'Accessories',
  fixes:      'Fixes',
  weighin:    'Weigh-in data',
  notes:      'Notes',
  equipment:  'Equipment models',
}

export default function Corrections () {
  const [corrections, setCorrections] = useState([])
  const [loading, setLoading]         = useState(true)
  const [selected, setSelected]       = useState(null)

  useEffect(() => { loadCorrections() }, [])

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

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h2 style={styles.title}>Corrections</h2>
        <span style={styles.count}>
          {corrections.filter(c => c.status === 'pending').length} pending
        </span>
      </div>

      <div style={styles.tableWrap}>
        {loading ? (
          <p style={styles.muted}>Loading…</p>
        ) : corrections.length === 0 ? (
          <p style={styles.muted}>No correction requests.</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                {['Technician','Address','Date','Reason','Status',''].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {corrections.map(c => {
                const s = STATUS_LABEL[c.status] ?? STATUS_LABEL.pending
                return (
                  <tr key={c.id} style={styles.tr}>
                    <td style={styles.td}>{c.technician_name ?? '—'}</td>
                    <td style={styles.td}>{c.address ?? '—'}</td>
                    <td style={styles.td}>{formatDate(c.created_at)}</td>
                    <td style={{ ...styles.td, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.reason ?? '—'}
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
  const [approving, setApproving]   = useState(false)
  const [rejecting, setRejecting]   = useState(false)
  const [rejectNote, setRejectNote] = useState('')
  const [showReject, setShowReject] = useState(false)
  const [actionError, setActionError] = useState('')
  const [done, setDone]             = useState(false)

  const isPending = correction.status === 'pending'

  async function handleApprove () {
    setApproving(true)
    setActionError('')
    try {
      await api.patch(`/dispatch/corrections/${correction.id}/approve`)
      setDone('approved')
    } catch (err) {
      setActionError(err.message ?? 'Approve failed.')
    } finally {
      setApproving(false)
    }
  }

  async function handleReject () {
    setRejecting(true)
    setActionError('')
    try {
      await api.patch(`/dispatch/corrections/${correction.id}/reject`, {
        note: rejectNote.trim() || null,
      })
      setDone('rejected')
    } catch (err) {
      setActionError(err.message ?? 'Reject failed.')
    } finally {
      setRejecting(false)
    }
  }

  if (done) {
    return (
      <div style={styles.page}>
        <div style={styles.header}>
          <button style={styles.backBtn} onClick={onBack}>← Corrections</button>
        </div>
        <div style={styles.doneWrap}>
          <p style={{ fontSize: '32px' }}>{done === 'approved' ? '✓' : '✕'}</p>
          <p style={{ fontSize: '16px', fontWeight: 500, color: 'var(--text-primary)' }}>
            Correction {done}
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
        <h2 style={styles.title}>{correction.address ?? 'Correction request'}</h2>
      </div>

      <div style={styles.detailBody}>

        {/* Request info */}
        <div style={styles.section}>
          <p style={styles.sectionTitle}>Request</p>
          <div style={styles.infoGrid}>
            <InfoRow label="Technician" value={correction.technician_name} />
            <InfoRow label="Date"       value={formatDate(correction.created_at)} />
            <InfoRow label="Reason"     value={correction.reason} />
            <InfoRow
              label="Fields"
              value={(correction.fields ?? []).map(f => FIELD_LABELS[f] ?? f).join(', ')}
            />
          </div>
        </div>

        {/* Original visit snapshot */}
        {correction.visit_snapshot && (
          <div style={styles.section}>
            <p style={styles.sectionTitle}>Original visit data</p>
            <div style={styles.snapshot}>
              <pre style={styles.snapshotPre}>
                {JSON.stringify(correction.visit_snapshot, null, 2)}
              </pre>
            </div>
          </div>
        )}

        {/* Pay period impact */}
        {correction.affected_pay_period && (
          <div style={styles.impactBox}>
            <p style={styles.impactText}>
              ⚠ This correction will affect pay period {formatRange(correction.affected_pay_period.week_start, correction.affected_pay_period.week_end)} ({correction.affected_pay_period.status})
            </p>
          </div>
        )}

        {/* Actions */}
        {isPending && (
          <div style={styles.actionsWrap}>
            {actionError && <p style={styles.errorText}>{actionError}</p>}

            {showReject ? (
              <div style={styles.rejectWrap}>
                <label style={styles.rejectLabel}>Note to technician (optional)</label>
                <textarea
                  style={styles.rejectTextarea}
                  value={rejectNote}
                  onChange={e => setRejectNote(e.target.value)}
                  placeholder="Explain why the correction was rejected…"
                  rows={3}
                />
                <div style={styles.rejectActions}>
                  <button style={styles.cancelRejectBtn} onClick={() => setShowReject(false)}>
                    Cancel
                  </button>
                  <button style={styles.rejectBtn} onClick={handleReject} disabled={rejecting}>
                    {rejecting ? 'Rejecting…' : 'Confirm reject'}
                  </button>
                </div>
              </div>
            ) : (
              <div style={styles.mainActions}>
                <button
                  style={styles.rejectOpenBtn}
                  onClick={() => setShowReject(true)}
                  disabled={approving}
                >
                  Reject
                </button>
                <button
                  style={styles.approveBtn}
                  onClick={handleApprove}
                  disabled={approving}
                >
                  {approving ? 'Approving…' : 'Approve'}
                </button>
              </div>
            )}
          </div>
        )}

        {!isPending && (
          <div style={styles.resolvedNote}>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              This correction was <strong>{correction.status}</strong>.
              {correction.dispatcher_note && ` Note: ${correction.dispatcher_note}`}
            </p>
          </div>
        )}
      </div>
    </div>
  )
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
  try { return new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) }
  catch (_) { return '—' }
}

function formatRange (start, end) {
  if (!start || !end) return '—'
  const fmt = iso => new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric' })
  return `${fmt(start)} – ${fmt(end)}`
}

const styles = {
  page:       { flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:'var(--surface-base)' },
  header:     { padding:'16px 24px', borderBottom:'0.5px solid var(--border-subtle)', background:'var(--surface-1)', display:'flex', alignItems:'center', gap:'12px', flexShrink:0 },
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
  sectionTitle:{ fontSize:'11px', color:'var(--text-disabled)', textTransform:'uppercase', letterSpacing:'0.05em', fontWeight:500 },
  infoGrid:    { background:'var(--surface-1)', borderRadius:'8px', padding:'8px 12px', border:'0.5px solid var(--border-subtle)' },
  snapshot:    { background:'var(--surface-1)', borderRadius:'8px', border:'0.5px solid var(--border-subtle)', overflow:'hidden', maxHeight:'200px', overflowY:'auto' },
  snapshotPre: { fontSize:'11px', color:'var(--text-muted)', padding:'12px', margin:0, fontFamily:'var(--font-mono)', lineHeight:1.5 },
  impactBox:   { background:'var(--plasma-tint)', border:'0.5px solid var(--plasma-border)', borderRadius:'8px', padding:'12px 14px' },
  impactText:  { fontSize:'13px', color:'var(--color-plasma)' },
  actionsWrap: { display:'flex', flexDirection:'column', gap:'12px' },
  mainActions: { display:'flex', gap:'8px' },
  rejectOpenBtn:{ flex:'0 0 auto', background:'var(--surface-3)', color:'var(--text-secondary)', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:500, padding:'10px 20px', cursor:'pointer' },
  approveBtn:  { flex:1, background:'var(--color-signal)', color:'#fff', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:500, padding:'10px', cursor:'pointer' },
  rejectWrap:  { display:'flex', flexDirection:'column', gap:'10px', background:'var(--heat-tint)', border:'0.5px solid var(--heat-border)', borderRadius:'8px', padding:'14px' },
  rejectLabel: { fontSize:'12px', color:'var(--text-muted)', fontWeight:500 },
  rejectTextarea:{ background:'var(--surface-2)', border:'0.5px solid var(--border-default)', borderRadius:'6px', color:'var(--text-primary)', fontSize:'13px', padding:'8px 10px', outline:'none', resize:'vertical', fontFamily:'var(--font-sans)', lineHeight:1.5 },
  rejectActions:{ display:'flex', gap:'8px', justifyContent:'flex-end' },
  cancelRejectBtn:{ background:'none', border:'0.5px solid var(--border-default)', borderRadius:'6px', color:'var(--text-muted)', fontSize:'13px', padding:'8px 14px', cursor:'pointer' },
  rejectBtn:   { background:'var(--color-heat)', color:'#fff', border:'none', borderRadius:'6px', fontSize:'13px', fontWeight:500, padding:'8px 16px', cursor:'pointer' },
  resolvedNote:{ background:'var(--surface-1)', borderRadius:'8px', padding:'12px 14px', border:'0.5px solid var(--border-subtle)' },
  errorText:   { fontSize:'12px', color:'var(--color-heat)' },
  doneWrap:    { flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:'12px' },
}
