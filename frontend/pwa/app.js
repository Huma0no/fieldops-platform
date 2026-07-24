/**
 * app.js — Field Ops PWA entry point
 * Handles auth guard, routing, and service worker registration.
 */

import { AuthScreen, authStyles } from './src/screens/auth.js'
import { api }                   from './shared/api.js'
import { setCatalog, getCatalog } from './src/lib/db.js'

// Bump when catalog data changes server-side (e.g. after a DB cleanup) so
// cached IndexedDB catalog data on already-installed clients gets replaced.
const CATALOG_VERSION = 'v2'

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
  '/transfers':          () => import('./src/screens/transfers.js'),
  '/transfers/incoming': () => import('./src/screens/transfers-incoming.js'),
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
    preloadCatalog()
    navigate('/')
  } else {
    showAuth()
  }
}

async function preloadCatalog () {
  try {
    const storedVersion = await getCatalog('version')
    if (storedVersion === CATALOG_VERSION) return

    const [items, equipment, linesetConfigs] = await Promise.all([
      api.get('/catalog/items'),
      api.get('/catalog/equipment'),
      api.get('/catalog/lineset-configs'),
    ])
    await Promise.all([
      setCatalog('items', items),
      setCatalog('equipment', equipment),
      setCatalog('lineset-configs', linesetConfigs),
    ])
    await setCatalog('version', CATALOG_VERSION)
  } catch (_) {
    // Offline or fetch failed — keep whatever's already cached and retry next load.
  }
}

function showAuth () {
  appEl.innerHTML = ''
  const screen = AuthScreen({
    onSuccess: () => {
      import('./src/lib/queue.js').then(({ startQueueRetry }) => startQueueRetry())
      preloadCatalog()
      navigate('/')
    }
  })
  appEl.appendChild(screen)
}

boot()
