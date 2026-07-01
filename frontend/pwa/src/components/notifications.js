/**
 * src/components/notifications.js
 * F9 — Notification bell + panel for PWA.
 * Mounted in the My Calls header. Polled via sync:update.
 */

import { api } from '../../../shared/api.js'

const NOTIFICATION_ROUTES = {
  assignment:          '/',
  transfer_request:    '/transfers',
  transfer_accepted:   '/',
  transfer_rejected:   '/',
  message:             '/chat',
  broadcast:           '/chat',
  correction_approved: '/reports',
  correction_rejected: '/reports',
}

let unreadCount = 0
let bellEl      = null
let badgeEl     = null

export function NotificationBell (onNavigate) {
  const wrap = document.createElement('div')
  wrap.style.position = 'relative'

  bellEl = document.createElement('button')
  bellEl.className = 'header-bell'
  bellEl.setAttribute('aria-label', 'Notifications')
  bellEl.innerHTML = `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
  `

  badgeEl = document.createElement('span')
  badgeEl.className = 'notif-badge hidden'
  wrap.appendChild(bellEl)
  wrap.appendChild(badgeEl)

  bellEl.addEventListener('click', () => togglePanel(onNavigate))

  // Listen for sync updates
  window.addEventListener('sync:update', e => {
    const { unreadNotificationCount } = e.detail ?? {}
    if (unreadNotificationCount !== undefined) {
      updateBadge(unreadNotificationCount)
    }
  })

  // Initial load
  loadUnreadCount()

  return wrap
}

async function loadUnreadCount () {
  try {
    const data = await api.get('/notifications/mine?unreadOnly=true')
    updateBadge(data?.length ?? 0)
  } catch (_) {}
}

function updateBadge (count) {
  unreadCount = count
  if (!badgeEl) return
  if (count > 0) {
    badgeEl.textContent = count > 9 ? '9+' : count
    badgeEl.classList.remove('hidden')
  } else {
    badgeEl.classList.add('hidden')
  }
}

function togglePanel (onNavigate) {
  const existing = document.getElementById('notif-panel')
  if (existing) { existing.remove(); return }
  openPanel(onNavigate)
}

async function openPanel (onNavigate) {
  const panel = document.createElement('div')
  panel.id = 'notif-panel'
  panel.className = 'notif-panel'
  panel.innerHTML = '<p class="notif-loading">Loading…</p>'

  // Position below the bell
  const rect = bellEl.getBoundingClientRect()
  panel.style.top   = `${rect.bottom + 8}px`
  panel.style.right = `${window.innerWidth - rect.right}px`

  document.body.appendChild(panel)

  // Close on outside click
  function close (e) {
    if (!panel.contains(e.target) && e.target !== bellEl) {
      panel.remove()
      document.removeEventListener('click', close)
    }
  }
  setTimeout(() => document.addEventListener('click', close), 0)

  try {
    const data = await api.get('/notifications/mine')
    renderPanel(panel, data ?? [], onNavigate)
    // Mark all read
    const unread = (data ?? []).filter(n => !n.read_at)
    unread.forEach(n => api.patch(`/notifications/${n.id}/mark-read`).catch(() => {}))
    updateBadge(0)
  } catch (err) {
    panel.innerHTML = '<p class="notif-loading">Could not load notifications.</p>'
  }
}

function renderPanel (panel, notifications, onNavigate) {
  panel.innerHTML = ''

  const header = document.createElement('p')
  header.className = 'notif-panel-title'
  header.textContent = 'Notifications'
  panel.appendChild(header)

  if (!notifications.length) {
    const empty = document.createElement('p')
    empty.className = 'notif-empty'
    empty.textContent = 'No notifications.'
    panel.appendChild(empty)
    return
  }

  notifications.slice(0, 20).forEach(n => {
    const row = document.createElement('button')
    row.className = `notif-row ${!n.read_at ? 'notif-row--unread' : ''}`
    row.innerHTML = `
      <p class="notif-body">${n.body ?? formatType(n.type)}</p>
      <p class="notif-time">${formatTime(n.created_at)}</p>
    `
    row.addEventListener('click', () => {
      panel.remove()
      const route = NOTIFICATION_ROUTES[n.type] ?? '/'
      onNavigate(route)
    })
    panel.appendChild(row)
  })
}

function formatType (type) {
  const map = {
    assignment:          'New visit assigned',
    transfer_request:    'Transfer request received',
    transfer_accepted:   'Transfer accepted',
    transfer_rejected:   'Transfer rejected',
    message:             'New message',
    broadcast:           'Broadcast message',
    correction_approved: 'Correction approved',
    correction_rejected: 'Correction rejected',
  }
  return map[type] ?? type
}

function formatTime (iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', hour12:true }) }
  catch (_) { return '' }
}

export const notificationStyles = `
  .notif-badge { position:absolute; top:-4px; right:-4px; background:var(--color-heat); color:#fff; font-size:9px; font-weight:600; min-width:16px; height:16px; border-radius:99px; display:flex; align-items:center; justify-content:center; padding:0 4px; pointer-events:none; }
  .notif-badge.hidden { display:none; }

  .notif-panel { position:fixed; background:var(--surface-1); border:0.5px solid var(--border-default); border-radius:var(--radius-lg); width:280px; max-height:400px; overflow-y:auto; z-index:200; box-shadow:0 8px 32px rgba(0,0,0,0.4); display:flex; flex-direction:column; }
  .notif-panel-title { font-size:var(--text-sm); font-weight:500; color:var(--text-muted); padding:var(--space-3) var(--space-4); border-bottom:0.5px solid var(--border-subtle); flex-shrink:0; text-transform:uppercase; letter-spacing:0.04em; }
  .notif-loading { font-size:var(--text-sm); color:var(--text-disabled); padding:var(--space-4); text-align:center; }
  .notif-empty   { font-size:var(--text-sm); color:var(--text-disabled); padding:var(--space-4); text-align:center; }

  .notif-row { display:flex; flex-direction:column; gap:2px; padding:var(--space-3) var(--space-4); background:none; border:none; cursor:pointer; text-align:left; width:100%; border-bottom:0.5px solid var(--border-subtle); -webkit-tap-highlight-color:transparent; }
  .notif-row--unread { background:var(--signal-tint); }
  .notif-row:active { background:var(--surface-2); }
  .notif-body { font-size:var(--text-sm); color:var(--text-primary); line-height:1.3; }
  .notif-time { font-size:var(--text-xs); color:var(--text-disabled); }
`
