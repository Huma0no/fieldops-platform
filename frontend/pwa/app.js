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
const routes = {
  '/':          () => import('./src/screens/my-calls.js'),
  '/lobby':     () => import('./src/screens/lobby.js'),
  '/reports':   () => import('./src/screens/reports.js'),
  '/chat':      () => import('./src/screens/chat.js'),
  '/settings':  () => import('./src/screens/settings.js'),
  '/workspace': () => import('./src/screens/workspace.js'),
  '/pay':       () => import('./src/screens/pay.js'),
}

const appEl = document.getElementById('app')

async function navigate (path) {
  // Strip query string for route matching
  const base   = path.split('?')[0]
  const loader = routes[base] ?? routes['/']
  const mod    = await loader()
  mod.default(appEl)
}

// ── Bootstrap ──────────────────────────────────────────────
function boot () {
  injectStyles(baseStyles, authStyles)

  // Token expiry — fired by api.js on 401
  window.addEventListener('auth:expired', () => {
    clearSession()
    showAuth()
  })

  // Internal navigation events from screens
  window.addEventListener('app:navigate', e => {
    const { route } = e.detail ?? {}
    if (route) navigate(route)
  })

  const session = getSession()
  if (session) {
    navigate('/')
  } else {
    showAuth()
  }
}

function showAuth () {
  appEl.innerHTML = ''
  const screen = AuthScreen({
    onSuccess: () => {
      import('./src/lib/queue.js').then(({ startQueueRetry }) => startQueueRetry())
      navigate('/')
    }
  })
  appEl.appendChild(screen)
}

boot()
