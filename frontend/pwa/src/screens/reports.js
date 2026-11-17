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
import { HomeTabs, attachHomeSwipe, homeTabStyles } from '../components/home-tabs.js'
import {
  getActiveTechnicianId,
  getAllCompletionSubmissions,
  getPendingCompletionSubmissions,
} from '../lib/db.js'
import {
  deliverCompletionSubmission,
  retryPendingCompletionSubmissions,
} from '../lib/completion-submission.mjs'
import { startSync }            from '../lib/sync.js'
import { buildReportDownload }  from '../lib/report-download.mjs'
import { CorrectionModal, correctionModalStyles } from '../components/correction-modal.js'

const STYLES_ID = 'styles-reports'
const TERMINAL_VISIT_STATUSES = new Set(['completed', 'temporarily', 'cancelled'])

function injectStyles () {
  if (document.getElementById(STYLES_ID)) return
  const style = document.createElement('style')
  style.id = STYLES_ID
  style.textContent = screenStyles + navBarStyles + correctionModalStyles + homeTabStyles
  document.head.appendChild(style)
}

let completions  = []
let queuedIds    = new Set()
let pendingSubmissions = []
let correctionRequiredSubmissions = []
let downloadedIds = new Set()
let retryingIds  = new Set()
let retryErrors  = new Map()
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
  attachHomeSwipe(scrollArea, { active: 'reports', onNavigate: navigate })

  screen.appendChild(NavBar({
    active: 'reports',
    onNavigate: route => navigate(route),
  }))

  appEl.appendChild(screen)

  window.removeEventListener('sync:update', onSyncUpdate)
  window.addEventListener('sync:update', onSyncUpdate)
  window.removeEventListener('completion:delivered', onQueueSent)
  window.addEventListener('completion:delivered', onQueueSent)

  await loadReports()
  startSync()
  if (navigator.onLine !== false && pendingSubmissions.length > 0) {
    void retryPendingCompletionSubmissions().catch(err => {
      console.error('Background completion retry failed:', err)
    })
  }
}

function completionFromSubmissionRecord (entry) {
  const snapshot = entry?.snapshot ?? {}
  return {
    id: entry.visitId,
    status: snapshot.terminalIntent ?? 'completed',
    address: snapshot.address ?? {},
    work_type: snapshot.workType ?? (snapshot.cancel ? 'cancel' : null),
    total_price: snapshot.totalPrice ?? 0,
    completed_at: entry.deliveredAt ?? snapshot.createdAt ?? entry.createdAt ?? null,
    snapshot,
  }
}

async function loadReports () {
  isLoading = true
  renderList()

  const activeTechnicianId = getActiveTechnicianId()
  let localPending = []
  let localAll = []
  try {
    ;[localPending, localAll] = await Promise.all([
      getPendingCompletionSubmissions(activeTechnicianId),
      getAllCompletionSubmissions(activeTechnicianId),
    ])
  } catch (err) {
    console.error('Failed to read local completion submissions:', err)
  }

  pendingSubmissions = localPending ?? []
  correctionRequiredSubmissions = (localAll ?? []).filter(entry => entry?.lifecycle === 'correction_required')
  queuedIds = new Set(pendingSubmissions.map(e => e.visitId))

  const localDeliveredMap = new Map()
  for (const entry of localAll ?? []) {
    if (entry?.lifecycle === 'delivered' && entry.visitId) {
      localDeliveredMap.set(entry.visitId, completionFromSubmissionRecord(entry))
    }
  }

  try {
    const visits = await api.get('/visits/mine?status=completed&today=true')
    const terminalVisits = (visits ?? []).filter(v =>
      !v?.status || TERMINAL_VISIT_STATUSES.has(v.status) || localDeliveredMap.has(v.id)
    ).map(v => {
      const localDelivered = localDeliveredMap.get(v.id)
      return {
        ...localDelivered,
        ...v,
        work_type: v.work_type ?? v.workType ?? localDelivered?.work_type ?? null,
        total_price: v.total_price ?? v.totalPrice ?? localDelivered?.total_price ?? 0,
        completed_at: v.completed_at ?? v.completedAt ?? localDelivered?.completed_at ?? null,
      }
    })
    const seenIds = new Set(terminalVisits.map(v => v.id))
    for (const [visitId, localComp] of localDeliveredMap.entries()) {
      if (!seenIds.has(visitId)) {
        terminalVisits.push(localComp)
      }
    }
    completions = terminalVisits
  } catch (err) {
    completions = Array.from(localDeliveredMap.values())
    console.error('Failed to load reports:', err)
  } finally {
    const deliveredSet = new Set(completions.map(c => c.id))
    pendingSubmissions = pendingSubmissions.filter(entry => !deliveredSet.has(entry.visitId))
    queuedIds = new Set(pendingSubmissions.map(e => e.visitId))
    isLoading = false
    renderList()
    updateHeaderRetryBtn()
  }
}

