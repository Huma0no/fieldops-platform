/**
 * src/screens/Corrections.jsx
 * F8 — Corrections queue for Dispatch. Two-tier review: evidence (ratify) vs no evidence (flag/follow-up).
 */

import { useState, useEffect } from 'react'
import { api } from '@shared/api.js'

const STATUS_LABEL = {
  pending:        { text: 'Pending',        color: 'var(--color-plasma)',  bg: 'var(--plasma-tint)'   },
  needs_evidence: { text: 'Needs evidence', color: 'var(--text-muted)',    bg: 'var(--surface-3)'     },
  approved:       { text: 'Approved',       color: '#22C55E',              bg: 'rgba(34,197,94,0.12)' },
  rejected:       { text: 'Rejected',       color: 'var(--color-heat)',    bg: 'var(--heat-tint)'     },
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

  const pendingCount      = corrections.filter(c => c.status === 'pending').length
  const needsEvidenceCount = corrections.filter(c => c.status === 'needs_evidence').length

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h2 style={styles.title}>Corrections</h2>
        <div style={{ display: 'flex', gap: '6px' }}>
          {pendingCount > 0 && (
            <span style={styles.count}>{pendingCount} pending</span>
          )}
          {needsEvidenceCount > 0 && (
            <span style={{ ...styles.count, color: 'var(--text-muted)' }}>{needsEvidenceCount} needs evidence</span>
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
                {['Technician','Address','Date','Reason','Evidence','Status',''].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {corrections.map(c => {
                const s = STATUS_LABEL[c.status] ?? STATUS_LABEL.pending
                return (
                  <tr key={c.id} style={styles.tr}>
                    <td style={styles.td}>{c.requestedBy?.name ?? '—'}</td>
                    <td style={styles.td}>{c.address?.street ?? '—'}</td>
                    <td style={styles.td}>{formatDate(c.requestedAt)}</td>
                    <td style={{ ...styles.td, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.reason ?? '—'}
                    </td>
                    <td style={styles.td}>
                      {c.hasEvidence ? (
                        <span style={styles.evidenceBadge}>Evidence</span>
                      ) : (
                        <span style={{ ...styles.evidenceBadge, opacity: 0.4 }}>None</span>
                      )}
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
  const [approving, setApproving]     = useState(false)
  const [rejecting, setRejecting]     = useState(false)
  const [flagging,  setFlagging]      = useState(false)
  const [rejectNote, setRejectNote]   = useState('')
  const [flagNote,   setFlagNote]     = useState('')
  const [showReject, setShowReject]   = useState(false)
  const [actionError, setActionError] = useState('')
  const [done, setDone]               = useState(null)

  const isPending      = correction.status === 'pending'
  const isNeedsEvidence = correction.status === 'needs_evidence'
  const isActionable   = isPending || isNeedsEvidence
  const hasEvidence    = correction.hasEvidence

  async function handleApprove () {
    setApproving(true); setActionError('')
    try {
      await api.patch(`/dispatch/corrections/${correction.id}/approve`)
      setDone('approved')
    } catch (err) {
      setActionError(err.message ?? 'Approve failed.')
    } finally { setApproving(false) }
  }

  async function handleReject () {
    setRejecting(true); setActionError('')
    try {
      await api.patch(`/dispatch/corrections/${correction.id}/reject`, {
        dispatcherNote: rejectNote.trim() || null,
      })
      setDone('rejected')
    } catch (err) {
      setActionError(err.message ?? 'Reject failed.')
    } finally { setRejecting(false) }
  }

  async function handleFlag () {
    setFlagging(true); setActionError('')
    try {
      await api.patch(`/dispatch/corrections/${correction.id}/flag-evidence`, {
        dispatcherNote: flagNote.trim() || null,
      })
      setDone('flagged')
    } catch (err) {
      setActionError(err.message ?? 'Flag failed.')
    } finally { setFlagging(false) }
  }

  if (done) {
    const icon  = done === 'approved' ? '✓' : done === 'rejected' ? '✕' : '⏳'
    const label = done === 'approved' ? 'Correction approved' : done === 'rejected' ? 'Correction rejected' : 'Flagged for follow-up'
    return (
      <div style={styles.page}>
        <div style={styles.header}>
          <button style={styles.backBtn} onClick={onBack}>← Corrections</button>
        </div>
        <div style={styles.doneWrap}>
          <p style={{ fontSize: '32px' }}>{icon}</p>
          <p style={{ fontSize: '16px', fontWeight: 500, color: 'var(--text-primary)' }}>{label}</p>
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
        {isNeedsEvidence && (
          <span style={{ ...styles.count, color: 'var(--text-muted)' }}>Needs evidence</span>
        )}
      </div>

      <div style={styles.detailBody}>

        {/* Request info */}
        <div style={styles.section}>
          <p style={styles.sectionTitle}>Request</p>
          <div style={styles.infoGrid}>
            <InfoRow label="Technician" value={correction.requestedBy?.name} />
            <InfoRow label="Date"       value={formatDate(correction.requestedAt)} />
            <InfoRow label="Reason"     value={correction.reason} />
            <InfoRow
              label="Fields"
              value={(correction.correctedFields ?? []).map(f => FIELD_LABELS[f] ?? f).join(', ')}
            />
          </div>
        </div>

        {/* Evidence photo — Tier 1 */}
        {hasEvidence && (
          <div style={styles.section}>
            <p style={styles.sectionTitle}>Evidence</p>
            <div style={styles.evidenceBox}>
              <span style={styles.evidenceIcon}>📷</span>
              <div>
                <p style={styles.evidenceLabel}>Photo attached</p>
                {correction.evidencePhoto?.slug && (
                  <p style={styles.evidenceSlug}>{correction.evidencePhoto.slug}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* No-evidence notice — Tier 2 */}
        {!hasEvidence && isActionable && (
          <div style={styles.noEvidenceBox}>
            <p style={styles.noEvidenceText}>
              No evidence photo was submitted. You can flag this for follow-up or approve directly.
            </p>
          </div>
        )}

        {/* needs_evidence state notice */}
        {isNeedsEvidence && (
          <div style={styles.awaitingBox}>
            <p style={styles.awaitingText}>
              Waiting for the technician to provide evidence. You can still approve or reject.
            </p>
            {correction.dispatcherNote && (
              <p style={{ ...styles.awaitingText, opacity: 0.7, marginTop: '4px' }}>
                Note: {correction.dispatcherNote}
              </p>
            )}
          </div>
        )}

        {/* Original visit snapshot */}
        {correction.visitSnapshot && (
          <div style={styles.section}>
            <p style={styles.sectionTitle}>Original visit data</p>
            <div style={styles.snapshot}>
              <pre style={styles.snapshotPre}>
                {JSON.stringify(correction.visitSnapshot, null, 2)}
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
        {isActionable && (
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
                  <button style={styles.cancelRejectBtn} onClick={() => setShowReject(false)}>Cancel</button>
                  <button style={styles.rejectBtn} onClick={handleReject} disabled={rejecting}>
                    {rejecting ? 'Rejecting…' : 'Confirm reject'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Tier 1: has evidence — Approve is primary */}
                {hasEvidence && isPending && (
                  <div style={styles.mainActions}>
                    <button style={styles.rejectOpenBtn} onClick={() => setShowReject(true)} disabled={approving}>
                      Reject
                    </button>
                    <button style={styles.approveBtn} onClick={handleApprove} disabled={approving}>
                      {approving ? 'Approving…' : 'Approve'}
                    </button>
                  </div>
                )}

                {/* Tier 2: no evidence, still pending — Flag is primary, Approve is secondary */}
                {!hasEvidence && isPending && (
                  <>
                    <div style={styles.flagSection}>
                      <label style={styles.rejectLabel}>Note for technician (optional)</label>
                      <textarea
                        style={styles.rejectTextarea}
                        value={flagNote}
                        onChange={e => setFlagNote(e.target.value)}
                        placeholder="Describe what evidence is needed…"
                        rows={2}
                      />
                    </div>
                    <div style={styles.mainActions}>
                      <button
                        style={{ ...styles.rejectOpenBtn, opacity: 0.7 }}
                        onClick={() => setShowReject(true)}
                        disabled={flagging}
                      >
                        Reject
                      </button>
                      <button
                        style={{ ...styles.approveBtn, flex: '0 0 auto', background: 'var(--surface-3)', color: 'var(--text-secondary)', border: '0.5px solid var(--border-default)' }}
                        onClick={handleApprove}
                        disabled={approving || flagging}
                      >
                        {approving ? 'Approving…' : 'Approve anyway'}
                      </button>
                      <button style={styles.approveBtn} onClick={handleFlag} disabled={flagging || approving}>
                        {flagging ? 'Flagging…' : 'Flag for follow-up'}
                      </button>
                    </div>
                  </>
                )}

                {/* needs_evidence override — both secondary, no flag button */}
                {isNeedsEvidence && (
                  <div style={styles.mainActions}>
                    <button style={styles.rejectOpenBtn} onClick={() => setShowReject(true)} disabled={approving}>
                      Reject
                    </button>
                    <button style={styles.approveBtn} onClick={handleApprove} disabled={approving}>
                      {approving ? 'Approving…' : 'Approve (override)'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {!isActionable && (
          <div style={styles.resolvedNote}>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              This correction was <strong>{correction.status}</strong>.
              {correction.dispatcherNote && ` Note: ${correction.dispatcherNote}`}
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
  evidenceBadge: { fontSize:'10px', fontWeight:500, color:'var(--text-muted)', background:'var(--surface-3)', padding:'2px 7px', borderRadius:'99px', letterSpacing:'0.02em' },

  detailBody:  { flex:1, overflowY:'auto', padding:'20px 24px', display:'flex', flexDirection:'column', gap:'20px' },
  section:     { display:'flex', flexDirection:'column', gap:'8px' },
  sectionTitle:{ fontSize:'11px', color:'var(--text-disabled)', textTransform:'uppercase', letterSpacing:'0.05em', fontWeight:500 },
  infoGrid:    { background:'var(--surface-1)', borderRadius:'8px', padding:'8px 12px', border:'0.5px solid var(--border-subtle)' },
  snapshot:    { background:'var(--surface-1)', borderRadius:'8px', border:'0.5px solid var(--border-subtle)', overflow:'hidden', maxHeight:'200px', overflowY:'auto' },
  snapshotPre: { fontSize:'11px', color:'var(--text-muted)', padding:'12px', margin:0, fontFamily:'var(--font-mono)', lineHeight:1.5 },
  impactBox:   { background:'var(--plasma-tint)', border:'0.5px solid var(--plasma-border)', borderRadius:'8px', padding:'12px 14px' },
  impactText:  { fontSize:'13px', color:'var(--color-plasma)' },

  evidenceBox:    { display:'flex', alignItems:'center', gap:'12px', background:'var(--surface-1)', borderRadius:'8px', border:'0.5px solid var(--border-subtle)', padding:'12px 14px' },
  evidenceIcon:   { fontSize:'24px', flexShrink:0 },
  evidenceLabel:  { fontSize:'13px', fontWeight:500, color:'var(--text-primary)' },
  evidenceSlug:   { fontSize:'11px', color:'var(--text-muted)', marginTop:'2px', fontFamily:'var(--font-mono)' },

  noEvidenceBox:  { background:'var(--surface-2)', border:'0.5px solid var(--border-subtle)', borderRadius:'8px', padding:'12px 14px' },
  noEvidenceText: { fontSize:'13px', color:'var(--text-muted)' },
  awaitingBox:    { background:'var(--plasma-tint)', border:'0.5px solid var(--plasma-border)', borderRadius:'8px', padding:'12px 14px' },
  awaitingText:   { fontSize:'13px', color:'var(--color-plasma)' },

  actionsWrap: { display:'flex', flexDirection:'column', gap:'12px' },
  flagSection: { display:'flex', flexDirection:'column', gap:'6px' },
  mainActions: { display:'flex', gap:'8px' },
  rejectOpenBtn:  { flex:'0 0 auto', background:'var(--surface-3)', color:'var(--text-secondary)', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:500, padding:'10px 20px', cursor:'pointer' },
  approveBtn:     { flex:1, background:'var(--color-signal)', color:'#fff', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:500, padding:'10px', cursor:'pointer' },
  rejectWrap:     { display:'flex', flexDirection:'column', gap:'10px', background:'var(--heat-tint)', border:'0.5px solid var(--heat-border)', borderRadius:'8px', padding:'14px' },
  rejectLabel:    { fontSize:'12px', color:'var(--text-muted)', fontWeight:500 },
  rejectTextarea: { background:'var(--surface-2)', border:'0.5px solid var(--border-default)', borderRadius:'6px', color:'var(--text-primary)', fontSize:'13px', padding:'8px 10px', outline:'none', resize:'vertical', fontFamily:'var(--font-sans)', lineHeight:1.5 },
  rejectActions:  { display:'flex', gap:'8px', justifyContent:'flex-end' },
  cancelRejectBtn:{ background:'none', border:'0.5px solid var(--border-default)', borderRadius:'6px', color:'var(--text-muted)', fontSize:'13px', padding:'8px 14px', cursor:'pointer' },
  rejectBtn:      { background:'var(--color-heat)', color:'#fff', border:'none', borderRadius:'6px', fontSize:'13px', fontWeight:500, padding:'8px 16px', cursor:'pointer' },
  resolvedNote:   { background:'var(--surface-1)', borderRadius:'8px', padding:'12px 14px', border:'0.5px solid var(--border-subtle)' },
  errorText:      { fontSize:'12px', color:'var(--color-heat)' },
  doneWrap:       { flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:'12px' },
}
