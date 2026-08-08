/**
 * src/screens/reports.js
 * Reports — today's completed visits with send status.
 *
 * Status icons:
 *   sent            — ✓ green
 *   pending_send    — ⏳ amber (queued, will retry)
 *   downloaded      — ↓ static (offline download, not sent)
 *
 * Exported as default(appEl) per app.js routing contract.
 */

import { api }                  from '../../../shared/api.js'
import { NavBar, navBarStyles } from '../components/nav-bar.js'
import { getQueue }             from '../lib/db.js'
import { startSync }            from '../lib/sync.js'
import { CorrectionModal, correctionModalStyles } from '../components/correction-modal.js'

const STYLES_ID = 'styles-reports'

function injectStyles () {
  if (document.getElementById(STYLES_ID)) return
  const style = document.createElement('style')
  style.id = STYLES_ID
  style.textContent = screenStyles + navBarStyles + correctionModalStyles
  document.head.appendChild(style)
}

let completions  = []
let queuedIds    = new Set()
let downloadedIds = new Set()
let isLoading    = true

export default async function mount (appEl) {
  injectStyles()
  appEl.innerHTML = ''

  const screen = document.createElement('div')
  screen.className = 'screen'
  screen.appendChild(buildHeader())

  const scrollArea = document.createElement('div')
  scrollArea.className = 'scroll-area'
  const list = document.createElement('div')
  list.className = 'visit-list'
  list.id = 'reports-list'
  scrollArea.appendChild(list)
  screen.appendChild(scrollArea)

  screen.appendChild(NavBar({
    active: 'reports',
    onNavigate: route => navigate(route),
  }))

  appEl.appendChild(screen)

  await loadReports()
  startSync()
  window.removeEventListener('sync:update', onSyncUpdate)
  window.addEventListener('sync:update', onSyncUpdate)
  window.removeEventListener('queue:sent', onQueueSent)
  window.addEventListener('queue:sent',  onQueueSent)
}

async function loadReports () {
  isLoading = true
  renderList()

  try {
    const [visits, queue] = await Promise.all([
      api.get('/visits/mine?status=completed&today=true'),
      getQueue(),
    ])
    completions = visits ?? []
    queuedIds   = new Set(queue.map(e => e.visitId))
  } catch (err) {
    completions = []
    console.error('Failed to load reports:', err)
  } finally {
    isLoading = false
    renderList()
  }
}

function onSyncUpdate (e) {
  const { completedVisits } = e.detail ?? {}
  if (!completedVisits) return
  completedVisits.forEach(v => {
    const idx = completions.findIndex(c => c.id === v.id)
    if (idx >= 0) completions[idx] = { ...completions[idx], ...v }
    else completions.push(v)
  })
  renderList()
}

function onQueueSent (e) {
  const { visitId } = e.detail ?? {}
  if (visitId) queuedIds.delete(visitId)
  renderList()
}

function renderList () {
  const listEl = document.getElementById('reports-list')
  if (!listEl) return
  listEl.innerHTML = ''

  if (isLoading) {
    listEl.appendChild(buildSkeleton())
    return
  }

  if (!completions.length && !queuedIds.size) {
    listEl.appendChild(buildEmptyState())
    return
  }

  const sorted = [...completions].sort(
    (a, b) => new Date(b.completed_at ?? 0) - new Date(a.completed_at ?? 0)
  )

  sorted.forEach(visit => listEl.appendChild(buildReportCard(visit)))
}