function onSyncUpdate (e) {
  if (!document.getElementById('reports-list')) return
  const { completedVisits } = e.detail ?? {}
  if (!completedVisits) return
  completedVisits.forEach(v => {
    const idx = completions.findIndex(c => c.id === v.id)
    if (idx >= 0) completions[idx] = { ...completions[idx], ...v }
    else completions.push(v)
  })
  renderList()
  updateHeaderRetryBtn()
}

function onQueueSent (e) {
  const { visitId, submissionId, record } = e.detail ?? {}
  const activeTechnicianId = getActiveTechnicianId()
  if (record?.technicianId && record.technicianId !== activeTechnicianId) return
  const matchingPending = pendingSubmissions.find(
    entry => (visitId && entry.visitId === visitId) || (submissionId && entry.submissionId === submissionId)
  )
  const resolvedVisitId = visitId ?? record?.visitId ?? matchingPending?.visitId
  if (resolvedVisitId) {
    queuedIds.delete(resolvedVisitId)
    retryingIds.delete(resolvedVisitId)
    retryErrors.delete(resolvedVisitId)
    pendingSubmissions = pendingSubmissions.filter(entry => entry.visitId !== resolvedVisitId)
    correctionRequiredSubmissions = correctionRequiredSubmissions.filter(entry => entry.visitId !== resolvedVisitId)
    const sourceRecord = record ?? matchingPending
    if (sourceRecord && !completions.some(c => c.id === resolvedVisitId)) {
      completions.unshift(completionFromSubmissionRecord({
        ...sourceRecord,
        deliveredAt: sourceRecord.deliveredAt ?? new Date().toISOString(),
      }))
    }
  }
  renderList()
  updateHeaderRetryBtn()
}

async function retrySingleSubmission (visit) {
  const visitId = visit.id
  if (!visitId || retryingIds.has(visitId)) return
  retryingIds.add(visitId)
  retryErrors.delete(visitId)
  renderList()
  updateHeaderRetryBtn()

  try {
    const entry = visit._submissionRecord
      ?? pendingSubmissions.find(item => item.visitId === visitId)
      ?? visitId
    await deliverCompletionSubmission(entry)
  } catch (err) {
    retryErrors.set(visitId, err?.message || 'Retry failed')
    console.error('Manual completion retry failed:', err)
  } finally {
    retryingIds.delete(visitId)
    renderList()
    updateHeaderRetryBtn()
  }
}

async function retryAllPending () {
  const uniqueVisitIds = Array.from(new Set(pendingSubmissions.map(e => e.visitId)))
  if (!uniqueVisitIds.length) return
  for (const visitId of uniqueVisitIds) {
    const entry = pendingSubmissions.find(e => e.visitId === visitId)
    if (entry) {
      await retrySingleSubmission({ id: visitId, _submissionRecord: entry })
    }
  }
}

