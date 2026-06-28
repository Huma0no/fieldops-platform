/**
 * src/screens/lobby.js
 * Lobby — unassigned visits available to claim.
 *
 * Layout:
 *   Header (title + count)
 *   Visit list (sorted by scheduled_time)
 *   Bottom NavBar
 *
 * Exported as default(appEl) per the app.js routing contract.
 */

import { api }                          from '../../../shared/api.js'
import { NavBar, navBarStyles }         from '../components/nav-bar.js'
import { Tag }                          from '../components/badge.js'
import { startSync }                    from '../lib/sync.js'

// ── Styles ─────────────────────────────────────────────────

const STYLES_ID = 'styles-lobby'

function injectStyles () {
  if (document.getElementById(STYLES_ID)) return
  const style = document.createElement('style')
  style.id = STYLES_ID
  style.textContent = screenStyles + navBarStyles
  document.head.appendChild(style)
}

// ── State ─────────────────────────────────────────────────

let visits    = []
let isLoading = true
let claiming  = new Set()   // visitIds currently being claimed

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
  listWrap.className = 'visit-list'
  listWrap.id = 'lobby-list'
  scrollArea.appendChild(listWrap)

  screen.appendChild(scrollArea)

  const nav = NavBar({
    active: 'lobby',
    onNavigate: route => navigate(route),
  })
  screen.appendChild(nav)

  appEl.appendChild(screen)

  loadLobby()
  startSync()
  window.addEventListener('sync:update', onSyncUpdate)
}

// ── Data ───────────────────────────────────────────────────

async function loadLobby () {
  isLoading = true
  renderList()

  try {
    visits = await api.get('/visits/lobby')
  } catch (err) {
    visits = []
    console.error('Failed to load lobby:', err)
  } finally {
    isLoading = false
    renderList()
  }
}

function onSyncUpdate (e) {
  const { lobbyVisits } = e.detail ?? {}
  if (!lobbyVisits) return
  visits = lobbyVisits
  renderList()
}

async function claimVisit (visitId) {
  if (claiming.has(visitId)) return
  claiming.add(visitId)
  renderList()

  try {
    await api.post(`/visits/${visitId}/claim`)
    // Remove from local list immediately — confirmed by next sync
    visits = visits.filter(v => v.id !== visitId)
  } catch (err) {
    if (err.status === 409) {
      // Already claimed by someone else
      const visit = visits.find(v => v.id === visitId)
      if (visit) visit._claimed = true
    } else {
      console.error('Claim failed:', err)
    }
  } finally {
    claiming.delete(visitId)
    renderList()
  }
}

// ── Render ─────────────────────────────────────────────────

function renderList () {
  const listEl = document.getElementById('lobby-list')
  if (!listEl) return
  listEl.innerHTML = ''

  // Update header count
  const countEl = document.getElementById('lobby-count')
  if (countEl) countEl.textContent = visits.length || ''

  if (isLoading) {
    listEl.appendChild(buildSkeleton())
    return
  }

  const available = visits.filter(v => !v._claimed)

  if (!available.length) {
    listEl.appendChild(buildEmptyState())
    return
  }

  const sorted = [...available].sort(
    (a, b) => new Date(a.scheduled_time) - new Date(b.scheduled_time)
  )

  sorted.forEach(visit => {
    listEl.appendChild(buildLobbyCard(visit))
  })
}

// ── Lobby Card ─────────────────────────────────────────────

function buildLobbyCard (visit) {
  const isClaiming = claiming.has(visit.id)
  const isGone     = visit._claimed

  const card = document.createElement('div')
  card.className = `lobby-card ${isGone ? 'lobby-card--gone' : ''}`

  // Top row: address + time
  const topRow = document.createElement('div')
  topRow.className = 'lc-top'

  const addrWrap = document.createElement('div')
  addrWrap.className = 'lc-addr-wrap'

  const addr = document.createElement('p')
  addr.className   = 'lc-address'
  addr.textContent = visit.address?.street ?? '—'

  const sub = document.createElement('p')
  sub.className   = 'lc-sub'
  sub.textContent = [visit.subdivision, visit.builder].filter(Boolean).join(' · ') || '—'

  addrWrap.appendChild(addr)
  addrWrap.appendChild(sub)

  const time = document.createElement('span')
  time.className   = 'lc-time'
  time.textContent = formatTime(visit.scheduled_time)

  topRow.appendChild(addrWrap)
  topRow.appendChild(time)
  card.appendChild(topRow)

  // Work type
  const workType = document.createElement('p')
  workType.className   = 'lc-worktype'
  workType.textContent = formatWorkType(visit.work_type)
  card.appendChild(workType)

  // Tags row
  const tags = buildTags(visit)
  if (tags.length) {
    const tagsRow = document.createElement('div')
    tagsRow.className = 'lc-tags'
    tags.forEach(t => tagsRow.appendChild(t))
    card.appendChild(tagsRow)
  }

  // Action row
  const actions = document.createElement('div')
  actions.className = 'lc-actions'

  if (isGone) {
    const gone = document.createElement('span')
    gone.className   = 'lc-gone-label'
    gone.textContent = 'Already claimed'
    actions.appendChild(gone)
  } else {
    const claimBtn = document.createElement('button')
    claimBtn.className   = `lc-claim-btn ${isClaiming ? 'lc-claim-btn--loading' : ''}`
    claimBtn.disabled    = isClaiming
    claimBtn.textContent = isClaiming ? 'Claiming…' : 'Claim'
    claimBtn.addEventListener('click', () => claimVisit(visit.id))
    actions.appendChild(claimBtn)
  }

  card.appendChild(actions)
  return card
}

