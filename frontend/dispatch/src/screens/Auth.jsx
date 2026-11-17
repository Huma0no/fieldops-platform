/**
 * src/screens/Auth.jsx
 * Shared username and password login for the Dispatch panel.
 */

import { useState } from 'react'
import { api } from '@shared/api.js'
import { useAuth } from '../lib/auth.jsx'
import { getPasswordChangeError, togglePasswordVisibility } from '../lib/password-change.mjs'

export default function Auth () {
  const { login }   = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)
  const [keepSignedIn, setKeepSignedIn] = useState(true)
  const [showPassword, setShowPassword] = useState(false)

  async function handleSubmit (e) {
    e.preventDefault()
    if (!username.trim() || !password) {
      setError('Enter your username and password.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const data = await api.post('/auth/login', { username, password, keepSignedIn })
      if (!['DISPATCH_OWNER', 'DISPATCHER'].includes(data.user.role)) {
        await api.post('/auth/logout', {}).catch(() => {})
        setError('This account does not have Dispatch access.')
        return
      }
      login(data.user)
    } catch (err) {
      if (err.status === 401) {
        setError('Invalid username or password.')
      } else {
        setError('Connection error. Check your network and try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.page}>
      <div className="vd-rack" style={styles.card}>
        <Screws />
        <h1 className="vd-brand" style={styles.title}>FieldOps · Dispatch</h1>
        <p className="vd-stencil" style={styles.subtitle}>Sign in to the dispatch panel</p>

        <form onSubmit={handleSubmit} style={styles.form} noValidate>
          <input
            type="text"
            value={username}
            onChange={e => { setUsername(e.target.value); setError('') }}
            placeholder="Username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            className="vd-input data"
            style={styles.input}
          />
          <div style={styles.passwordField}>
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => { setPassword(e.target.value); setError('') }}
              placeholder="Password"
              autoComplete="current-password"
              spellCheck={false}
              className="vd-input data"
              style={{ ...styles.input, ...styles.passwordInput }}
            />
            <button type="button" style={styles.visibilityButton} aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(value => !value)}>
              <PasswordVisibilityIcon visible={showPassword} />
            </button>
          </div>
          <label style={styles.keep}>
            <input type="checkbox" checked={keepSignedIn} onChange={e => setKeepSignedIn(e.target.checked)} />
            Keep me signed in on this device
          </label>

          {error && <p className="vd-error" style={styles.error}>{error}</p>}

          <button type="submit" disabled={loading} className="vd-key dark wide">
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="vd-stencil" style={styles.help}>Contact your Dispatch Owner if you need access.</p>
      </div>
    </div>
  )
}

export function PasswordChange () {
  const { session, login } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [visiblePasswords, setVisiblePasswords] = useState({ newPassword: false, confirmPassword: false })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const validationError = getPasswordChangeError({ currentPassword, newPassword, confirmPassword })

  async function submit (event) {
    event.preventDefault()
    const validation = getPasswordChangeError({ currentPassword, newPassword, confirmPassword })
    if (validation) {
      setError(validation)
      return
    }
    setError('')
    setLoading(true)
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword })
      login({ ...session.dispatcher, mustChangePassword: false })
    } catch (err) {
      setError(err.message ?? 'Password change failed.')
    } finally {
      setLoading(false)
    }
  }
  return <div style={styles.page}><form onSubmit={submit} className="vd-rack" style={styles.card}>
    <Screws />
    <h1 className="vd-brand" style={styles.title}>Change your temporary password</h1>
    <p className="vd-stencil" style={styles.subtitle}>Choose a password with at least 12 characters</p>
    <input className="vd-input data" style={styles.input} type="password" autoComplete="current-password" placeholder="Temporary password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required />
    <div style={styles.passwordField}>
      <input className="vd-input data" style={{ ...styles.input, ...styles.passwordInput }} type={visiblePasswords.newPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="New Password" value={newPassword} onChange={e => { setNewPassword(e.target.value); setError('') }} minLength={12} required />
      <button type="button" style={styles.visibilityButton} aria-label={visiblePasswords.newPassword ? 'Hide new password' : 'Show new password'} onClick={() => setVisiblePasswords(value => togglePasswordVisibility(value, 'newPassword'))}>
        <PasswordVisibilityIcon visible={visiblePasswords.newPassword} />
      </button>
    </div>
    <div style={styles.passwordField}>
      <input className="vd-input data" style={{ ...styles.input, ...styles.passwordInput }} type={visiblePasswords.confirmPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="Confirm New Password" value={confirmPassword} onChange={e => { setConfirmPassword(e.target.value); setError('') }} minLength={12} required />
      <button type="button" style={styles.visibilityButton} aria-label={visiblePasswords.confirmPassword ? 'Hide confirmation password' : 'Show confirmation password'} onClick={() => setVisiblePasswords(value => togglePasswordVisibility(value, 'confirmPassword'))}>
        <PasswordVisibilityIcon visible={visiblePasswords.confirmPassword} />
      </button>
    </div>
    {newPassword && confirmPassword && newPassword !== confirmPassword && <p className="vd-error" style={styles.error} role="alert">New passwords do not match.</p>}
    {error && <p className="vd-error" style={styles.error}>{error}</p>}
    <button type="submit" disabled={loading || Boolean(validationError)} className="vd-key dark wide">{loading ? 'Updating…' : 'Update password'}</button>
  </form></div>
}

function Screws () {
  return <><span className="vd-screw tl" /><span className="vd-screw tr" /><span className="vd-screw bl" /><span className="vd-screw br" /></>
}

function PasswordVisibilityIcon ({ visible }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    {visible
      ? <><path d="M3 3l18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M10.6 10.6a2 2 0 002.8 2.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M9.9 5.2A10.8 10.8 0 0121 12a11.5 11.5 0 01-3.1 3.8M6.2 6.2A11.5 11.5 0 003 12a10.8 10.8 0 005.1 5.8 10.7 10.7 0 005.9 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></>
      : <><path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="2" /></>}
  </svg>
}

const styles = {
  page: {
    minHeight: '100dvh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
  },
  card: {
    width: '100%',
    maxWidth: '400px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
    padding: '32px 28px 28px',
  },
  title: {
    margin: 0,
    fontWeight: 400,
    textAlign: 'center',
    borderBottom: '3px solid var(--vd-ink)',
    paddingBottom: '12px',
    alignSelf: 'stretch',
  },
  subtitle: {
    margin: 0,
    textAlign: 'center',
  },
  form: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    marginTop: '4px',
  },
  input: {
    fontSize: 'var(--text-md)',
    letterSpacing: '0.08em',
    padding: '13px 14px',
    textAlign: 'center',
  },
  passwordField: {
    position: 'relative',
    width: '100%',
  },
  passwordInput: {
    paddingRight: '52px',
  },
  visibilityButton: {
    position: 'absolute',
    top: '50%',
    right: '8px',
    transform: 'translateY(-50%)',
    display: 'grid',
    placeItems: 'center',
    padding: '8px',
    border: 'none',
    background: 'transparent',
    color: 'var(--vd-ink)',
    cursor: 'pointer',
  },
  keep: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    fontSize: 'var(--text-sm)',
    cursor: 'pointer',
  },
  error: {
    textAlign: 'center',
  },
  help: {
    margin: '4px 0 0',
    textAlign: 'center',
    letterSpacing: '1px',
    textTransform: 'none',
    fontSize: 'var(--text-sm)',
  },
}