function renderList () {
  const listEl = document.getElementById('reports-list')
  if (!listEl) return
  listEl.innerHTML = ''

  if (isLoading) {
    listEl.appendChild(buildSkeleton())
    return
  }

  const sorted = [...completions].sort(
    (a, b) => new Date(b.completed_at ?? 0) - new Date(a.completed_at ?? 0)
  )

  const deliveredIds = new Set(sorted.map(visit => visit.id))
  const seenPendingVisits = new Set()
  const pendingCards = []
  for (const entry of [...correctionRequiredSubmissions, ...pendingSubmissions]) {
    if (!entry?.visitId || deliveredIds.has(entry.visitId) || seenPendingVisits.has(entry.visitId)) {
      continue
    }
    seenPendingVisits.add(entry.visitId)
    pendingCards.push({
      id: entry.visitId,
      address: entry.snapshot?.address ?? {},
      work_type: entry.snapshot?.workType ?? (entry.snapshot?.cancel ? 'cancel' : null),
      total_price: entry.snapshot?.totalPrice ?? 0,
      snapshot: entry.snapshot,
      _submissionRecord: entry,
      _localPending: entry.lifecycle === 'pending',
      _correctionRequired: entry.lifecycle === 'correction_required',
    })
  }

  if (!sorted.length && !pendingCards.length) {
    listEl.appendChild(buildEmptyState())
    return
  }

  ;[...pendingCards, ...sorted].forEach(visit => listEl.appendChild(buildReportCard(visit)))
}

