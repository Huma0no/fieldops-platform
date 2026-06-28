/**
 * src/screens/auth.js
 * Invite code redemption screen.
 * Shown only on first launch or after token revocation.
 */

import { api } from '../../../shared/api.js'

export function AuthScreen ({ onSuccess }) {
  const el = document.createElement('div')
  el.className = 'auth-screen'

  el.innerHTML = `
    <div class="auth-inner">
      <div class="auth-logo">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
          <rect width="40" height="40" rx="10" fill="var(--color-signal)"/>
          <path d="M12 28 L20 12 L28 28" stroke="white" stroke-width="2.5"
                stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M15 22 L25 22" stroke="white" stroke-width="2.5"
                stroke-linecap="round"/>
        </svg>
      </div>
      <h1 class="auth-title">Field Ops</h1>
      <p class="auth-subtitle">Enter your invite code to get started.</p>

      <div class="auth-form">
        <input
          id="invite-input"
          class="auth-input"
          type="text"
          inputmode="text"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          placeholder="XXXX-XXXX"
          maxlength="9"
        />
        <p id="auth-error" class="auth-error" aria-live="polite"></p>
        <button id="auth-submit" class="auth-btn">
          <span id="auth-btn-label">Activate device</span>
          <span id="auth-btn-spinner" class="spinner hidden" aria-hidden="true"></span>
        </button>
      </div>

      <p class="auth-help">Contact your dispatcher if you don't have a code.</p>
    </div>
  `

  const input   = el.querySelector('#invite-input')
  const btn     = el.querySelector('#auth-submit')
  const label   = el.querySelector('#auth-btn-label')
  const spinner = el.querySelector('#auth-btn-spinner')
  const error   = el.querySelector('#auth-error')

  // Auto-format input as user types: insert dash after 4 chars
  input.addEventListener('input', () => {
    let val = input.value.replace(/[^A-Z0-9a-z]/g, '').toUpperCase()
    if (val.length > 4) val = val.slice(0, 4) + '-' + val.slice(4, 8)
    input.value = val
    error.textContent = ''
  })

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') btn.click()
  })

  btn.addEventListener('click', async () => {
    const code = input.value.replace('-', '').trim()
    if (code.length < 8) {
      error.textContent = 'Enter a valid 8-character code.'
      input.focus()
      return
    }

    setLoading(true)
    error.textContent = ''

    try {
      const data = await api.post('/auth/redeem-invite', { inviteCode: input.value.trim() })
      localStorage.setItem('deviceToken', data.deviceToken)
      localStorage.setItem('technician', JSON.stringify(data.technician))
      onSuccess(data.technician)
    } catch (err) {
      if (err.status === 400 || err.status === 404) {
        error.textContent = 'Invalid or expired invite code. Check with your dispatcher.'
      } else if (err.status === 409) {
        error.textContent = 'This code has already been used. Contact your dispatcher.'
      } else {
        error.textContent = 'Connection error. Check your internet and try again.'
      }
      input.focus()
    } finally {
      setLoading(false)
    }
  })

  function setLoading (loading) {
    btn.disabled = loading
    label.textContent = loading ? 'Activating…' : 'Activate device'
    spinner.classList.toggle('hidden', !loading)
  }

  return el
}

// ── Styles ────────────────────────────────────────────────

export const authStyles = `
  .auth-screen {
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-6);
    background: var(--surface-base);
  }

  .auth-inner {
    width: 100%;
    max-width: 320px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
  }

  .auth-logo {
    margin-bottom: var(--space-2);
  }

  .auth-title {
    font-size: var(--text-xl);
    font-weight: 500;
    color: var(--text-primary);
    letter-spacing: -0.02em;
  }

  .auth-subtitle {
    font-size: var(--text-base);
    color: var(--text-muted);
    text-align: center;
    margin-top: -var(--space-2);
  }

  .auth-form {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-top: var(--space-2);
  }

  .auth-input {
    width: 100%;
    background: var(--surface-2);
    border: 0.5px solid var(--border-default);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font-size: var(--text-lg);
    font-family: var(--font-mono);
    letter-spacing: 0.12em;
    padding: var(--space-4);
    text-align: center;
    outline: none;
    transition: border-color var(--dur-fast) var(--ease-out);
  }

  .auth-input:focus {
    border-color: var(--color-signal);
  }

  .auth-input::placeholder {
    color: var(--text-disabled);
    letter-spacing: 0.08em;
  }

  .auth-error {
    font-size: var(--text-sm);
    color: var(--color-heat);
    text-align: center;
    min-height: 18px;
  }

  .auth-btn {
    width: 100%;
    background: var(--color-signal);
    border: none;
    border-radius: var(--radius-md);
    color: #fff;
    font-size: var(--text-base);
    font-weight: 500;
    padding: var(--space-4);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .auth-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .auth-help {
    font-size: var(--text-sm);
    color: var(--text-disabled);
    text-align: center;
    margin-top: var(--space-2);
  }

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  .hidden { display: none; }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`
