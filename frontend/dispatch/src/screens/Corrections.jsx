/**
 * src/screens/Corrections.jsx
 * F8 — Corrections queue for Dispatch. One-way message from technician to dispatcher;
 * Apply just marks the correction resolved — it does not edit the visit itself.
 */

import { useState, useEffect } from 'react'
import { api } from '@shared/api.js'

const STATUS_LABEL = {
  open:    { text: 'Open',    color: 'var(--color-plasma)', bg: 'var(--plasma-tint)'   },
  applied: { text: 'Applied', color: '#22C55E',              bg: 'rgba(34,197,94,0.12)' },
  expired: { text: 'Expired', color: 'var(--text-disabled)', bg: 'var(--surface-3)'     },
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

  const openCount = corrections.filter(c => c.status === 'open').length

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h2 style={styles.title}>Corrections</h2>
        <div style={{ display: 'flex', gap: '6px' }}>
          {openCount > 0 && (
            <span style={styles.count}>{openCount} open</span>
          )}
        </div>
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

  const isOpen = correction.status === 'open'

  async function handleApply () {
    setApplying(true); setActionError('')
    try {
      await api.patch(`/dispatch/corrections/${correction.id}/apply`)
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
            This only marks the correction resolved. If a visit edit is needed, make it separately from the visit's own edit screen.
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
            <InfoRow label="Technician" value={correction.requestedBy?.name} />
            <InfoRow label="Date"       value={formatDate(correction.requestedAt)} />
          </div>
        </div>

        {/* Message */}
        <div style={styles.section}>
          <p style={styles.sectionTitle}>Message</p>
          <div style={styles.messageBox}>
            <p style={styles.messageText}>{correction.message}</p>
          </div>
        </div>

        {/* Original visit snapshot */}
        {correction.visitSnapshot && (
          <div style={styles.section}>
            <p style={styles.sectionTitle}>Current visit data</p>
            <div style={styles.snapshot}>
              <pre style={styles.snapshotPre}>
                {JSON.stringify(correction.visitSnapshot, null, 2)}
              </pre>
            </div>
          </div>
        )}

        {/* Actions */}
        {isOpen && (
          <div style={styles.actionsWrap}>
            {actionError && <p style={styles.errorText}>{actionError}</p>}
            <p style={styles.hintText}>
              Applying marks this correction resolved. It does not edit the visit — make that change separately via the visit's own edit screen.
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
  sectionTitle:{ fontSize:'11px', color:'var(--text-disabled)', textTransform:'uppercase', letterSpacing:'0.05em', fontWeight:500 },
  infoGrid:    { background:'var(--surface-1)', borderRadius:'8px', padding:'8px 12px', border:'0.5px solid var(--border-subtle)' },
  messageBox:  { background:'var(--surface-1)', borderRadius:'8px', border:'0.5px solid var(--border-subtle)', padding:'12px 14px' },
  messageText: { fontSize:'13px', color:'var(--text-secondary)', lineHeight:1.5, whiteSpace:'pre-wrap' },
  snapshot:    { background:'var(--surface-1)', borderRadius:'8px', border:'0.5px solid var(--border-subtle)', overflow:'hidden', maxHeight:'200px', overflowY:'auto' },
  snapshotPre: { fontSize:'11px', color:'var(--text-muted)', padding:'12px', margin:0, fontFamily:'var(--font-mono)', lineHeight:1.5 },

  actionsWrap: { display:'flex', flexDirection:'column', gap:'10px' },
  hintText:    { fontSize:'12px', color:'var(--text-muted)' },
  approveBtn:  { background:'var(--color-signal)', color:'#fff', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:500, padding:'10px', cursor:'pointer' },
  resolvedNote:{ background:'var(--surface-1)', borderRadius:'8px', padding:'12px 14px', border:'0.5px solid var(--border-subtle)' },
  errorText:   { fontSize:'12px', color:'var(--color-heat)' },
  doneWrap:    { flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:'12px', padding:'0 24px' },
}
