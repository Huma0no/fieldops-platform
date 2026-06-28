/**
 * app.js — Field Ops PWA entry point
 * Handles auth guard, routing, and service worker registration.
 */

import { AuthScreen, authStyles } from './src/screens/auth.js'

// ── Register service worker ────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.error('SW registration failed:', err)
    })
  })
}

// ── Inject base styles ─────────────────────────────────────
function injectStyles (...styleStrings) {
  const style = document.createElement('style')
  style.textContent = styleStrings.join('\n')
  document.head.appendChild(style)
}

const baseStyles = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  html, body {
    height: 100%;
    background: var(--surface-base);
    color: var(--text-primary);
    font-family: var(--font-sans);
    -webkit-font-smoothing: antialiased;
    overscroll-behavior: none;
  }

  #app {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
`

// ── Auth state ─────────────────────────────────────────────
function getSession () {
  const token = localStorage.getItem('deviceToken')
  const raw   = localStorage.getItem('technician')
  if (!token || !raw) return null
  try {
    return { token, technician: JSON.parse(raw) }
  } catch (_) {
    return null
  }
}

function clearSession () {
  localStorage.removeItem('deviceToken')
  localStorage.removeItem('technician')
}

// ── Routing ────────────────────────────────────────────────
// Screens are lazy-loaded to keep initial bundle small.
// Each route handler is responsible for mounting/unmounting its content.

const routes = {
  '/':          () => import('./src/screens/my-calls.js'),
  '/lobby':     () => import('./src/screens/lobby.js'),
  '/reports':   () => import('./src/screens/reports.js'),
  '/chat':      () => import('./src/screens/chat.js'),
  '/settings':  () => import('./src/screens/settings.js'),
  '/workspace': () => import('./src/screens/workspace.js'),
}

const appEl = document.getElementById('app')

async function navigate (path) {
  const loader = routes[path] ?? routes['/']
  const mod    = await loader()
  // Each screen module exports a default render function
  mod.default(appEl)
}

// ── Bootstrap ──────────────────────────────────────────────
function boot () {
  injectStyles(baseStyles, authStyles)

  // Listen for token expiry (fired by api.js on 401)
  window.addEventListener('auth:expired', () => {
    clearSession()
    showAuth()
  })

  const session = getSession()
  if (session) {
    // Valid session found — go to My Calls
    navigate('/')
  } else {
    showAuth()
  }
}

function showAuth () {
  appEl.innerHTML = ''
  const screen = AuthScreen({
    onSuccess: (technician) => {
      console.info('Auth success:', technician.name)
      navigate('/')
    }
  })
  appEl.appendChild(screen)
}

boot()
