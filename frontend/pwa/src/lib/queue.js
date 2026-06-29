/**
 * src/lib/queue.js
 * Offline completion queue.
 * Wraps IndexedDB enqueue/dequeue for the completion retry loop.
 * The background retry is started from app.js after auth succeeds.
 */

import { api }           from '../../../shared/api.js'
import { enqueue as dbEnqueue, getQueue, dequeue } from './db.js'

export { dbEnqueue as enqueue }

export async function processQueue () {
  const queue = await getQueue()
  if (!queue.length) return

  for (const entry of queue) {
    if (!navigator.onLine) break
    try {
      await api.post(`/visits/${entry.visitId}/complete`)
      await dequeue(entry.id)
      window.dispatchEvent(new CustomEvent('queue:sent', { detail: { visitId: entry.visitId } }))
    } catch (err) {
      if (err.status === 422) {
        // Already completed — remove from queue
        await dequeue(entry.id)
      }
      // Other errors: leave in queue, retry next cycle
    }
  }
}

// Start background retry — called once after auth
export function startQueueRetry (intervalMs = 30_000) {
  window.addEventListener('online', processQueue)
  setInterval(() => { if (navigator.onLine) processQueue() }, intervalMs)
}