function buildReportCard (visit) {
  const isPending    = queuedIds.has(visit.id)
  const isDownloaded = downloadedIds.has(visit.id)

  const card = document.createElement('div')
  card.className = 'report-card'

  const top = document.createElement('div')
  top.className = 'rc-top'

  const left = document.createElement('div')
  left.className = 'rc-left'

  const addr = document.createElement('p')
  addr.className   = 'rc-address'
  addr.textContent = visit.address?.street ?? '—'

  const meta = document.createElement('p')
  meta.className   = 'rc-meta'
  meta.textContent = [formatWorkType(visit.work_type), formatPrice(visit.total_price)].filter(Boolean).join(' · ')

  left.appendChild(addr)
  left.appendChild(meta)

  const rightWrap = document.createElement('div')
  rightWrap.className = 'rc-card-right'

  const statusIcon = buildStatusIcon(isPending, isDownloaded)
  rightWrap.appendChild(statusIcon)

  // ··· menu — low-frequency actions
  const menuBtn = document.createElement('button')
  menuBtn.className   = 'rc-menu-btn'
  menuBtn.textContent = '···'
  menuBtn.setAttribute('aria-label', 'More options')
  menuBtn.addEventListener('click', e => {
    e.stopPropagation()
    showCardMenu(menuBtn, visit)
  })
  rightWrap.appendChild(menuBtn)

  top.appendChild(left)
  top.appendChild(rightWrap)
  card.appendChild(top)

  // Status label
  const statusLabel = document.createElement('p')
  if (isPending)         { statusLabel.textContent = 'Pending send — will retry when online'; statusLabel.className = 'rc-status rc-status--pending' }
  else if (isDownloaded) { statusLabel.textContent = 'Downloaded locally — not sent'; statusLabel.className = 'rc-status rc-status--downloaded' }
  else                   { statusLabel.textContent = 'Sent'; statusLabel.className = 'rc-status rc-status--sent' }
  card.appendChild(statusLabel)

  // Actions
  const actions = document.createElement('div')
  actions.className = 'rc-actions'

  const previewBtn = document.createElement('button')
  previewBtn.className   = 'rc-btn rc-btn--secondary'
  previewBtn.textContent = 'View report'
  previewBtn.addEventListener('click', () => openReportPreview(visit))
  actions.appendChild(previewBtn)

  const downloadBtn = document.createElement('button')
  downloadBtn.className   = 'rc-btn rc-btn--ghost'
  downloadBtn.textContent = 'Download'
  downloadBtn.addEventListener('click', () => downloadReport(visit))
  actions.appendChild(downloadBtn)

  card.appendChild(actions)
  return card
}

function showCardMenu (anchorEl, visit) {
  document.querySelector('.rc-context-menu')?.remove()

  const menu = document.createElement('div')
  menu.className = 'rc-context-menu'

  const corrBtn = document.createElement('button')
  corrBtn.className   = 'rc-context-item'
  corrBtn.textContent = 'Request correction'
  corrBtn.addEventListener('click', () => {
    menu.remove()
    openCorrectionModal(visit)
  })
  menu.appendChild(corrBtn)

  const rect = anchorEl.getBoundingClientRect()
  menu.style.top   = `${rect.bottom + 4}px`
  menu.style.right = `${window.innerWidth - rect.right}px`
  document.body.appendChild(menu)

  function close (e) { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close) } }
  setTimeout(() => document.addEventListener('click', close), 0)
}

function openCorrectionModal (visit) {
  const modal = CorrectionModal({
    visitId: visit.id,
    onSubmit: async ({ visitId, message }) => {
      await api.post(`/visits/${visitId}/request-correction`, { message })
      modal.remove()
      alert('Correction request sent.')
    },
    onCancel: () => modal.remove(),
  })
  document.body.appendChild(modal)
}

function buildStatusIcon (isPending, isDownloaded) {
  const wrap = document.createElement('div')
  wrap.className = 'rc-status-icon'
  if (isPending) {
    wrap.textContent = '⏳'
    wrap.title = 'Pending send'
  } else if (isDownloaded) {
    wrap.textContent = '↓'
    wrap.title = 'Downloaded, not sent'
    wrap.classList.add('rc-status-icon--downloaded')
  } else {
    wrap.textContent = '✓'
    wrap.classList.add('rc-status-icon--sent')
    wrap.title = 'Sent'
  }
  return wrap
}

