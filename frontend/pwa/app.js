/**
 * app.js — Field Ops PWA entry point
 * Handles auth guard, routing, and service worker registration.
 */

import { AuthScreen, PasswordChangeScreen, authStyles } from './src/screens/auth.js'
import { api }                   from './shared/api.js'
import { setCatalog, getCatalog } from './src/lib/db.js'
import { stopSync }              from './src/lib/sync.js'
import { stopCompletionSubmissionRetry } from './src/lib/completion-submission.mjs'

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
  if (typeof sessionStorage !== 'undefined' && sessionStorage) {
    sessionStorage.removeItem('workspace:visitId')
    sessionStorage.removeItem('workspace:cancelConfirmedVisitId')
    sessionStorage.removeItem('workspace:cancelConfirmed')
    sessionStorage.removeItem('fo_gps_state')
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
  if (session) {
    if (!['TECHNICIAN', 'technician'].includes(session.technician.role)) {
      localStorage.removeItem('technician')
      showAuth()
      return
    }
    api.get('/auth/me').then(({ user }) => {
      if (user.role !== 'TECHNICIAN') throw new Error('This account does not have FieldOps access')
      localStorage.setItem('technician', JSON.stringify(user))
      showAuthenticated(user)
    }).catch(() => {
      // Preserve offline operation when a previously authenticated technician has no network.
      if (navigator.onLine === false && session.technician.mustChangePassword) showPasswordChange()
      else if (navigator.onLine === false) showAuthenticated(session.technician)
      else showAuth()
    })
  } else {
    showAuth()
  }
}

async function preloadCatalog () {
  try {
    const storedVersion = await getCatalog('version')
    const cachedRelations = await getCatalog('item-relations')
    const catalogIsCurrent = storedVersion === CATALOG_VERSION
    if (catalogIsCurrent && Array.isArray(cachedRelations)) return

    const [items, equipment, linesetConfigs, itemRelations] = await Promise.all([
      catalogIsCurrent ? getCatalog('items') : api.get('/catalog/items'),
      catalogIsCurrent ? getCatalog('equipment') : api.get('/catalog/equipment'),
      catalogIsCurrent ? getCatalog('lineset-configs') : api.get('/catalog/lineset-configs'),
      Array.isArray(cachedRelations) ? cachedRelations : api.get('/catalog/item-relations'),
    ])
    await Promise.all([
      items && setCatalog('items', items),
      equipment && setCatalog('equipment', equipment),
      linesetConfigs && setCatalog('lineset-configs', linesetConfigs),
      setCatalog('item-relations', itemRelations),
    ])
    await setCatalog('version', CATALOG_VERSION)
  } catch (_) {
    // Offline or fetch failed — keep whatever's already cached and retry next load.
  }
}

function showAuth () {
  ++navSeq
  appEl.innerHTML = ''
  const screen = AuthScreen({ onSuccess: user => user.mustChangePassword ? showPasswordChange() : showAuthenticated(user) })
  appEl.appendChild(screen)
}

function showPasswordChange () {
  ++navSeq
  appEl.innerHTML = ''
  appEl.appendChild(PasswordChangeScreen({ onSuccess: showAuthenticated }))
}

function showAuthenticated () {
  import('./src/lib/queue.js').then(({ startQueueRetry }) => startQueueRetry())
  preloadCatalog()
  navigate('/')
}

boot()
