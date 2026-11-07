/**
 * Self-unregistering service worker for Dispatch.
 * Evicts any stale FieldOps PWA service worker and CacheStorage entries
 * previously registered on this origin/port during local development.
 */
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.map(key => caches.delete(key)))
    await self.registration.unregister()
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clients) {
      client.navigate(client.url)
    }
  })())
})
