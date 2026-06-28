/**
 * src/screens/Auth.jsx
 * Invite code redemption screen for the Dispatch panel.
 * Same invite flow as the PWA — dispatchers are created via invite code.
 */

import { useState } from 'react'
import { api } from '@shared/api.js'
import { useAuth } from '../lib/auth.jsx'

export default function Auth () {
  const { login }   = useAuth()
  const [code, setCode]       = useState('')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)

  function formatCode (raw) {
    const clean = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8)
    return clean.length > 4 ? clean.slice(0, 4) + '-' + clean.slice(4) : clean
  }

  function handleInput (e) {
    setCode(formatCode(e.target.value))
    setError('')
  }

  async function handleSubmit (e) {
    e.preventDefault()
    const raw = code.replace('-', '').trim()
    if (raw.length < 8) {
      setError('Enter a valid 8-character code.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const data = await api.post('/auth/redeem-invite', { inviteCode: code.trim() })
      login(data.deviceToken, data.technician)
    } catch (err) {
      if (err.status === 400 || err.status === 404) {
        setError('Invalid or expired invite code. Check with your administrator.')
      } else if (err.status === 409) {
        setError('This code has already been used. Request a new one.')
      } else {
        setError('Connection error. Check your network and try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <svg width="44" height="44" viewBox="0 0 40 40" fill="none">
            <rect width="40" height="40" rx="10" fill="var(--color-signal)"/>
            <path d="M12 28 L20 12 L28 28" stroke="white" strokeWidth="2.5"
                  strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M15 22 L25 22" stroke="white" strokeWidth="2.5"
                  strokeLinecap="round"/>
          </svg>
        </div>

        <h1 style={styles.title}>Field Ops Dispatch</h1>
        <p style={styles.subtitle}>Enter your invite code to access the dispatch panel.</p>

        <form onSubmit={handleSubmit} style={styles.form} noValidate>
          <input
            type="text"
            value={code}
            onChange={handleInput}
            onKeyDown={e => e.key === 'Enter' && handleSubmit(e)}
            placeholder="XXXX-XXXX"
            maxLength={9}
            autoComplete="off"
            spellCheck={false}
            style={styles.input}
          />

          {error && <p style={styles.error}>{error}</p>}

          <button type="submit" disabled={loading} style={styles.btn}>
            {loading ? 'Activating…' : 'Activate'}
          </button>
        </form>

        <p style={styles.help}>Contact your administrator if you don't have a code.</p>
      </div>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100dvh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--surface-base)',
    padding: '24px',
  },
  card: {
    width: '100%',
    maxWidth: '360px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
  },
  logo: {
    marginBottom: '8px',
  },
  title: {
    fontSize: 'var(--text-xl)',
    fontWeight: 500,
    color: 'var(--text-primary)',
    letterSpacing: '-0.02em',
  },
  subtitle: {
    fontSize: 'var(--text-base)',
    color: 'var(--text-muted)',
    textAlign: 'center',
  },
  form: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    marginTop: '8px',
  },
  input: {
    width: '100%',
    background: 'var(--surface-2)',
    border: '0.5px solid var(--border-default)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--text-primary)',
    fontSize: 'var(--text-lg)',
    fontFamily: 'var(--font-mono)',
    letterSpacing: '0.12em',
    padding: '16px',
    textAlign: 'center',
    outline: 'none',
  },
  error: {
    fontSize: 'var(--text-sm)',
    color: 'var(--color-heat)',
    textAlign: 'center',
  },
  btn: {
    width: '100%',
    background: 'var(--color-signal)',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    color: '#fff',
    fontSize: 'var(--text-base)',
    fontWeight: 500,
    padding: '16px',
    cursor: 'pointer',
  },
  help: {
    fontSize: 'var(--text-sm)',
    color: 'var(--text-disabled)',
    textAlign: 'center',
    marginTop: '8px',
  },
}
