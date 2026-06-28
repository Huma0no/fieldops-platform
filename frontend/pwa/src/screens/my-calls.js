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
import { jobCardStyles as _ }           from '../components/job-card.js'
import { navBarStyles as __ }           from '../components/nav-bar.js'
import { startSync, forceSync }         from '../lib/sync.js'

// ── Styles (injected once) ─────────────────────────────────

const STYLES_ID = 'styles-my-calls'

function injectStyles () {
  if (document.getElementById(STYLES_ID)) return
  const style = document.createElement('style')
  style.id = STYLES_ID
  style.textContent = screenStyles + jobCardStyles + navBarStyles
  document.head.appendChild(style)
}

// ── State ─────────────────────────────────────────────────

let visits     = []
let isLoading  = true
let isPulling  = false
let screenEl   = null

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
  window.addEventListener('sync:update', onSyncUpdate)
}

// ── Data ───────────────────────────────────────────────────

async function loadVisits () {
  isLoading = true
  renderList()

  try {
    visits = await api.get('/visits/mine')
  } catch (err) {
    visits = []
    console.error('Failed to load visits:', err)
  } finally {
    isLoading = false
    renderList()
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
    })
    listEl.appendChild(card)
  })
}

// ── Header ─────────────────────────────────────────────────

function buildHeader () {
  const header = document.createElement('div')
  header.className = 'screen-header'

  const title = document.createElement('h1')
  title.className   = 'screen-title'
  title.textContent = 'My Calls'

  const bell = document.createElement('button')
  bell.className = 'header-bell'
  bell.setAttribute('aria-label', 'Notifications')
  bell.innerHTML = `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
  `
  // Notification panel wired in F9
  bell.addEventListener('click', () => console.info('Notifications — F9'))

  header.appendChild(title)
  header.appendChild(bell)
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
         stroke="var(--text-disabled)" stroke-width="1.2" stroke-linecap="round">
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
    background: var(--surface-base);
    overflow: hidden;
  }

  .screen-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: calc(var(--space-5) + env(safe-area-inset-top, 0px)) var(--space-5) var(--space-3);
    background: var(--surface-1);
    border-bottom: 0.5px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .screen-title {
    font-size: var(--text-lg);
    font-weight: 500;
    color: var(--text-primary);
    letter-spacing: -0.01em;
  }

  .header-bell {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: var(--space-2);
    border-radius: var(--radius-md);
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
    font-size: var(--text-base);
    font-weight: 500;
    color: var(--text-muted);
  }

  .empty-sub {
    font-size: var(--text-sm);
    color: var(--text-disabled);
  }

  .skeleton-wrap {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
  }

  .skeleton-card {
    height: 88px;
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    animation: shimmer 1.4s ease-in-out infinite;
  }

  @keyframes shimmer {
    0%, 100% { opacity: 0.5; }
    50%       { opacity: 1;   }
  }
`
