/**
 * src/screens/TechnicianManager.jsx
 * F10 — Technician management for Dispatch.
 * List identities and manage their account access.
 */

import { useState, useEffect } from 'react'
import { api } from '@shared/api.js'

export default function TechnicianManager () {
  const [technicians, setTechnicians] = useState([])
  const [loading, setLoading]         = useState(true)
  const [actionError, setActionError] = useState('')
  const [credentialForm, setCredentialForm] = useState(null)
  const [newAccount, setNewAccount] = useState({ name: '', username: '', temporaryPassword: '', role: 'TECHNICIAN' })
  let isOwner = false
  try { isOwner = JSON.parse(localStorage.getItem('technician') ?? '{}').role === 'DISPATCH_OWNER' } catch (_) {}

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

  async function handleCommissionRateChange (tech, value) {
    setActionError('')
    try {
      await api.patch(`/dispatch/technicians/${tech.id}/commission-rate`, { commissionRate: value })
      setTechnicians(prev => prev.map(t => t.id === tech.id ? { ...t, commissionRate: value } : t))
    } catch (err) {
      setActionError(`Commission rate update failed: ${err.message ?? 'unknown error'}`)
      console.error(err)
    }
  }

  async function handleCreateAccount (event) {
    event.preventDefault()
    setActionError('')
    try {
      await api.post('/dispatch/technicians', newAccount)
      setNewAccount({ name: '', username: '', temporaryPassword: '', role: 'TECHNICIAN' })
      await loadTechnicians()
    } catch (err) {
      setActionError(`Account creation failed: ${err.message ?? 'unknown error'}`)
    }
  }

  async function handleResetPassword (tech) {
    setCredentialForm({ mode: 'reset', tech, username: '', temporaryPassword: '' })
  }

  function handleProvisionAccount (tech) {
    setCredentialForm({ mode: 'provision', tech, username: '', temporaryPassword: '' })
  }

  async function submitCredentialForm (event) {
    event.preventDefault()
    setActionError('')
    try {
      if (credentialForm.mode === 'provision') {
        await api.post(`/dispatch/technicians/${credentialForm.tech.id}/provision-account`, {
          username: credentialForm.username,
          temporaryPassword: credentialForm.temporaryPassword,
        })
      } else {
        await api.patch(`/dispatch/technicians/${credentialForm.tech.id}/password`, {
          temporaryPassword: credentialForm.temporaryPassword,
        })
      }
      setCredentialForm(null)
      await loadTechnicians()
    } catch (err) {
      setActionError(`Account update failed: ${err.message ?? 'unknown error'}`)
    }
  }

  async function handleRevokeSessions (tech) {
    if (!confirm(`Sign out all sessions for ${tech.name}?`)) return
    try {
      await api.post(`/dispatch/technicians/${tech.id}/revoke-sessions`, {})
    } catch (err) {
      setActionError(`Session revocation failed: ${err.message ?? 'unknown error'}`)
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

      {isOwner && <form style={styles.createForm} onSubmit={handleCreateAccount}>
        <h3 style={styles.createTitle}>Create account</h3>
        <input style={styles.createInput} placeholder="Person name" value={newAccount.name} onChange={e => setNewAccount(v => ({ ...v, name: e.target.value }))} required />
        <input style={styles.createInput} placeholder="Username" autoComplete="off" value={newAccount.username} onChange={e => setNewAccount(v => ({ ...v, username: e.target.value }))} required />
        <input style={styles.createInput} placeholder="Temporary password (12+ characters)" autoComplete="new-password" type="password" minLength={12} value={newAccount.temporaryPassword} onChange={e => setNewAccount(v => ({ ...v, temporaryPassword: e.target.value }))} required />
        <select style={styles.createInput} value={newAccount.role} onChange={e => setNewAccount(v => ({ ...v, role: e.target.value }))}>
          <option value="TECHNICIAN">Technician</option><option value="DISPATCHER">Dispatcher</option><option value="DISPATCH_OWNER">Dispatch Owner</option>
        </select>
        <button style={styles.actionBtn} type="submit">Create account</button>
      </form>}

      {credentialForm && <form style={styles.createForm} onSubmit={submitCredentialForm}>
        <h3 style={styles.createTitle}>{credentialForm.mode === 'provision' ? `Provision account for ${credentialForm.tech.name}` : `Reset password for ${credentialForm.tech.name}`}</h3>
        {credentialForm.mode === 'provision' && <input style={styles.createInput} placeholder="Username" value={credentialForm.username} onChange={e => setCredentialForm(v => ({ ...v, username: e.target.value }))} required />}
        <input style={styles.createInput} placeholder="Temporary password (12+ characters)" type="password" autoComplete="new-password" minLength={12} value={credentialForm.temporaryPassword} onChange={e => setCredentialForm(v => ({ ...v, temporaryPassword: e.target.value }))} required />
        <button style={styles.actionBtn} type="submit">{credentialForm.mode === 'provision' ? 'Provision account' : 'Reset password'}</button>
        <button style={styles.ghostBtn} type="button" onClick={() => setCredentialForm(null)}>Cancel</button>
      </form>}

      <div style={styles.tableWrap}>
        {loading ? (
          <p style={styles.muted}>Loading…</p>
        ) : technicians.length === 0 ? (
          <p style={styles.muted}>No technicians found.</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                {['Name','Username','Role','Commission %','Status','Account','Last active','Actions'].map(h => (
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
                    onCommissionRateChange={(value) => handleCommissionRateChange(tech, value)}
                    onResetPassword={() => handleResetPassword(tech)}
                    onProvisionAccount={() => handleProvisionAccount(tech)}
                    onRevokeSessions={() => handleRevokeSessions(tech)}
                    canManageAccounts={isOwner}
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

// ── Technician and account row ─────────────────────────────

function TechRow ({ tech, onDeactivate, onReactivate, onCommissionRateChange, onResetPassword, onProvisionAccount, onRevokeSessions, canManageAccounts, onError }) {
  const [commissionInput, setCommissionInput] = useState(tech.commissionRate ?? tech.commission_rate ?? 20)

  useEffect(() => { setCommissionInput(tech.commissionRate ?? tech.commission_rate ?? 20) }, [tech.commissionRate, tech.commission_rate])

  function handleCommissionBlur () {
    const value = Number(commissionInput)
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      onError('Commission rate must be a number between 0 and 100')
      setCommissionInput(tech.commissionRate ?? tech.commission_rate ?? 20)
      return
    }
    if (value !== (tech.commissionRate ?? tech.commission_rate)) onCommissionRateChange(value)
  }

  const lastActive = tech.lastActiveAt ?? tech.last_active_at ?? tech.createdAt ?? tech.created_at
  const roleLabel  = { DISPATCH_OWNER: 'Dispatch Owner', DISPATCHER: 'Dispatcher', TECHNICIAN: 'Technician' }[tech.role] ?? tech.role

  return (
    <tr style={styles.tr}>
      <td style={styles.td}>
        <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{tech.name}</span>
      </td>
      <td style={styles.td}>{tech.username ?? '—'}</td>
      <td style={styles.td}>{roleLabel}</td>
      <td style={styles.td}>
        {tech.role === 'DISPATCH_OWNER' ? (
          <span>—</span>
        ) : (
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            value={commissionInput}
            onChange={(e) => setCommissionInput(e.target.value)}
            onBlur={handleCommissionBlur}
            style={styles.commissionInput}
          />
        )}
      </td>
      <td style={styles.td}>
        <StatusBadge active={tech.isActive} />
      </td>
      <td style={styles.td}>{!tech.hasAccount ? 'Not provisioned' : tech.mustChangePassword ? 'Password change required' : 'Ready'}</td>
      <td style={styles.td}>{formatDate(lastActive)}</td>
      <td style={{ ...styles.td, verticalAlign: 'middle' }}>
        <div style={styles.actions}>
          {/* Deactivate / Reactivate */}
          {canManageAccounts && (tech.isActive ? (
            <button style={styles.dangerBtn} onClick={onDeactivate}>Deactivate</button>
          ) : (
            <button style={styles.actionBtn} onClick={onReactivate}>Reactivate</button>
          ))}

          {canManageAccounts && !tech.hasAccount && tech.isActive && <button style={styles.actionBtn} onClick={onProvisionAccount}>Provision account</button>}
          {canManageAccounts && tech.hasAccount && <button style={styles.actionBtn} onClick={onResetPassword}>Reset password</button>}
          {canManageAccounts && tech.hasAccount && <button style={styles.ghostBtn} onClick={onRevokeSessions}>Revoke sessions</button>}
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

  createForm:     { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', padding: '12px 24px', background: 'var(--surface-1)', borderBottom: '0.5px solid var(--border-subtle)' },
  createTitle:    { width: '100%', fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' },
  createInput:    { background: 'var(--surface-2)', border: '0.5px solid var(--border-default)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '12px', padding: '7px 9px' },

  tableWrap:      { flex: 1, overflowY: 'auto', padding: '16px 24px' },
  table:          { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th:             { textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 500, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '0.5px solid var(--border-subtle)' },
  tr:             { borderBottom: '0.5px solid var(--border-subtle)' },
  td:             { padding: '12px 12px', color: 'var(--text-secondary)', verticalAlign: 'middle' },
  muted:          { color: 'var(--text-muted)', fontSize: '14px' },

  commissionInput:{ width: '56px', background: 'var(--surface-2)', border: '0.5px solid var(--border-default)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', padding: '4px 6px' },

  actions:        { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' },
  actionBtn:      { background: 'none', border: '0.5px solid var(--border-default)', borderRadius: '6px', color: 'var(--color-signal)', fontSize: '12px', fontWeight: 500, padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap' },
  dangerBtn:      { background: 'none', border: '0.5px solid var(--heat-border)', borderRadius: '6px', color: 'var(--color-heat)', fontSize: '12px', fontWeight: 500, padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap' },
  ghostBtn:       { background: 'none', border: '0.5px solid var(--border-default)', borderRadius: '6px', color: 'var(--text-disabled)', fontSize: '12px', padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap' },

}
