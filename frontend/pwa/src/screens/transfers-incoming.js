/**
 * src/screens/transfers-incoming.js
 * Incoming transfer requests — technician can Accept or Reject each one.
 * Accept: visit moves to this technician, navigate to My Calls.
 * Reject: item removed from list.
 * Polls for new requests via sync:update (every 20s).
 */

import { api }                  from '../../../shared/api.js'
import { NavBar, navBarStyles } from '../components/nav-bar.js'
import { startSync }            from '../lib/sync.js'

const STYLES_ID = 'styles-transfers-incoming'

function injectStyles () {
  if (document.getElementById(STYLES_ID)) return
  const style = document.createElement('style')
  style.id = STYLES_ID
  style.textContent = navBarStyles + screenStyles
  document.head.appendChild(style)
}

// ── State ──────────────────────────────────────────────────

let transfers = []
let isLoading = true
let acting    = new Set()   // transferIds with an in-flight accept/reject

// ── Mount ──────────────────────────────────────────────────

export default function mount (appEl) {
  injectStyles()
  appEl.innerHTML = ''

  const screen = document.createElement('div')
  screen.className = 'screen'
  screen.appendChild(buildHeader())

  const scrollArea = document.createElement('div')
  scrollArea.className = 'scroll-area'

  const listWrap = document.createElement('div')
  listWrap.id = 'ti-list'
  scrollArea.appendChild(listWrap)

  screen.appendChild(scrollArea)
  screen.appendChild(NavBar({
    active: 'menu',
    onNavigate: route => window.dispatchEvent(new CustomEvent('app:navigate', { detail: { route } })),
  }))

  appEl.appendChild(screen)

  loadTransfers()
  startSync()
  window.removeEventListener('sync:update', onSyncUpdate)
  window.addEventListener('sync:update', onSyncUpdate)
}

function buildHeader () {
  const el = document.createElement('div')
  el.className = 'screen-header'
  const back = document.createElement('button')
  back.className = 'tr-back-btn'
  back.textContent = '←'
  back.addEventListener('click', () =>
    window.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: '/' } }))
  )
  const title = document.createElement('h1')
  title.className = 'screen-title'
  title.textContent = 'Incoming Transfers'
  el.appendChild(back)
  el.appendChild(title)
  return el
}

// ── Data ───────────────────────────────────────────────────

async function loadTransfers () {
  isLoading = true
  render()
  try {
    transfers = await api.get('/transfers/pending/mine')
  } catch (err) {
    transfers = []
    console.error('Failed to load incoming transfers:', err)
  } finally {
    isLoading = false
    render()
  }
}

function onSyncUpdate () {
  loadTransfers()
}

// ── Actions ────────────────────────────────────────────────

async function accept (transferId, street) {
  if (acting.has(transferId)) return
  acting.add(transferId)
  render()

  try {
    await api.post(`/transfers/${transferId}/accept`)
    const listEl = document.getElementById('ti-list')
    if (listEl) {
      listEl.innerHTML = `
        <div class="ti-success">
          <p class="ti-success-icon">✓</p>
          <p class="ti-success-title">Transfer accepted</p>
          <p class="ti-success-sub">${street} is now in your queue.</p>
        </div>
      `
    }
    setTimeout(() =>
      window.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: '/' } }))
    , 1500)
  } catch (err) {
    acting.delete(transferId)
    render()
    console.error('Accept failed:', err)
  }
}

async function reject (transferId) {
  if (acting.has(transferId)) return
  acting.add(transferId)
  render()

  try {
    await api.post(`/transfers/${transferId}/reject`)
    transfers = transfers.filter(t => t.transferId !== transferId)
    acting.delete(transferId)
    render()
    showBanner('Transfer rejected.')
  } catch (err) {
    acting.delete(transferId)
    render()
    console.error('Reject failed:', err)
  }
}

function showBanner (msg) {
  const listEl = document.getElementById('ti-list')
  if (!listEl) return
  const banner = document.createElement('p')
  banner.className = 'ti-banner'
  banner.textContent = msg
  listEl.prepend(banner)
  setTimeout(() => banner.remove(), 2500)
}

// ── Render ─────────────────────────────────────────────────

