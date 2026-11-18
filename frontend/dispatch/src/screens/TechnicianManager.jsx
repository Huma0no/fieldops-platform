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
  const [selectedId, setSelectedId] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
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

  const list = technicians.map(tech => ({ ...tech, isActive: tech.isActive ?? tech.is_active ?? false }))
  const selected = list.find(tech => tech.id === selectedId)
  const activeCount = list.filter(tech => tech.isActive).length

  function closeRecord () {
    setSelectedId(null)
    setCredentialForm(null)
  }

  const errorBanner = actionError && (
    <div className="vd-alert" role="alert">
      <span className="vd-error" style={styles.grow}>{actionError}</span>
      <button type="button" className="vd-key sm" aria-label="Dismiss" onClick={() => setActionError('')}>×</button>
    </div>
  )

  if (selected) {
    return (
      <div style={styles.page}>
        {errorBanner}
        <TechRecord
          tech={selected}
          onBack={closeRecord}
          onDeactivate={() => handleDeactivate(selected)}
          onReactivate={() => handleReactivate(selected)}
          onCommissionRateChange={(value) => handleCommissionRateChange(selected, value)}
          onResetPassword={() => handleResetPassword(selected)}
          onProvisionAccount={() => handleProvisionAccount(selected)}
          onRevokeSessions={() => handleRevokeSessions(selected)}
          canManageAccounts={isOwner}
          onError={setActionError}
          credentialForm={credentialForm}
          setCredentialForm={setCredentialForm}
          onSubmitCredentials={submitCredentialForm}
        />
      </div>
    )
  }

  return (
    <div style={styles.page}>
      {errorBanner}

      <div className="vd-unit">
        <div className="vd-unit-head">
          <span className="vd-unit-id">RST</span><span className="vd-unit-name">Roster</span>
          <span className="vd-unit-note">Technicians and Dispatch accounts</span>
        </div>
        <div className="vd-knurl" />
        <div className="vd-unit-body">
          <div style={styles.toolbar}>
            <span className="vd-stencil"><span className="vd-data">{activeCount}</span> active · <span className="vd-data">{list.length - activeCount}</span> inactive</span>
            <span style={styles.grow} />
            <button type="button" className="vd-key sm" onClick={loadTechnicians}>Refresh</button>
            {isOwner && (
              <button type="button" className={`vd-key sm${showCreate ? ' dark' : ''}`} onClick={() => setShowCreate(v => !v)}>
                + Add account
              </button>
            )}
          </div>

          {isOwner && showCreate && (
            <form style={styles.createForm} onSubmit={handleCreateAccount}>
              <h4 className="vd-sub" style={styles.full}>Create account</h4>
              <label style={styles.field}><span className="vd-label">Person name</span>
                <input className="vd-input" value={newAccount.name} onChange={e => setNewAccount(v => ({ ...v, name: e.target.value }))} required />
              </label>
              <label style={styles.field}><span className="vd-label">Username</span>
                <input className="vd-input" autoComplete="off" value={newAccount.username} onChange={e => setNewAccount(v => ({ ...v, username: e.target.value }))} required />
              </label>
              <label style={styles.field}><span className="vd-label">Temporary password (12+ characters)</span>
                <input className="vd-input" autoComplete="new-password" type="password" minLength={12} value={newAccount.temporaryPassword} onChange={e => setNewAccount(v => ({ ...v, temporaryPassword: e.target.value }))} required />
              </label>
              <label style={styles.field}><span className="vd-label">Role</span>
                <select className="vd-input" value={newAccount.role} onChange={e => setNewAccount(v => ({ ...v, role: e.target.value }))}>
                  <option value="TECHNICIAN">Technician</option><option value="DISPATCHER">Dispatcher</option><option value="DISPATCH_OWNER">Dispatch Owner</option>
                </select>
              </label>
              <button className="vd-key dark" type="submit">Create account</button>
            </form>
          )}

          {loading ? (
            <p className="vd-hint" style={styles.flush}>Loading…</p>
          ) : list.length === 0 ? (
            <p className="vd-hint" style={styles.flush}>No technicians found.</p>
          ) : (
            <div style={styles.scrollX}>
              <table className="vd-table">
                <thead>
                  <tr>
                    <th>Status</th><th>Name</th><th>Username</th><th>Role</th>
                    <th style={styles.right}>Commission %</th><th>Account</th><th>Last active</th><th />
                  </tr>
                </thead>
                <tbody>
                  {list.map(tech => (
                    <tr key={tech.id} className={tech.isActive ? '' : 'inact'}>
                      <td><StatusLamp active={tech.isActive} /></td>
                      <td style={styles.name}>{tech.name}</td>
                      <td className="vd-data">{tech.username ?? '—'}</td>
                      <td>{roleLabel(tech.role)}</td>
                      <td className="num" style={styles.right}>{tech.role === 'DISPATCH_OWNER' ? '—' : `${commissionOf(tech)}%`}</td>
                      <td>{accountLabel(tech)}</td>
                      <td className="vd-data" style={styles.nowrap}>{formatDate(lastActiveOf(tech))}</td>
                      <td style={styles.right}>
                        <button type="button" className="vd-key sm" onClick={() => setSelectedId(tech.id)}>Open</button>
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

// ── One technician or account record ──────────────────────

function TechRecord ({ tech, onBack, onDeactivate, onReactivate, onCommissionRateChange, onResetPassword, onProvisionAccount, onRevokeSessions, canManageAccounts, onError, credentialForm, setCredentialForm, onSubmitCredentials }) {
  const [commissionInput, setCommissionInput] = useState(commissionOf(tech))

  useEffect(() => { setCommissionInput(commissionOf(tech)) }, [tech.commissionRate, tech.commission_rate])

  function handleCommissionBlur () {
    const value = Number(commissionInput)
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      onError('Commission rate must be a number between 0 and 100')
      setCommissionInput(commissionOf(tech))
      return
    }
    if (value !== (tech.commissionRate ?? tech.commission_rate)) onCommissionRateChange(value)
  }

  return (
    <div className="vd-unit">
      <div className="vd-unit-head">
        <span className="vd-unit-id">TEC</span><span className="vd-unit-name">{tech.name}</span>
        <span className="vd-unit-note"><StatusLamp active={tech.isActive} /></span>
      </div>
      <div className="vd-knurl" />
      <div className="vd-unit-body">
        <button type="button" className="vd-key sm" style={styles.back} onClick={onBack}>← Roster</button>
        <div className="vd-detail-cols">
          <div>
            <h4 className="vd-sub">Who</h4>
            <dl className="vd-kv">
              <dt>Name</dt><dd>{tech.name}</dd>
              <dt>Username</dt><dd className="vd-data">{tech.username ?? '—'}</dd>
              <dt>Role</dt><dd>{roleLabel(tech.role)}</dd>
              <dt>Last active</dt><dd className="vd-data">{formatDate(lastActiveOf(tech))}</dd>
            </dl>

            {tech.role !== 'DISPATCH_OWNER' && (
              <div className="vd-section">
                <h4 className="vd-sub">Commission</h4>
                <div className="vd-readout" style={styles.comm}>
                  <div className="num">{commissionOf(tech)}<span style={styles.unit}>%</span></div>
                  <label style={styles.commField}><span className="vd-label">Set</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      className="vd-input data"
                      value={commissionInput}
                      onChange={(e) => setCommissionInput(e.target.value)}
                      onBlur={handleCommissionBlur}
                    />
                  </label>
                </div>
              </div>
            )}
          </div>

          <div>
            <h4 className="vd-sub">Account</h4>
            <dl className="vd-kv">
              <dt>Status</dt><dd>{tech.isActive ? 'Active' : 'Inactive'}</dd>
              <dt>Account</dt><dd>{accountLabel(tech)}</dd>
            </dl>
            {canManageAccounts && (
              <div style={styles.keys}>
                {tech.isActive ? (
                  <button type="button" className="vd-key sm" onClick={onDeactivate}>Deactivate</button>
                ) : (
                  <button type="button" className="vd-key sm" onClick={onReactivate}>Reactivate</button>
                )}
                {!tech.hasAccount && tech.isActive && <button type="button" className="vd-key sm" onClick={onProvisionAccount}>Provision account</button>}
                {tech.hasAccount && <button type="button" className="vd-key sm" onClick={onResetPassword}>Reset password</button>}
                {tech.hasAccount && <button type="button" className="vd-key sm" onClick={onRevokeSessions}>Revoke sessions</button>}
              </div>
            )}

            {credentialForm && (
              <form className="vd-section" style={styles.credForm} onSubmit={onSubmitCredentials}>
                <h4 className="vd-sub">{credentialForm.mode === 'provision' ? 'Provision account' : 'Reset password'}</h4>
                {credentialForm.mode === 'provision' && (
                  <label><span className="vd-label">Username</span>
                    <input className="vd-input" value={credentialForm.username} onChange={e => setCredentialForm(v => ({ ...v, username: e.target.value }))} required />
                  </label>
                )}
                <label><span className="vd-label">Temporary password (12+ characters)</span>
                  <input className="vd-input" type="password" autoComplete="new-password" minLength={12} value={credentialForm.temporaryPassword} onChange={e => setCredentialForm(v => ({ ...v, temporaryPassword: e.target.value }))} required />
                </label>
                <div style={styles.keys}>
                  <button className="vd-key dark" type="submit">{credentialForm.mode === 'provision' ? 'Provision account' : 'Reset password'}</button>
                  <button className="vd-key" type="button" onClick={() => setCredentialForm(null)}>Cancel</button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusLamp ({ active }) {
  return (
    <span className={`vd-status${active ? '' : ' off'}`}>
      <span className={`vd-led${active ? ' on' : ''}`} />{active ? 'Active' : 'Inactive'}
    </span>
  )
}

function commissionOf (tech) { return tech.commissionRate ?? tech.commission_rate ?? 20 }
function lastActiveOf (tech) { return tech.lastActiveAt ?? tech.last_active_at ?? tech.createdAt ?? tech.created_at }
function roleLabel (role) { return { DISPATCH_OWNER: 'Dispatch Owner', DISPATCHER: 'Dispatcher', TECHNICIAN: 'Technician' }[role] ?? role }
function accountLabel (tech) { return !tech.hasAccount ? 'Not provisioned' : tech.mustChangePassword ? 'Password change required' : 'Ready' }

function formatDate (iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch (_) { return '—' }
}

// Layout only; the look comes from dispatch.css (vd-*).
const styles = {
  page:       { flex: 1, overflowY: 'auto', padding: '16px 18px 18px', display: 'flex', flexDirection: 'column', gap: '18px' },
  flush:      { margin: 0 },
  grow:       { flex: 1 },
  full:       { width: '100%' },
  scrollX:    { overflowX: 'auto' },
  right:      { textAlign: 'right' },
  nowrap:     { whiteSpace: 'nowrap' },
  name:       { fontWeight: 700 },
  toolbar:    { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' },
  createForm: { display: 'flex', alignItems: 'flex-end', gap: '10px', flexWrap: 'wrap', marginBottom: '18px', paddingBottom: '18px', borderBottom: '2px solid var(--vd-ink)' },
  field:      { display: 'flex', flexDirection: 'column', flex: '1 1 180px' },
  back:       { marginBottom: '16px' },
  comm:       { display: 'flex', alignItems: 'center', gap: '18px' },
  unit:       { fontSize: '18px' },
  commField:  { width: '100px' },
  keys:       { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' },
  credForm:   { display: 'flex', flexDirection: 'column', gap: '10px' },
}
