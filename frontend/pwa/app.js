/**
 * app.js — Field Ops PWA entry point
 * Handles auth guard, routing, and service worker registration.
 */

import { AuthScreen, PasswordChangeScreen, authStyles } from './src/screens/auth.js'
import { api }                   from './shared/api.js'
import { setCatalog, getCatalog, getActiveTechnicianId } from './src/lib/db.js'
import { stopSync }              from './src/lib/sync.js'
import { stopCompletionSubmissionRetry } from './src/lib/completion-submission.mjs'
import { resolveBootScreen }   from './src/lib/session-boot.mjs'

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
  const raw   = localStorage.getItem('technician')
  if (!raw) return null
  try {
    return { technician: JSON.parse(raw) }
  } catch (_) {
    return null
  }
}

function clearSession () {
  stopSync()
  stopCompletionSubmissionRetry()
  localStorage.removeItem('technician')
  localStorage.removeItem('guided:activeCall')
  if (typeof sessionStorage !== 'undefined' && sessionStorage) {
    sessionStorage.removeItem('workspace:visitId')
    sessionStorage.removeItem('workspace:cancelConfirmedVisitId')
    sessionStorage.removeItem('workspace:cancelConfirmed')
    sessionStorage.removeItem('fo_gps_state')
    sessionStorage.removeItem('guided:return')
  }
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
  '/guided':    () => import('./src/screens/guided.js'),
  '/transfers':          () => import('./src/screens/transfers.js'),
  '/transfers/incoming': () => import('./src/screens/transfers-incoming.js'),
}

const appEl = document.getElementById('app')
let navSeq = 0

async function navigate (path) {
  const seq    = ++navSeq
  // Strip query string for route matching
  const base   = path.split('?')[0]
  const loader = routes[base] ?? routes['/']
  try {
    const mod = await loader()
    if (seq !== navSeq) return
    await mod.default(appEl)
  } catch (err) {
    console.error('Navigation failed:', err)
  }
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
  resolveBootScreen(session?.technician ?? null, () => api.get('/auth/me')).then(result => {
    if (result.clear) localStorage.removeItem('technician')
    if (result.store) localStorage.setItem('technician', JSON.stringify(result.user))
    if (result.screen === 'app') showAuthenticated(result.user)
    else if (result.screen === 'passwordChange') showPasswordChange()
    else showAuth()
  })
}

// The server's catalog version is a hash of the catalog data; a change
// replaces the device copy. Offline, the cached copy stays in use.
async function preloadCatalog () {
  // The technician's own prices are not part of the catalog version; refresh
  // them whenever the server is reachable so local pricing matches it.
  const technicianId = getActiveTechnicianId()
  if (technicianId) {
    api.get('/technicians/me/price-overrides')
      .then(rows => setCatalog(`price-overrides:${technicianId}`, rows))
      .catch(() => {})
  }
  try {
    const { version } = await api.get('/catalog/version')
    const [storedVersion, cachedServices] = await Promise.all([getCatalog('version'), getCatalog('services')])
    if (storedVersion === version && Array.isArray(cachedServices)) return

    // The query string keys a fresh copy past the service worker's catalog cache.
    const query = `?v=${encodeURIComponent(version)}`
    const [items, equipment, manufacturers, itemRelations, services] = await Promise.all([
      api.get(`/catalog/items${query}`),
      api.get(`/catalog/equipment${query}`),
      api.get(`/catalog/manufacturers${query}`),
      api.get(`/catalog/item-relations${query}`),
      api.get(`/catalog/services${query}`),
    ])
    await Promise.all([
      setCatalog('items', items),
      setCatalog('equipment', equipment),
      setCatalog('manufacturers', manufacturers),
      setCatalog('item-relations', itemRelations),
      setCatalog('services', services),
    ])
    await setCatalog('version', version)
  } catch (_) {
    // Offline or fetch failed — keep whatever's already cached and retry next load.
  }
}

// Several requests can fail with 401 at once after reconnecting; render the
// sign-in screen once so the technician's typing is not reset.
let authScreenShown = false

function showAuth () {
  if (authScreenShown) return
  authScreenShown = true
  ++navSeq
  appEl.innerHTML = ''
  const screen = AuthScreen({ onSuccess: user => user.mustChangePassword ? showPasswordChange() : showAuthenticated(user) })
  appEl.appendChild(screen)
}

function showPasswordChange () {
  authScreenShown = false
  ++navSeq
  appEl.innerHTML = ''
  appEl.appendChild(PasswordChangeScreen({ onSuccess: showAuthenticated }))
}

function showAuthenticated () {
  authScreenShown = false
  import('./src/lib/queue.js').then(({ startQueueRetry }) => startQueueRetry())
  preloadCatalog()
  navigate('/')
}

boot()