async function openReportPreview (visit) {
  const overlay = document.createElement('div')
  overlay.className = 'rp-overlay'
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })

  const modal = document.createElement('div')
  modal.className = 'rp-modal'

  const header = document.createElement('div')
  header.className = 'rp-modal-header'
  const title = document.createElement('h2')
  title.className   = 'rp-modal-title'
  title.textContent = visit.address?.street ?? 'Report'
  const closeBtn = document.createElement('button')
  closeBtn.className   = 'rp-close-btn'
  closeBtn.textContent = '×'
  closeBtn.addEventListener('click', () => overlay.remove())
  header.appendChild(title)
  header.appendChild(closeBtn)
  modal.appendChild(header)

  const body = document.createElement('div')
  body.className   = 'rp-modal-body'
  body.textContent = 'Loading…'
  modal.appendChild(body)

  overlay.appendChild(modal)
  document.body.appendChild(overlay)

  try {
    const preview = await api.get(`/visits/${visit.id}/report-preview`)
    body.innerHTML = ''
    const pre = document.createElement('pre')
    pre.className   = 'rp-preview-text'
    pre.textContent = preview?.text ?? JSON.stringify(preview, null, 2)
    body.appendChild(pre)
  } catch (err) {
    body.textContent = 'Could not load report preview.'
    console.error('Preview failed:', err)
  }
}

async function downloadReport (visit) {
  try {
    const payload = await api.get(`/visits/${visit.id}/report-preview`)
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `report-${visit.id}.json`
    a.click()
    URL.revokeObjectURL(url)
    downloadedIds.add(visit.id)
    renderList()
  } catch (err) {
    console.error('Download failed:', err)
  }
}

function buildHeader () {
  const header = document.createElement('div')
  header.className = 'screen-header'
  const title = document.createElement('h1')
  title.className   = 'screen-title'
  title.textContent = 'Reports'
  header.appendChild(title)
  return header
}

