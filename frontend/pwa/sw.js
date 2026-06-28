/**
 * sw.js — Field Ops PWA Service Worker
 *
 * Cache strategy:
 *   - App shell (HTML, CSS, JS): Cache First
 *   - Catalog API responses: Cache First with background revalidation
 *   - All other API calls: Network First (never serve stale visit data)
 *   - Sync and auth endpoints: Network Only
 */

const SHELL_CACHE  = 'fieldops-shell-v1'
const CATALOG_CACHE = 'fieldops-catalog-v1'

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/src/screens/auth.js',
  '/src/screens/my-calls.js',
  '/src/screens/lobby.js',
  '/src/screens/workspace.js',
  '/src/screens/reports.js',
  '/src/screens/chat.js',
  '/src/screens/settings.js',
  '/src/components/job-card.js',
  '/src/components/nav-bar.js',
  '/src/components/modal.js',
  '/src/components/badge.js',
  '/src/lib/db.js',
  '/src/lib/sync.js',
  '/src/lib/queue.js',
  '/shared/tokens.css',
]

const CATALOG_PATHS = [
  '/api/catalog/items',
  '/api/catalog/equipment',
  '/api/catalog/lineset-configs',
]

const NETWORK_ONLY_PATHS = [
  '/api/auth/',
  '/api/sync/',
]

// ── Install: pre-cache the app shell ──────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_ASSETS))
  )
  self.skipWaiting()
})

// ── Activate: remove old caches ───────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== SHELL_CACHE && k !== CATALOG_CACHE)
          .map(k => caches.delete(k))
      )
    )
  )
  self.clients.claim()
})

// ── Fetch: route by strategy ──────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)

  // Non-GET or cross-origin: pass through
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return
  }

  // Network Only: auth + sync endpoints
  if (NETWORK_ONLY_PATHS.some(p => url.pathname.startsWith(p))) {
    return
  }

  // Catalog API: Cache First with background revalidation
  if (CATALOG_PATHS.some(p => url.pathname === p)) {
    event.respondWith(catalogStrategy(request))
    return
  }

  // App shell assets: Cache First
  if (!url.pathname.startsWith('/api/')) {
    event.respondWith(shellStrategy(request))
    return
  }

  // All other API calls: Network First
  event.respondWith(networkFirst(request))
})

async function shellStrategy (request) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) {
    const cache = await caches.open(SHELL_CACHE)
    cache.put(request, response.clone())
  }
  return response
}

async function catalogStrategy (request) {
  const cache  = await caches.open(CATALOG_CACHE)
  const cached = await cache.match(request)
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone())
    return response
  })
  return cached ?? fetchPromise
}

async function networkFirst (request) {
  try {
    const response = await fetch(request)
    return response
  } catch (_) {
    const cached = await caches.match(request)
    if (cached) return cached
    return new Response(
      JSON.stringify({ error: 'Offline and no cached response available.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