function buildReportCard (visit) {
  const isPending    = visit._localPending || queuedIds.has(visit.id)
  const correctionRequired = visit._correctionRequired === true
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

  const statusIcon = buildStatusIcon(isPending || correctionRequired, isDownloaded)
  rightWrap.appendChild(statusIcon)

  if (!isPending && !correctionRequired) {
    // ··· menu — low-frequency actions are available only after delivery.
    const menuBtn = document.createElement('button')
    menuBtn.className   = 'rc-menu-btn'
    menuBtn.textContent = '···'
    menuBtn.setAttribute('aria-label', 'More options')
    menuBtn.addEventListener('click', e => {
      e.stopPropagation()
      showCardMenu(menuBtn, visit)
    })
    rightWrap.appendChild(menuBtn)
  }

  top.appendChild(left)
  top.appendChild(rightWrap)
  card.appendChild(top)

  // Status label
  const statusLabel = document.createElement('p')
  if (correctionRequired) {
    statusLabel.textContent = 'Correction required — edit the Report and confirm a new submission'
    statusLabel.className = 'rc-status rc-status--pending'
  } else if (isPending) {
    const isRetrying = retryingIds.has(visit.id)
    const errText = retryErrors.get(visit.id)
    statusLabel.textContent = isRetrying
      ? 'Sending report…'
      : errText
        ? `Pending send — ${errText}`
        : 'Pending send — will retry when online'
    statusLabel.className = 'rc-status rc-status--pending'
  } else if (isDownloaded) {
    statusLabel.textContent = 'Downloaded locally — not sent'
    statusLabel.className = 'rc-status rc-status--downloaded'
  } else {
    statusLabel.textContent = 'Sent'
    statusLabel.className = 'rc-status rc-status--sent'
  }
  card.appendChild(statusLabel)

  // Actions
  const actions = document.createElement('div')
  actions.className = 'rc-actions'

  if (correctionRequired) {
    const correctBtn = document.createElement('button')
    correctBtn.className = 'rc-btn rc-btn--secondary'
    correctBtn.textContent = 'Correct report'
    correctBtn.addEventListener('click', () => {
      sessionStorage.setItem('workspace:visitId', visit.id)
      navigate('/workspace')
    })
    actions.appendChild(correctBtn)

    const previewBtn = document.createElement('button')
    previewBtn.className = 'rc-btn rc-btn--ghost'
    previewBtn.textContent = 'Review saved submission'
    previewBtn.addEventListener('click', e => {
      e.stopPropagation()
      openReportPreview(visit)
    })
    actions.appendChild(previewBtn)
    card.appendChild(actions)
    return card
  }

  if (isPending) {
    const isRetrying = retryingIds.has(visit.id)
    const retryBtn = document.createElement('button')
    retryBtn.className   = 'rc-btn rc-btn--secondary'
    retryBtn.disabled    = isRetrying
    retryBtn.textContent = isRetrying ? 'Sending…' : 'Retry send'
    retryBtn.addEventListener('click', e => {
      e.stopPropagation()
      void retrySingleSubmission(visit)
    })
    actions.appendChild(retryBtn)

    const previewBtn = document.createElement('button')
    previewBtn.className   = 'rc-btn rc-btn--ghost'
    previewBtn.textContent = 'View report'
    previewBtn.addEventListener('click', e => {
      e.stopPropagation()
      openReportPreview(visit)
    })
    actions.appendChild(previewBtn)

    card.appendChild(actions)
    return card
  }

  const previewBtn = document.createElement('button')
  previewBtn.className   = 'rc-btn rc-btn--secondary'
  previewBtn.textContent = 'View report'
  previewBtn.addEventListener('click', () => openReportPreview(visit))
  actions.appendChild(previewBtn)

  const downloadBtn = document.createElement('button')
  downloadBtn.className   = 'rc-btn rc-btn--ghost'
  downloadBtn.textContent = 'Download'
  downloadBtn.addEventListener('click', e => {
    e.stopPropagation()
    showDownloadMenu(downloadBtn, visit)
  })
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

function formatLocalSnapshotPreview (visit) {
  const snap = visit?.snapshot
  if (!snap) return null
  const lines = [
    `${snap.address?.street ?? visit.address?.street ?? '—'}`,
    `Status: ${snap.terminalIntent ?? 'pending'} (Pending send)`,
    `Service: ${snap.cancel ? 'Cancel' : (snap.service?.serviceName ?? '—')}`,
    `Total: ${formatPrice(snap.totalPrice ?? visit.total_price ?? 0)}`,
  ]
  if (Array.isArray(snap.items) && snap.items.length > 0) {
    lines.push(
      'Items:',
      ...snap.items.map(item => `  - ${item.item_name ?? item.itemName} x${item.quantity ?? 1}`)
    )
  }
  if (snap.notes) {
    lines.push(`Notes: ${snap.notes}`)
  }
  return lines.join('\n')
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

  if (visit._localPending && visit.snapshot) {
    body.innerHTML = ''
    const pre = document.createElement('pre')
    pre.className   = 'rp-preview-text'
    pre.textContent = formatLocalSnapshotPreview(visit)
    body.appendChild(pre)
    return
  }

  try {
    const preview = await api.get(`/visits/${visit.id}/report-preview`)
    body.innerHTML = ''
    const pre = document.createElement('pre')
    pre.className   = 'rp-preview-text'
    pre.textContent = preview?.reportText ?? preview?.text ?? JSON.stringify(preview, null, 2)
    body.appendChild(pre)
  } catch (err) {
    const fallback = formatLocalSnapshotPreview(visit)
    if (fallback) {
      body.innerHTML = ''
      const pre = document.createElement('pre')
      pre.className   = 'rp-preview-text'
      pre.textContent = fallback
      body.appendChild(pre)
      return
    }
    body.textContent = 'Could not load report preview.'
    console.error('Preview failed:', err)
  }
}

// Same anchored menu as showCardMenu.
function showDownloadMenu (anchorEl, visit) {
  document.querySelector('.rc-context-menu')?.remove()
  const menu = document.createElement('div')
  menu.className = 'rc-context-menu'
  ;[
    ['json', 'JSON'],
    ['zip', 'ZIP — photos'],
    ['all', 'All — JSON + photos'],
  ].forEach(([kind, label]) => {
    const item = document.createElement('button')
    item.className   = 'rc-context-item'
    item.textContent = label
    item.addEventListener('click', () => {
      menu.remove()
      void downloadReport(visit, kind)
    })
    menu.appendChild(item)
  })
  const rect = anchorEl.getBoundingClientRect()
  menu.style.top   = `${rect.bottom + 4}px`
  menu.style.right = `${window.innerWidth - rect.right}px`
  document.body.appendChild(menu)

  function close (e) { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close) } }
  setTimeout(() => document.addEventListener('click', close), 0)
}

