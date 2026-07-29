/**
 * src/screens/my-calls.js
 * My Calls — main screen showing the technician's assigned visits.
 *
 * Layout:
 *   Header (title + notification bell)
 *   Visit list (deferred first, then by scheduled_time)
 *   Bottom NavBar
 *
 * Exported as default(appEl) per the app.js routing contract.
 */

import { api }              from '../../../shared/api.js'
import { NavBar, navBarStyles }         from '../components/nav-bar.js'
import { JobCard, jobCardStyles }       from '../components/job-card.js'
import { startSync, forceSync }         from '../lib/sync.js'
import { NotificationBell, notificationStyles } from '../components/notifications.js'

// ── Styles (injected once) ─────────────────────────────────

const STYLES_ID = 'styles-my-calls'

function injectStyles () {
  if (document.getElementById(STYLES_ID)) return
  const style = document.createElement('style')
  style.id = STYLES_ID
  style.textContent = screenStyles + jobCardStyles + navBarStyles + notificationStyles
  document.head.appendChild(style)
}

// ── State ─────────────────────────────────────────────────

let visits        = []
let isLoading     = true
let isPulling     = false
let screenEl      = null
let loadSheetOpen = false

// ── Mount ──────────────────────────────────────────────────

export default function mount (appEl) {
  injectStyles()
  appEl.innerHTML = ''

  screenEl = document.createElement('div')
  screenEl.className = 'screen'

  screenEl.appendChild(buildHeader())

  const scrollArea = document.createElement('div')
  scrollArea.className = 'scroll-area'
  scrollArea.id = 'visit-scroll'

  const listWrap = document.createElement('div')
  listWrap.className = 'visit-list'
  listWrap.id = 'visit-list'
  scrollArea.appendChild(listWrap)

  const loadSheetWrap = document.createElement('div')
  loadSheetWrap.className = 'load-sheet-wrap'
  loadSheetWrap.id = 'load-sheet-wrap'
  scrollArea.appendChild(loadSheetWrap)

  screenEl.appendChild(scrollArea)

  const nav = NavBar({
    active: 'my-calls',
    onNavigate: route => navigateTo(route),
  })
  screenEl.appendChild(nav)

  appEl.appendChild(screenEl)

  // Pull-to-refresh
  setupPullToRefresh(scrollArea)

  // Initial load
  loadVisits()

  // Start sync — updates arrive via 'sync:update' event
  startSync()
  window.removeEventListener('sync:update', onSyncUpdate)
  window.addEventListener('sync:update', onSyncUpdate)
}

// ── Data ───────────────────────────────────────────────────

async function loadVisits () {
  isLoading = true
  renderList()
  renderLoadSheet()

  try {
    visits = await api.get('/visits/mine')
  } catch (err) {
    visits = []
    console.error('Failed to load visits:', err)
  } finally {
    isLoading = false
    renderList()
    renderLoadSheet()
  }
}

function onSyncUpdate (e) {
  const { visits: updated } = e.detail ?? {}
  if (!updated) return

  // Merge updated visits into local state
  updated.forEach(v => {
    const idx = visits.findIndex(x => x.id === v.id)
    if (idx >= 0) {
      visits[idx] = { ...visits[idx], ...v }
    } else {
      visits.push(v)
    }
  })

  // Remove visits no longer assigned to this technician
  if (e.detail.removedVisitIds?.length) {
    visits = visits.filter(v => !e.detail.removedVisitIds.includes(v.id))
  }

  renderList()
  renderLoadSheet()
}

// ── Render ─────────────────────────────────────────────────

function renderList () {
  const listEl = document.getElementById('visit-list')
  if (!listEl) return
  listEl.innerHTML = ''

  if (isLoading) {
    listEl.appendChild(buildSkeleton())
    return
  }

  const activeVisits = visits.filter(
    v => ['assigned', 'in_progress', 'temporarily'].includes(v.status) || v.is_deferred
  )

  if (!activeVisits.length) {
    listEl.appendChild(buildEmptyState())
    return
  }

  // Deferred visits first, then sorted by scheduled_time
  const sorted = [
    ...activeVisits.filter(v => v.is_deferred),
    ...activeVisits.filter(v => !v.is_deferred).sort((a, b) =>
      new Date(a.scheduled_time) - new Date(b.scheduled_time)
    ),
  ]

  sorted.forEach(visit => {
    const card = JobCard({
      visit,
      onStart:         () => loadVisits(),   // reload after start
      onOpenWorkspace: id  => navigateTo(`/workspace?id=${id}`),
      onNavigate:      route => navigateTo(route),
      onItemsLoaded:   () => renderLoadSheet(),
    })
    listEl.appendChild(card)
  })
}

