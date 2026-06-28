/**
 * src/lib/sync.js
 * Polling-based sync against GET /api/sync/changes?since=
 *
 * - Polls every POLL_INTERVAL ms while the tab is visible
 * - Pauses on visibilitychange (backgrounded)
 * - Dispatches 'sync:update' CustomEvent with changed data
 * - Callers listen for 'sync:update' to re-render
 *
 * Usage:
 *   import { startSync, stopSync, forcSync } from '../lib/sync.js'
 *   startSync()
 *   window.addEventListener('sync:update', e => handleUpdate(e.detail))
 */

import { api } from '../../../shared/api.js'

const POLL_INTERVAL = 20_000   // 20 seconds
const STORAGE_KEY   = 'sync:lastAt'

let _timer    = null
let _running  = false

function getLastAt () {
  return localStorage.getItem(STORAGE_KEY) ?? new Date(0).toISOString()
}

function setLastAt (iso) {
  localStorage.setItem(STORAGE_KEY, iso)
}

async function poll () {
  const since = getLastAt()
  try {
    const data = await api.get(`/sync/changes?since=${encodeURIComponent(since)}`)
    if (data) {
      setLastAt(data.serverTime ?? new Date().toISOString())
      window.dispatchEvent(new CustomEvent('sync:update', { detail: data }))
    }
  } catch (err) {
    // 401 handled by api.js (fires auth:expired)
    // Other errors: log silently, retry on next interval
    if (err.status !== 401) {
      console.warn('Sync poll failed:', err.message)
    }
  }
}

function onVisibilityChange () {
  if (document.hidden) {
    pause()
  } else {
    resume()
  }
}

function pause () {
  if (_timer) {
    clearInterval(_timer)
    _timer = null
  }
}

function resume () {
  if (!_running) return
  poll()   // immediate poll on resume
  _timer = setInterval(poll, POLL_INTERVAL)
}

export function startSync () {
  if (_running) return
  _running = true
  document.addEventListener('visibilitychange', onVisibilityChange)
  resume()
}

export function stopSync () {
  _running = false
  pause()
  document.removeEventListener('visibilitychange', onVisibilityChange)
}

// Manual trigger — called by pull-to-refresh
export async function forceSync () {
  await poll()
}