function buildEmptyState () {
  const el = document.createElement('div')
  el.className = 'empty-state'
  el.innerHTML = `
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none"
         stroke="var(--fo-ink-soft)" stroke-width="1.2" stroke-linecap="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
    <p class="empty-title">No reports today</p>
    <p class="empty-sub">Completed visits will appear here.</p>
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

function formatWorkType (type) {
  const map = { ac_startup:'AC Startup', heat_startup:'Heat Startup', ac_heat:'AC & Heat', prestart:'Prestart', drive_run:'Drive Run', cancel:'Cancel' }
  return map[type] ?? type ?? '—'
}

function formatPrice (val) {
  if (val === undefined || val === null) return ''
  return `$${Number(val).toFixed(2)}`
}

function navigate (route) {
  window.dispatchEvent(new CustomEvent('app:navigate', { detail: { route } }))
}

const screenStyles = `
  .screen { display:flex; flex-direction:column; height:100dvh; background:var(--fo-panel); overflow:hidden; font-family:var(--fo-font-body); }
  .screen-header { display:flex; justify-content:space-between; align-items:center; padding:calc(var(--space-5) + env(safe-area-inset-top,0px)) var(--space-5) var(--space-3); background:var(--fo-panel); box-shadow:var(--fo-shadow-raised); position:relative; z-index:2; flex-shrink:0; }
  .screen-title { font-size:var(--text-lg); font-weight:800; color:var(--fo-ink); letter-spacing:-0.01em; }
  .scroll-area { flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; }
  .visit-list { display:flex; flex-direction:column; gap:var(--space-2); padding:var(--space-3) var(--space-4) var(--space-6); }

  .report-card { background:var(--fo-panel); box-shadow:var(--fo-shadow-raised); border-radius:var(--fo-radius); padding:var(--space-4); display:flex; flex-direction:column; gap:var(--space-2); }
  .rc-top { display:flex; justify-content:space-between; align-items:flex-start; gap:var(--space-3); }
  .rc-left { display:flex; flex-direction:column; gap:2px; flex:1; min-width:0; }
  .rc-address { font-size:var(--text-base); font-weight:800; color:var(--fo-ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .rc-meta { font-size:var(--text-sm); font-family:var(--fo-font-mono); color:var(--fo-ink-soft); }
  .rc-status-icon { font-size:18px; flex-shrink:0; }
  .rc-status-icon--downloaded { color: var(--fo-ink-soft); }
  .rc-status-icon--sent { color: var(--fo-ok); }
  .rc-status { font-size:var(--text-sm); font-family:var(--fo-font-mono); }
  .rc-status--pending { color: var(--fo-accent); }
  .rc-status--downloaded { color: var(--fo-ink-soft); }
  .rc-status--sent { color: var(--fo-ok); }
  .rc-card-right { display:flex; align-items:center; gap:8px; }
  .rc-actions { display:flex; gap:var(--space-2); margin-top:var(--space-1); }
  .rc-btn { border-radius:var(--fo-radius-sm); font-family:var(--fo-font-body); font-size:var(--text-sm); font-weight:700; padding:var(--space-2) var(--space-3); cursor:pointer; border:none; -webkit-tap-highlight-color:transparent; }
  .rc-btn--secondary { background:var(--fo-panel); box-shadow:var(--fo-shadow-raised); color:var(--fo-accent-deep); }
  .rc-btn--ghost { background:var(--fo-well); box-shadow:var(--fo-shadow-well); color:var(--fo-ink-soft); }

  .empty-state { display:flex; flex-direction:column; align-items:center; gap:var(--space-3); padding:var(--space-8) var(--space-6); text-align:center; }
  .empty-title { font-size:var(--text-base); font-family:var(--fo-font-mono); font-weight:700; color:var(--fo-ink-soft); }
  .empty-sub { font-size:var(--text-sm); font-family:var(--fo-font-mono); color:var(--fo-ink-soft); }
  .skeleton-wrap { display:flex; flex-direction:column; gap:var(--space-2); padding:var(--space-3) var(--space-4); }
  .skeleton-card { height:110px; border-radius:var(--fo-radius); background:var(--fo-well); animation:shimmer 1.4s ease-in-out infinite; }
  @keyframes shimmer { 0%,100%{opacity:.5} 50%{opacity:1} }

  .rc-menu-btn { background:none; border:none; color:var(--fo-ink-soft); font-size:18px; cursor:pointer; padding:0 2px; letter-spacing:1px; line-height:1; -webkit-tap-highlight-color:transparent; }
  .rc-context-menu { position:fixed; background:var(--fo-panel); box-shadow:var(--fo-shadow-card); border-radius:var(--fo-radius-sm); padding:var(--space-2) 0; min-width:180px; z-index:100; }
  .rc-context-item { display:block; width:100%; background:none; border:none; text-align:left; font-size:var(--text-base); color:var(--fo-ink); padding:var(--space-3) var(--space-4); cursor:pointer; }
  .rc-context-item:active { background:var(--fo-well); }
  .rp-overlay { position:fixed; inset:0; background:rgba(0,0,0,.6); display:flex; align-items:flex-end; z-index:100; }
  .rp-modal { width:100%; background:var(--fo-panel); box-shadow:var(--fo-shadow-card); border-radius:var(--fo-radius) var(--fo-radius) 0 0; max-height:80dvh; display:flex; flex-direction:column; padding-bottom:env(safe-area-inset-bottom,0px); }
  .rp-modal-header { display:flex; justify-content:space-between; align-items:center; padding:var(--space-4) var(--space-4) var(--space-3); box-shadow:inset 0 -1px 0 var(--fo-panel-lo); flex-shrink:0; }
  .rp-modal-title { font-size:var(--text-base); font-weight:700; color:var(--fo-ink); }
  .rp-close-btn { background:none; border:none; color:var(--fo-ink-soft); font-size:22px; cursor:pointer; padding:0 4px; line-height:1; }
  .rp-modal-body { flex:1; overflow-y:auto; padding:var(--space-4); }
  .rp-preview-text { font-family:var(--fo-font-mono); font-size:var(--text-sm); color:var(--fo-ink); background:var(--fo-well); box-shadow:var(--fo-shadow-well); border-radius:var(--fo-radius-sm); padding:var(--space-3); display:block; white-space:pre-wrap; word-break:break-word; line-height:1.6; }
`