// ── Load Sheet Summary ──────────────────────────────────────

function aggregateLoadSheet () {
  const activeVisits = visits.filter(
    v => ['assigned', 'in_progress', 'temporarily'].includes(v.status) || v.is_deferred
  )

  const totals = new Map()   // itemName -> qty
  let allLoaded = true

  activeVisits.forEach(v => {
    if (!v.items) { allLoaded = false; return }
    v.items
      .filter(i => i.category === 'thermostat' || i.category === 'accessory')
      .forEach(i => {
        totals.set(i.itemName, (totals.get(i.itemName) ?? 0) + (i.quantity ?? 0))
      })
  })

  const rows = [...totals.entries()]
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const totalCount = rows.reduce((sum, r) => sum + r.qty, 0)

  return { rows, totalCount, allLoaded, activeCount: activeVisits.length }
}

function renderLoadSheet () {
  const wrap = document.getElementById('load-sheet-wrap')
  if (!wrap) return
  wrap.innerHTML = ''

  if (isLoading) return

  const { rows, totalCount, allLoaded, activeCount } = aggregateLoadSheet()
  if (!activeCount) return

  const panel = document.createElement('div')
  panel.className = `load-sheet${loadSheetOpen ? ' load-sheet--open' : ''}`

  const head = document.createElement('div')
  head.className = 'ls-head'
  head.addEventListener('click', () => {
    loadSheetOpen = !loadSheetOpen
    renderLoadSheet()
  })

  const title = document.createElement('div')
  title.className   = 'ls-title'
  title.textContent = 'Load Sheet Summary'

  const count = document.createElement('span')
  count.className   = 'ls-count'
  count.textContent = `${totalCount} pcs`

  const chev = document.createElement('span')
  chev.className = 'ls-chev'
  chev.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>'

  head.appendChild(title)
  head.appendChild(count)
  head.appendChild(chev)
  panel.appendChild(head)

  if (loadSheetOpen) {
    const body = document.createElement('div')
    body.className = 'ls-body'

    if (!rows.length) {
      const empty = document.createElement('p')
      empty.className   = 'ls-empty'
      empty.textContent = 'No thermostats or accessories loaded yet.'
      body.appendChild(empty)
    } else {
      rows.forEach(r => {
        const row = document.createElement('div')
        row.className = 'ls-row'

        const name = document.createElement('span')
        name.className   = 'ls-item-name'
        name.textContent = r.name

        const qty = document.createElement('span')
        qty.className   = 'ls-qty'
        qty.textContent = `${r.qty}×`

        row.appendChild(name)
        row.appendChild(qty)
        body.appendChild(row)
      })
    }

    if (!allLoaded) {
      const hint = document.createElement('p')
      hint.className   = 'ls-hint'
      hint.textContent = 'Expand cards to load all items'
      body.appendChild(hint)
    }

    panel.appendChild(body)
  }

  wrap.appendChild(panel)
}

// ── Header ─────────────────────────────────────────────────

function buildHeader () {
  const header = document.createElement('div')
  header.className = 'screen-header'

  const title = document.createElement('h1')
  title.className   = 'screen-title'
  title.textContent = 'My Calls'

  header.appendChild(title)
  header.appendChild(NotificationBell(navigateTo))
  return header
}

// ── Pull-to-refresh ────────────────────────────────────────

function setupPullToRefresh (scrollArea) {
  let startY    = 0
  let pulling   = false
  const THRESHOLD = 72

  scrollArea.addEventListener('touchstart', e => {
    if (scrollArea.scrollTop === 0) {
      startY  = e.touches[0].clientY
      pulling = true
    }
  }, { passive: true })

  scrollArea.addEventListener('touchmove', e => {
    if (!pulling) return
    const delta = e.touches[0].clientY - startY
    if (delta > 10) {
      // Show pull indicator
      scrollArea.style.paddingTop = `${Math.min(delta * 0.4, 48)}px`
    }
  }, { passive: true })

  scrollArea.addEventListener('touchend', async e => {
    if (!pulling) return
    pulling = false
    const delta = e.changedTouches[0].clientY - startY

    scrollArea.style.paddingTop = ''

    if (delta > THRESHOLD && !isPulling) {
      isPulling = true
      await forceSync()
      await loadVisits()
      isPulling = false
    }
  })
}

// ── Empty & loading states ─────────────────────────────────