// ── Header ─────────────────────────────────────────────────

function buildHeader () {
  const header = document.createElement('div')
  header.className = 'screen-header'

  const left = document.createElement('div')
  left.style.display    = 'flex'
  left.style.alignItems = 'baseline'
  left.style.gap        = '8px'

  const title = document.createElement('h1')
  title.className   = 'screen-title'
  title.textContent = 'Lobby'

  const count = document.createElement('span')
  count.id        = 'lobby-count'
  count.className = 'lobby-count-badge'

  left.appendChild(title)
  left.appendChild(count)
  header.appendChild(left)
  return header
}

// ── Empty & loading states ─────────────────────────────────

function buildEmptyState () {
  const el = document.createElement('div')
  el.className = 'empty-state'
  el.innerHTML = `
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none"
         stroke="var(--text-disabled)" stroke-width="1.2" stroke-linecap="round">
      <circle cx="12" cy="12" r="9"/>
      <polyline points="12 8 12 12 14 14"/>
    </svg>
    <p class="empty-title">No visits available</p>
    <p class="empty-sub">New visits will appear here when released by dispatch.</p>
  `
  return el
}

function buildSkeleton () {
  const wrap = document.createElement('div')
  wrap.className = 'skeleton-wrap'
  for (let i = 0; i < 4; i++) {
    const sk = document.createElement('div')
    sk.className = 'skeleton-card'
    wrap.appendChild(sk)
  }
  return wrap
}

// ── Helpers ────────────────────────────────────────────────

function buildTags (visit) {
  const tags = []
  if (visit.is_urgent)            tags.push(Tag('Urgent', 'heat'))
  if (visit.is_a2l)               tags.push(Tag('A2L', 'signal'))
  if (visit.has_multiple_systems) tags.push(Tag('Multi-system', 'default'))
  return tags
}

function formatWorkType (type) {
  const map = {
    ac_startup:   'AC Startup',
    heat_startup: 'Heat Startup',
    ac_heat:      'AC & Heat',
    prestart:     'Prestart',
    drive_run:    'Drive Run',
    cancel:       'Cancel',
  }
  return map[type] ?? type ?? '—'
}

function formatTime (iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true,
    })
  } catch (_) { return '—' }
}

function navigate (route) {
  window.dispatchEvent(new CustomEvent('app:navigate', { detail: { route } }))
}

// ── Styles ─────────────────────────────────────────────────

const screenStyles = `
  .lobby-count-badge {
    font-size: var(--text-sm);
    color: var(--text-disabled);
    font-weight: 400;
  }

  .lobby-card {
    background: var(--surface-1);
    border-radius: var(--radius-lg);
    border: 0.5px solid var(--border-subtle);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .lobby-card--gone {
    opacity: 0.45;
    pointer-events: none;
  }

  .lc-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-3);
  }

  .lc-addr-wrap {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .lc-address {
    font-size: var(--text-base);
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .lc-sub {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .lc-time {
    font-size: var(--text-sm);
    color: var(--text-disabled);
    flex-shrink: 0;
  }

  .lc-worktype {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .lc-tags {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .lc-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--space-1);
  }

  .lc-claim-btn {
    background: var(--color-signal);
    color: #fff;
    border: none;
    border-radius: var(--radius-md);
    font-size: var(--text-base);
    font-weight: 500;
    padding: var(--space-2) var(--space-5);
    cursor: pointer;
    transition: opacity var(--dur-fast) var(--ease-out);
    -webkit-tap-highlight-color: transparent;
  }

  .lc-claim-btn--loading {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .lc-gone-label {
    font-size: var(--text-sm);
    color: var(--text-disabled);
    font-style: italic;
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

  .scroll-area {
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
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
    height: 110px;
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    animation: shimmer 1.4s ease-in-out infinite;
  }

  @keyframes shimmer {
    0%, 100% { opacity: 0.5; }
    50%       { opacity: 1;   }
  }
`