function render () {
  const listEl = document.getElementById('ti-list')
  if (!listEl) return

  if (isLoading) {
    listEl.innerHTML = '<p class="ti-empty">Loading…</p>'
    return
  }

  if (!transfers.length) {
    listEl.innerHTML = '<p class="ti-empty">No incoming transfers.</p>'
    return
  }

  listEl.innerHTML = ''
  transfers.forEach(t => listEl.appendChild(buildCard(t)))
}

function buildCard (t) {
  const card = document.createElement('div')
  card.className = 'ti-card'

  const info = document.createElement('div')
  info.className = 'ti-card-info'
  info.innerHTML = `
    <p class="ti-addr">${t.address?.street ?? '—'}</p>
    <p class="ti-meta">From ${t.fromTechnicianName} · ${formatTime(t.createdAt)}</p>
    ${t.reason ? `<p class="ti-reason">"${t.reason}"</p>` : ''}
  `
  card.appendChild(info)

  const isActing = acting.has(t.transferId)

  const actions = document.createElement('div')
  actions.className = 'ti-actions'

  const rejectBtn = document.createElement('button')
  rejectBtn.className = 'ti-btn ti-btn--reject'
  rejectBtn.textContent = 'Reject'
  rejectBtn.disabled = isActing
  rejectBtn.addEventListener('click', () => reject(t.transferId))

  const acceptBtn = document.createElement('button')
  acceptBtn.className = 'ti-btn ti-btn--accept'
  acceptBtn.textContent = isActing ? '…' : 'Accept'
  acceptBtn.disabled = isActing
  acceptBtn.addEventListener('click', () => accept(t.transferId, t.address?.street ?? ''))

  actions.appendChild(rejectBtn)
  actions.appendChild(acceptBtn)
  card.appendChild(actions)

  return card
}

function formatTime (iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  } catch (_) { return '' }
}

const screenStyles = `
  .screen { display:flex; flex-direction:column; height:100dvh; background:var(--surface-base); overflow:hidden; }
  .screen-header { display:flex; align-items:center; gap:var(--space-3); padding:calc(var(--space-5) + env(safe-area-inset-top,0px)) var(--space-5) var(--space-3); background:var(--surface-1); border-bottom:0.5px solid var(--border-subtle); flex-shrink:0; }
  .screen-title { font-size:var(--text-lg); font-weight:500; color:var(--text-primary); letter-spacing:-0.01em; }
  .scroll-area { flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; }
  .tr-back-btn { background:none; border:none; color:var(--text-muted); font-size:20px; cursor:pointer; padding:var(--space-2); line-height:1; -webkit-tap-highlight-color:transparent; }

  .ti-empty { font-size:var(--text-sm); color:var(--text-muted); padding:var(--space-8) var(--space-5); text-align:center; }
  .ti-banner { font-size:var(--text-sm); color:var(--text-muted); padding:var(--space-3) var(--space-5); background:var(--surface-2); border-bottom:0.5px solid var(--border-subtle); }

  .ti-card { padding:var(--space-4) var(--space-5); border-bottom:0.5px solid var(--border-subtle); display:flex; flex-direction:column; gap:var(--space-3); }
  .ti-card-info { display:flex; flex-direction:column; gap:4px; }
  .ti-addr { font-size:var(--text-base); font-weight:500; color:var(--text-primary); }
  .ti-meta { font-size:var(--text-sm); color:var(--text-muted); }
  .ti-reason { font-size:var(--text-sm); color:var(--text-secondary); font-style:italic; }

  .ti-actions { display:flex; gap:var(--space-2); }
  .ti-btn { flex:1; padding:var(--space-3); border:none; border-radius:var(--radius-md); font-size:var(--text-base); font-weight:500; cursor:pointer; -webkit-tap-highlight-color:transparent; }
  .ti-btn:disabled { opacity:0.5; cursor:not-allowed; }
  .ti-btn--reject { background:var(--surface-2); color:var(--text-secondary); border:0.5px solid var(--border-default); }
  .ti-btn--accept { background:var(--color-signal); color:#fff; }

  .ti-success { display:flex; flex-direction:column; align-items:center; gap:var(--space-3); padding:var(--space-8) 0; text-align:center; }
  .ti-success-icon { font-size:32px; }
  .ti-success-title { font-size:var(--text-md); font-weight:500; color:var(--text-primary); }
  .ti-success-sub   { font-size:var(--text-sm); color:var(--text-muted); }
`
