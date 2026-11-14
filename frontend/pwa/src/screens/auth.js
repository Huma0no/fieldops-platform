/**
 * src/screens/auth.js
 * Shared username and password login for FieldOps.
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
      <p class="auth-subtitle">Sign in to Field Ops.</p>

      <div class="auth-form">
        <input
          id="username-input"
          class="auth-input"
          type="text"
          autocomplete="username"
          autocapitalize="none"
          spellcheck="false"
          placeholder="Username"
        />
        <input id="password-input" class="auth-input" type="password" autocomplete="current-password" placeholder="Password" />
        <p id="auth-error" class="auth-error" aria-live="polite"></p>
        <button id="auth-submit" class="auth-btn">
          <span id="auth-btn-label">Sign in</span>
          <span id="auth-btn-spinner" class="spinner hidden" aria-hidden="true"></span>
        </button>
      </div>

      <p class="auth-help">Contact your Dispatch Owner if you need access.</p>
    </div>
  `

  const input   = el.querySelector('#username-input')
  const passwordInput = el.querySelector('#password-input')
  const btn     = el.querySelector('#auth-submit')
  const label   = el.querySelector('#auth-btn-label')
  const spinner = el.querySelector('#auth-btn-spinner')
  const error   = el.querySelector('#auth-error')

  input.addEventListener('input', () => {
    error.textContent = ''
  })

  for (const field of [input, passwordInput]) field.addEventListener('keydown', e => {
    if (e.key === 'Enter') btn.click()
  })

  btn.addEventListener('click', async () => {
    if (!input.value.trim() || !passwordInput.value) {
      error.textContent = 'Enter your username and password.'
      input.focus()
      return
    }

    setLoading(true)
    error.textContent = ''

    try {
      const data = await api.post('/auth/login', { username: input.value, password: passwordInput.value })
      if (data.user.role !== 'TECHNICIAN') {
        await api.post('/auth/logout', {}).catch(() => {})
        error.textContent = 'This account does not have FieldOps access.'
        return
      }
      localStorage.setItem('technician', JSON.stringify(data.user))
      onSuccess(data.user)
    } catch (err) {
      if (err.status === 401) {
        error.textContent = 'Invalid username or password.'
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
    label.textContent = loading ? 'Signing in…' : 'Sign in'
    spinner.classList.toggle('hidden', !loading)
  }

  return el
}

export function PasswordChangeScreen ({ onSuccess }) {
  const el = document.createElement('div')
  el.className = 'auth-screen'
  el.innerHTML = `<form class="auth-inner">
    <h1 class="auth-title">Change your temporary password</h1>
    <p class="auth-subtitle">Choose a password with at least 12 characters.</p>
    <input id="current-password" class="auth-input" type="password" autocomplete="current-password" placeholder="Temporary password" required />
    <input id="new-password" class="auth-input" type="password" autocomplete="new-password" placeholder="New password" required minlength="12" />
    <input id="confirm-password" class="auth-input" type="password" autocomplete="new-password" placeholder="Confirm new password" required minlength="12" />
    <p id="password-error" class="auth-error" aria-live="polite"></p>
    <button class="auth-btn" type="submit">Update password</button>
  </form>`
  const form = el.querySelector('form')
  const error = el.querySelector('#password-error')
  form.addEventListener('submit', async event => {
    event.preventDefault()
    const currentPassword = el.querySelector('#current-password').value
    const newPassword = el.querySelector('#new-password').value
    const confirmedPassword = el.querySelector('#confirm-password').value
    if (newPassword !== confirmedPassword) {
      error.textContent = 'Passwords do not match.'
      return
    }
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword })
      const user = JSON.parse(localStorage.getItem('technician') ?? '{}')
      user.mustChangePassword = false
      localStorage.setItem('technician', JSON.stringify(user))
      onSuccess(user)
    } catch (err) {
      error.textContent = err.message ?? 'Password change failed.'
    }
  })
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
