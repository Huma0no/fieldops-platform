/**
 * src/screens/TechnicianManager.jsx
 * F10 — Technician management for Dispatch.
 * List, deactivate, reactivate, generate invite (60s display), revoke access.
 */

import { useState, useEffect, useRef } from 'react'
import { api } from '@shared/api.js'

export default function TechnicianManager () {
  const [technicians, setTechnicians] = useState([])
  const [loading, setLoading]         = useState(true)
  const [actionError, setActionError] = useState('')

  useEffect(() => { loadTechnicians() }, [])

  async function loadTechnicians () {
    setLoading(true)
    try {
      const data = await api.get('/dispatch/technicians?includeInactive=true')
      setTechnicians(data ?? [])
    } catch (err) {
      console.error('Technicians load failed:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleDeactivate (tech) {
    setActionError('')
    try {
      const result = await api.patch(`/dispatch/technicians/${tech.id}/deactivate`)
      setTechnicians(prev => prev.map(t => t.id === tech.id ? { ...t, isActive: false, is_active: false } : t))
      if (result?.orphanedVisitIds?.length) {
        alert(`${result.orphanedVisitIds.length} visit(s) moved to Lobby: ${result.orphanedVisitIds.join(', ')}`)
      }
    } catch (err) {
      setActionError(`Deactivate failed: ${err.message ?? 'unknown error'}`)
      console.error(err)
    }
  }

  async function handleReactivate (tech) {
    setActionError('')
    try {
      await api.patch(`/dispatch/technicians/${tech.id}/reactivate`)
      setTechnicians(prev => prev.map(t => t.id === tech.id ? { ...t, isActive: true, is_active: true } : t))
    } catch (err) {
      setActionError(`Reactivate failed: ${err.message ?? 'unknown error'}`)
      console.error(err)
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h2 style={styles.title}>Technician Manager</h2>
        <button style={styles.refreshBtn} onClick={loadTechnicians}>Refresh</button>
      </div>

      {actionError && (
        <div style={styles.errorBanner}>
          <span>{actionError}</span>
          <button style={styles.errorDismiss} onClick={() => setActionError('')}>×</button>
        </div>
      )}

      <div style={styles.tableWrap}>
        {loading ? (
          <p style={styles.muted}>Loading…</p>
        ) : technicians.length === 0 ? (
          <p style={styles.muted}>No technicians found.</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                {['Name','Role','Status','Last active','Actions'].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {technicians.map(tech => {
                const isActive = tech.isActive ?? tech.is_active ?? false
                return (
                  <TechRow
                    key={tech.id}
                    tech={{ ...tech, isActive }}
                    onDeactivate={() => handleDeactivate(tech)}
                    onReactivate={() => handleReactivate(tech)}
                    onError={setActionError}
                  />
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Tech row with invite/revoke actions ────────────────────

function TechRow ({ tech, onDeactivate, onReactivate, onError }) {
  const [inviteCode, setInviteCode]   = useState(null)
  const [countdown, setCountdown]     = useState(0)
  const [generating, setGenerating]   = useState(false)
  const [revoking, setRevoking]       = useState(false)
  const timerRef = useRef(null)

  function startCountdown (code) {
    setInviteCode(code)
    setCountdown(60)
    timerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current)
          setInviteCode(null)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  // Clean up timer on unmount
  useEffect(() => () => clearInterval(timerRef.current), [])

  async function handleGenerateInvite () {
    setGenerating(true)
    onError('')
    try {
      const result = await api.post('/auth/generate-invite', { technicianId: tech.id })
      startCountdown(result.inviteCode)
    } catch (err) {
      onError(`Invite generation failed: ${err.message ?? 'unknown error'}`)
      console.error(err)
    } finally {
      setGenerating(false)
    }
  }

  async function handleRevoke () {
    if (!confirm(`Revoke all access tokens for ${tech.name}? They will need a new invite to log in.`)) return
    setRevoking(true)
    onError('')
    try {
      await api.post('/auth/revoke', { technicianId: tech.id })
    } catch (err) {
      onError(`Revoke failed: ${err.message ?? 'unknown error'}`)
      console.error(err)
    } finally {
      setRevoking(false)
    }
  }

  const lastActive = tech.lastActiveAt ?? tech.last_active_at ?? tech.createdAt ?? tech.created_at
  const roleLabel  = { owner: 'Owner', dispatcher: 'Dispatcher', technician: 'Technician' }[tech.role] ?? tech.role

  return (
    <tr style={styles.tr}>
      <td style={styles.td}>
        <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{tech.name}</span>
      </td>
      <td style={styles.td}>{roleLabel}</td>
      <td style={styles.td}>
        <StatusBadge active={tech.isActive} />
      </td>
      <td style={styles.td}>{formatDate(lastActive)}</td>
      <td style={{ ...styles.td, verticalAlign: 'middle' }}>
        <div style={styles.actions}>
          {/* Deactivate / Reactivate */}
          {tech.isActive ? (
            <button style={styles.dangerBtn} onClick={onDeactivate}>Deactivate</button>
          ) : (
            <button style={styles.actionBtn} onClick={onReactivate}>Reactivate</button>
          )}

          {/* Generate invite */}
          {inviteCode ? (
            <div style={styles.inviteBox}>
              <span style={styles.inviteCode}>{inviteCode}</span>
              <span style={styles.inviteCountdown}>{countdown}s</span>
            </div>
          ) : (
            <button
              style={{ ...styles.actionBtn, opacity: !tech.isActive ? 0.4 : 1 }}
              onClick={handleGenerateInvite}
              disabled={generating || !tech.isActive}
              title={!tech.isActive ? 'Reactivate first' : undefined}
            >
              {generating ? '…' : 'Invite code'}
            </button>
          )}

          {/* Revoke */}
          <button style={styles.ghostBtn} onClick={handleRevoke} disabled={revoking}>
            {revoking ? '…' : 'Revoke'}
          </button>
        </div>
      </td>
    </tr>
  )
}

function StatusBadge ({ active }) {
  return (
    <span style={{
      fontSize: '11px',
      fontWeight: 500,
      color:      active ? '#22C55E' : 'var(--text-disabled)',
      background: active ? 'rgba(34,197,94,0.12)' : 'var(--surface-3)',
      padding: '2px 10px',
      borderRadius: '99px',
    }}>
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}

function formatDate (iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch (_) { return '—' }
}

// ── Styles ─────────────────────────────────────────────────

const styles = {
  page:           { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--surface-base)' },
  header:         { padding: '16px 24px', borderBottom: '0.5px solid var(--border-subtle)', background: 'var(--surface-1)', display: 'flex', alignItems: 'center', gap: '16px', flexShrink: 0 },
  title:          { fontSize: '16px', fontWeight: 500, color: 'var(--text-primary)' },
  refreshBtn:     { background: 'none', border: '0.5px solid var(--border-default)', borderRadius: '6px', color: 'var(--text-muted)', fontSize: '12px', padding: '4px 10px', cursor: 'pointer' },

  errorBanner:    { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 24px', background: 'var(--heat-tint)', borderBottom: '0.5px solid var(--heat-border)', fontSize: '13px', color: 'var(--color-heat)', flexShrink: 0 },
  errorDismiss:   { background: 'none', border: 'none', color: 'var(--color-heat)', cursor: 'pointer', fontSize: '16px', padding: 0 },

  tableWrap:      { flex: 1, overflowY: 'auto', padding: '16px 24px' },
  table:          { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th:             { textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 500, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '0.5px solid var(--border-subtle)' },
  tr:             { borderBottom: '0.5px solid var(--border-subtle)' },
  td:             { padding: '12px 12px', color: 'var(--text-secondary)', verticalAlign: 'middle' },
  muted:          { color: 'var(--text-muted)', fontSize: '14px' },

  actions:        { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' },
  actionBtn:      { background: 'none', border: '0.5px solid var(--border-default)', borderRadius: '6px', color: 'var(--color-signal)', fontSize: '12px', fontWeight: 500, padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap' },
  dangerBtn:      { background: 'none', border: '0.5px solid var(--heat-border)', borderRadius: '6px', color: 'var(--color-heat)', fontSize: '12px', fontWeight: 500, padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap' },
  ghostBtn:       { background: 'none', border: '0.5px solid var(--border-default)', borderRadius: '6px', color: 'var(--text-disabled)', fontSize: '12px', padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap' },

  inviteBox:      { display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--signal-tint)', border: '0.5px solid var(--color-signal)', borderRadius: '6px', padding: '4px 10px' },
  inviteCode:     { fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 600, color: 'var(--color-signal)', letterSpacing: '0.1em' },
  inviteCountdown:{ fontSize: '11px', color: 'var(--text-muted)' },
}
