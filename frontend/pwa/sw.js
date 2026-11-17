/**
 * sw.js — Field Ops PWA Service Worker
 *
 * Cache strategy:
 *   - App shell (HTML, CSS, JS): Cache First
 *   - Catalog API responses: Cache First with background revalidation
 *   - All other API calls: Network First (never serve stale visit data)
 *   - Sync and auth endpoints: Network Only
 *
 * SHELL_CACHE is stamped by `npm run pwa:version` with a hash of the shell
 * assets; a test fails when the stamp is stale. Do not edit it by hand.
 */

const SHELL_CACHE  = 'fieldops-shell-ba3c7836de18'
const CATALOG_CACHE = 'fieldops-catalog-v1'

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/shared/api.js',
  '/src/screens/auth.js',
  '/src/screens/my-calls.js',
  '/src/screens/lobby.js',
  '/src/screens/workspace.js',
  '/src/screens/reports.js',
  '/src/screens/chat.js',
  '/src/screens/settings.js',
  '/src/screens/pay.js',
  '/src/screens/transfers.js',
  '/src/screens/transfers-incoming.js',
  '/src/components/job-card.js',
  '/src/components/nav-bar.js',
  '/src/components/home-tabs.js',
  '/src/components/badge.js',
  '/src/components/calc-panel.js',
  '/src/components/correction-modal.js',
  '/src/components/menu-sheet.js',
  '/src/components/notifications.js',
  '/src/lib/db.js',
  '/src/lib/sync.js',
  '/src/lib/queue.js',
  '/src/lib/pending-starts.mjs',
  '/src/lib/photo-upload.mjs',
  '/src/lib/report-download.mjs',
  '/src/lib/zip.mjs',
  '/src/lib/cancel-confirmation.mjs',
  '/src/lib/cancel-justification.mjs',
  '/src/lib/completion-submission.mjs',
  '/src/lib/job-card-actions.mjs',
  '/src/lib/menu-badge.mjs',
  '/src/lib/my-calls-visit.mjs',
  '/src/lib/workspace-visit.mjs',
  '/src/lib/session-boot.mjs',
  '/src/lib/guided-context.mjs',
  '/src/vendor/exifr-lite.mjs',
  '/src/screens/guided.js',
  '/shared/i18n.js',
  '/shared/pricing.mjs',
  '/shared/tokens.css',
  '/guided/guided.js',
  '/guided/shared/i18n.js',
  '/guided/src/camera.mjs',
  '/guided/src/ficha.mjs',
  '/guided/src/guide.mjs',
  '/guided/src/layout.mjs',
  '/guided/src/model.mjs',
  '/guided/src/render.mjs',
  '/guided/data/guided-component-library.v0.1.json',
  '/guided/data/ut3000-comm.system.json',
  '/guided/data/ut3000-comm.guide.json',
]

const CATALOG_PATHS = [
  '/api/catalog/items',
  '/api/catalog/equipment',
  '/api/catalog/lineset-configs',
  '/api/catalog/item-relations',
  '/api/catalog/services',
]

const NETWORK_ONLY_PATHS = [
  '/api/auth/',
  '/api/sync/',
]

const REFRESH_ON_INSTALL = new Set([
  '/app.js',
  '/src/screens/reports.js',
  '/src/lib/completion-submission.mjs',
  '/src/screens/lobby.js',
  '/src/screens/transfers-incoming.js',
])

// ── Install: pre-cache the app shell ──────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache =>
      Promise.all(
        SHELL_ASSETS.map(async asset => {
          try {
            const isStyle = asset.endsWith('.css')
            if (!REFRESH_ON_INSTALL.has(asset)) {
              const existing = await cache.match(asset)
              if (existing && existing.ok && (!isStyle || (existing.headers.get('content-type') || '').includes('text/css'))) {
                return
              }
            }
            // A new shell version must not be filled from the HTTP cache.
            const req = isStyle
              ? new Request(asset, { cache: 'reload', headers: { Accept: 'text/css,*/*;q=0.1' } })
              : new Request(asset, { cache: 'reload' })
            const res = await fetch(req)
            if (res.ok && (!isStyle || (res.headers.get('content-type') || '').includes('text/css'))) {
              await cache.put(asset, res)
            }
          } catch (_) {
            // Keep install resilient if an individual asset fetch fails offline
          }
        })
      )
    )
  )
  self.skipWaiting()
})

// ── Activate: remove old caches ───────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    const staleKeys = keys.filter(k => k !== SHELL_CACHE && k !== CATALOG_CACHE)
    await Promise.all(staleKeys.map(k => caches.delete(k)))
    await self.clients.claim()
  })())
})

// ── Fetch: route by strategy ──────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)

  // Non-GET or cross-origin: pass through
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return
  }

  // Vite dev client and internal paths: pass through without caching
  if (
    url.pathname.startsWith('/@vite/') ||
    url.pathname.startsWith('/@fs/') ||
    url.pathname.startsWith('/node_modules/')
  ) {
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
  const url = new URL(request.url)
  const isStyle = request.destination === 'style' || url.pathname.endsWith('.css')
  const isValidResponse = res =>
    res && res.ok && (!isStyle || (res.headers.get('content-type') || '').includes('text/css'))

  const cached = (await caches.match(request)) ?? (await caches.match(url.pathname))
  if (isValidResponse(cached)) {
    return cached
  }

  const fetchReq = isStyle
    ? new Request(request.url, { headers: { Accept: 'text/css,*/*;q=0.1' } })
    : request

  try {
    const response = await fetch(fetchReq)
    if (isValidResponse(response)) {
      const cache = await caches.open(SHELL_CACHE)
      await cache.put(url.pathname, response.clone())
    }
    return response
  } catch (err) {
    if (cached) return cached
    throw err
  }
}

async function catalogStrategy (request) {
  const cache  = await caches.open(CATALOG_CACHE)
  const cached = await cache.match(request)
  const fetchPromise = fetch(request).then(async response => {
    if (response.ok) {
      // Versioned catalog requests (?v=) replace older copies of the same path.
      const path = new URL(request.url).pathname
      const stale = (await cache.keys()).filter(key => new URL(key.url).pathname === path && key.url !== request.url)
      await Promise.all(stale.map(key => cache.delete(key)))
      await cache.put(request, response.clone())
    }
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