async function downloadReport (visit, kind) {
  try {
    const { fileName, blob, missing } = await buildReportDownload(visit, kind)
    if (blob) {
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = fileName
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      downloadedIds.add(visit.id)
      renderList()
    }
    if (missing.length) {
      const lines = missing.map(m => `${m.name} — ${m.needsConnection ? 'needs connection' : 'not available'}`)
      alert(`${blob ? 'Downloaded without' : 'Nothing to download'}:\n${lines.join('\n')}`)
    } else if (!blob) {
      alert('This report has no photos.')
    }
  } catch (err) {
    console.error('Download failed:', err)
    alert('Download failed.')
  }
}

function buildHeader () {
  const header = document.createElement('div')
  header.className = 'screen-header'
  header.appendChild(HomeTabs({ active: 'reports', onNavigate: navigate }))

  const retryAllBtn = document.createElement('button')
  retryAllBtn.id = 'reports-retry-all-btn'
  retryAllBtn.className = 'rc-btn rc-btn--secondary'
  retryAllBtn.style.display = 'none'
  retryAllBtn.textContent = 'Retry pending'
  retryAllBtn.addEventListener('click', () => {
    void retryAllPending()
  })
  header.appendChild(retryAllBtn)
  return header
}

function updateHeaderRetryBtn () {
  const btn = document.getElementById('reports-retry-all-btn')
  if (!btn) return
  const hasPending = pendingSubmissions.length > 0
  btn.style.display = hasPending ? '' : 'none'
  const anyRetrying = retryingIds.size > 0
  btn.disabled = anyRetrying
  btn.textContent = anyRetrying ? 'Sending…' : 'Retry pending'
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
  .skeleton-card { height:110px; border-radius:var(--fo-radius); background:var(--fo-well); box-shadow:var(--fo-shadow-well); animation:shimmer 1.4s ease-in-out infinite; }
  @keyframes shimmer { 0%,100%{opacity:.5} 50%{opacity:1} }

  .rc-menu-btn { background:none; border:none; color:var(--fo-ink-soft); font-size:18px; cursor:pointer; padding:0 2px; letter-spacing:1px; line-height:1; -webkit-tap-highlight-color:transparent; }
  .rc-context-menu { position:fixed; background:var(--fo-panel); box-shadow:var(--fo-shadow-card); border-radius:var(--fo-radius-sm); padding:var(--space-2) 0; min-width:180px; z-index:100; }
  .rc-context-item { display:block; width:100%; background:none; border:none; text-align:left; font-size:var(--text-base); color:var(--fo-ink); padding:var(--space-3) var(--space-4); cursor:pointer; }
  .rc-context-item:active { background:var(--fo-well); box-shadow:var(--fo-shadow-inset); }
  .rp-overlay { position:fixed; inset:0; background:var(--fo-scrim); display:flex; align-items:flex-end; z-index:100; }
  .rp-modal { width:100%; background:var(--fo-panel); box-shadow:var(--fo-shadow-card); border-radius:var(--fo-radius) var(--fo-radius) 0 0; max-height:80dvh; display:flex; flex-direction:column; padding-bottom:env(safe-area-inset-bottom,0px); }
  .rp-modal-header { display:flex; justify-content:space-between; align-items:center; padding:var(--space-4) var(--space-4) var(--space-3); box-shadow:inset 0 -1px 0 var(--fo-panel-lo); flex-shrink:0; }
  .rp-modal-title { font-size:var(--text-base); font-weight:700; color:var(--fo-ink); }
  .rp-close-btn { background:none; border:none; color:var(--fo-ink-soft); font-size:22px; cursor:pointer; padding:0 4px; line-height:1; }
  .rp-modal-body { flex:1; overflow-y:auto; padding:var(--space-4); }
  .rp-preview-text { font-family:var(--fo-font-mono); font-size:var(--text-sm); color:var(--fo-ink); background:var(--fo-well); box-shadow:var(--fo-shadow-well); border-radius:var(--fo-radius-sm); padding:var(--space-3); display:block; white-space:pre-wrap; word-break:break-word; line-height:1.6; }
`