function buildEmptyState () {
  const el = document.createElement('div')
  el.className = 'empty-state'
  el.innerHTML = `
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none"
         stroke="var(--fo-ink-soft)" stroke-width="1.2" stroke-linecap="round">
      <rect x="3" y="4" width="18" height="16" rx="2"/>
      <line x1="3" y1="9" x2="21" y2="9"/>
    </svg>
    <p class="empty-title">No visits assigned today</p>
    <p class="empty-sub">Check back later or pull down to refresh.</p>
  `
  return el
}

function buildSkeleton () {
  const wrap = document.createElement('div')
  wrap.className = 'skeleton-wrap'
  for (let i = 0; i < 3; i++) {
    const sk = document.createElement('div')
    sk.className = 'skeleton-card'
    wrap.appendChild(sk)
  }
  return wrap
}

// ── Navigation ─────────────────────────────────────────────

function navigateTo (route) {
  // Delegate to app.js router
  window.dispatchEvent(new CustomEvent('app:navigate', { detail: { route } }))
}

// ── Styles ─────────────────────────────────────────────────

const screenStyles = `
  .screen {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    background: var(--fo-panel);
    overflow: hidden;
  }

  .screen-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: calc(var(--space-5) + env(safe-area-inset-top, 0px)) var(--space-5) var(--space-3);
    background: var(--fo-panel);
    box-shadow: var(--fo-shadow-raised);
    position: relative;
    z-index: 2;
    flex-shrink: 0;
  }

  .screen-title {
    font-family: var(--fo-font-body);
    font-size: 18px;
    font-weight: 700;
    color: var(--fo-ink);
    letter-spacing: -0.01em;
  }

  .header-bell {
    background: none;
    border: none;
    color: var(--fo-ink-soft);
    cursor: pointer;
    padding: var(--space-2);
    border-radius: var(--fo-radius-sm);
    -webkit-tap-highlight-color: transparent;
  }

  .scroll-area {
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    transition: padding-top var(--dur-fast) var(--ease-out);
  }

  .visit-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4) var(--space-6);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-8) var(--space-6);
    text-align: center;
  }

  .empty-title {
    font-family: var(--fo-font-mono);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--fo-ink-soft);
  }

  .empty-sub {
    font-family: var(--fo-font-mono);
    font-size: 10px;
    letter-spacing: 0.02em;
    color: var(--fo-ink-soft);
    opacity: 0.75;
  }

  .skeleton-wrap {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
  }

  .skeleton-card {
    height: 88px;
    border-radius: var(--fo-radius);
    background: var(--fo-well);
    box-shadow: var(--fo-shadow-well);
    animation: shimmer 1.4s ease-in-out infinite;
  }

  @keyframes shimmer {
    0%, 100% { opacity: 0.5; }
    50%       { opacity: 1;   }
  }

  .load-sheet-wrap {
    padding: 0 var(--space-4) var(--space-6);
  }

  .load-sheet {
    background: var(--fo-panel);
    border-radius: var(--fo-radius);
    box-shadow: var(--fo-shadow-raised);
    overflow: hidden;
  }

  .ls-head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .ls-title {
    flex: 1;
    font-family: var(--fo-font-body);
    font-size: 13px;
    font-weight: 700;
    color: var(--fo-ink);
  }

  .ls-count {
    font-family: var(--fo-font-mono);
    font-size: 10px;
    font-weight: 700;
    color: var(--fo-accent-deep);
    background: var(--fo-well);
    box-shadow: var(--fo-shadow-well);
    border-radius: 20px;
    padding: 3px 10px;
    flex-shrink: 0;
  }

  .ls-chev {
    display: flex;
    color: var(--fo-ink-soft);
    opacity: 0.6;
    transition: transform var(--dur-fast) var(--ease-out);
    flex-shrink: 0;
  }

  .load-sheet--open .ls-chev {
    transform: rotate(180deg);
  }

  .ls-body {
    padding: 0 var(--space-4) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .ls-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .ls-item-name {
    font-family: var(--fo-font-body);
    font-size: 12.5px;
    font-weight: 600;
    color: var(--fo-ink);
  }

  .ls-qty {
    font-family: var(--fo-font-mono);
    font-size: 10px;
    font-weight: 700;
    color: var(--fo-ink-soft);
    background: var(--fo-panel);
    box-shadow: var(--fo-shadow-subtle);
    border-radius: 20px;
    padding: 2px 8px;
    flex-shrink: 0;
  }

  .ls-empty {
    font-family: var(--fo-font-mono);
    font-size: 10px;
    color: var(--fo-ink-soft);
  }

  .ls-hint {
    font-family: var(--fo-font-mono);
    font-size: 9px;
    letter-spacing: 0.04em;
    color: var(--fo-ink-soft);
    opacity: 0.75;
    margin-top: var(--space-1);
  }
`
