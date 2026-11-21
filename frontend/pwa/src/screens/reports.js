/**
 * src/screens/reports.js
 * Reports — today's completed visits with send status.
 *
 * Status icons:
 *   sent            — ✓ green
 *   pending_send    — ⏳ amber (queued, will retry)
 *
 * Exported as default(appEl) per app.js routing contract.
 */

import { api }                  from '../../../shared/api.js'
import { NavBar, navBarStyles } from '../components/nav-bar.js'
import { HomeTabs, attachHomeSwipe, homeTabStyles } from '../components/home-tabs.js'
import {
  getActiveTechnicianId,
  getAllCompletionSubmissions,
  getCatalog,
  getPendingCompletionSubmissions,
} from '../lib/db.js'
import {
  deliverCompletionSubmission,
  describeReportMismatch,
  retryPendingCompletionSubmissions,
} from '../lib/completion-submission.mjs'
import { startSync }            from '../lib/sync.js'
import { buildReportDownload }  from '../lib/report-download.mjs'
import { companyFormLinks }     from '../lib/company-form.mjs'
import { receiptModel }         from '../lib/receipt.mjs'
import { REFRESH_CALL_DATA_KEY } from '../lib/workspace-visit.mjs'
import { Receipt, receiptStyles } from '../components/receipt.js'
import { CorrectionModal, correctionModalStyles } from '../components/correction-modal.js'

const STYLES_ID = 'styles-reports'
const TERMINAL_VISIT_STATUSES = new Set(['completed', 'temporarily', 'cancelled'])

function injectStyles () {
  if (document.getElementById(STYLES_ID)) return
  const style = document.createElement('style')
  style.id = STYLES_ID
  style.textContent = screenStyles + navBarStyles + correctionModalStyles + homeTabStyles + receiptStyles
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
let openReceiptIds = new Set()
let serverReports = new Map()
let receiptCatalog = { services: [], items: [] }

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

  try {
    const [services, items] = await Promise.all([getCatalog('services'), getCatalog('items')])
    receiptCatalog = { services: services ?? [], items: items ?? [] }
  } catch (_) {}

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

  ;[...pendingCards, ...sorted].forEach(visit => listEl.appendChild(buildReportEntry(visit)))
}

// W4: the receipt slides out from behind its card; cards below move down.
// A delivered Report shows the server's version (PP-01 price corrections
// marked), fetched on open; until then, or offline, the phone's snapshot.
function isDelivered (visit) {
  return !(visit._localPending || queuedIds.has(visit.id)) && visit._correctionRequired !== true
}

function receiptContent (visit) {
  const server = isDelivered(visit) ? serverReports.get(visit.id) : null
  const source = server ?? visit.snapshot
  if (!source) {
    const note = document.createElement('p')
    note.className = 'rc-receipt-note'
    note.textContent = navigator.onLine === false ? 'Needs connection — this report is not on this phone.' : 'Loading report…'
    return note
  }
  return Receipt(receiptModel(source, {
    catalog: receiptCatalog,
    technicianName: server ? null : technicianName(),
  }))
}

async function loadServerReceipt (visit, paper) {
  if (!isDelivered(visit) || serverReports.has(visit.id)) return
  try {
    serverReports.set(visit.id, await api.get(`/visits/${visit.id}/download`))
  } catch (_) {
    if (visit.snapshot) return
  }
  paper.replaceChildren(receiptContent(visit))
}

function buildReportEntry (visit) {
  const wrap = document.createElement('div')
  wrap.className = 'rc-wrap'
  wrap.appendChild(buildReportCard(visit))
  const open = openReceiptIds.has(visit.id)
  const slot = document.createElement('div')
  slot.className = `rc-slot${open ? ' open' : ''}`
  slot.setAttribute('aria-hidden', String(!open))
  const clip = document.createElement('div')
  const paper = document.createElement('div')
  paper.className = 'rc-paper'
  paper.appendChild(receiptContent(visit))
  clip.appendChild(paper)
  slot.appendChild(clip)
  wrap.appendChild(slot)
  if (open) void loadServerReceipt(visit, paper)
  return wrap
}

function technicianName () {
  try { return JSON.parse(localStorage.getItem('technician') ?? 'null')?.name ?? null } catch { return null }
}

function buildViewButton (visit, { label, className }) {
  const btn = document.createElement('button')
  btn.className = className
  btn.textContent = openReceiptIds.has(visit.id) ? 'Hide report' : label
  btn.addEventListener('click', e => {
    e.stopPropagation()
    const slot = btn.closest('.rc-wrap')?.querySelector('.rc-slot')
    const open = !slot.classList.contains('open')
    slot.classList.toggle('open', open)
    slot.setAttribute('aria-hidden', String(!open))
    if (open) openReceiptIds.add(visit.id)
    else openReceiptIds.delete(visit.id)
    btn.textContent = open ? 'Hide report' : label
    if (open) void loadServerReceipt(visit, slot.querySelector('.rc-paper'))
  })
  return btn
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

  const statusIcon = buildStatusIcon(isPending || correctionRequired)
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
    statusLabel.textContent = describeReportMismatch(visit._submissionRecord?.mismatchFields)
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
    statusLabel.textContent = 'Sent · downloaded'
    statusLabel.className = 'rc-status rc-status--sent'
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
      sessionStorage.setItem(REFRESH_CALL_DATA_KEY, visit.id)
      navigate('/workspace')
    })
    actions.appendChild(correctBtn)

    actions.appendChild(buildViewButton(visit, { label: 'Review saved submission', className: 'rc-btn rc-btn--ghost' }))
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

    actions.appendChild(buildViewButton(visit, { label: 'View report', className: 'rc-btn rc-btn--ghost' }))
    actions.appendChild(buildDownloadButton(visit, { delivered: false }))

    card.appendChild(actions)
    return card
  }

  actions.appendChild(buildViewButton(visit, { label: 'View report', className: 'rc-btn rc-btn--secondary' }))

  actions.appendChild(buildDownloadButton(visit, { delivered: true }))
  actions.appendChild(buildCompanyFormButton(visit))

  card.appendChild(actions)
  return card
}

// PP-03: the Company's Google Form, prefilled per system, from the server's
// Report when loaded (fetched on open), otherwise the phone's snapshot.
function buildCompanyFormButton (visit) {
  const btn = document.createElement('button')
  btn.className   = 'rc-btn rc-btn--ghost'
  btn.textContent = 'Company form'
  btn.addEventListener('click', async e => {
    e.stopPropagation()
    if (!serverReports.has(visit.id) && navigator.onLine !== false) {
      try { serverReports.set(visit.id, await api.get(`/visits/${visit.id}/download`)) } catch (_) {}
    }
    const report = serverReports.get(visit.id) ?? visit.snapshot
    if (!report) { alert('Needs connection — this report is not on this phone.'); return }
    showCompanyFormMenu(btn, companyFormLinks(report))
  })
  return btn
}

function showCompanyFormMenu (anchorEl, links) {
  document.querySelector('.rc-context-menu')?.remove()
  const menu = document.createElement('div')
  menu.className = 'rc-context-menu'
  if (!links.length) {
    const none = document.createElement('p')
    none.className = 'rc-context-note'
    none.textContent = 'No systems on this report.'
    menu.appendChild(none)
  }
  for (const link of links) {
    const item = document.createElement('button')
    item.className   = 'rc-context-item'
    item.textContent = `System ${link.systemNumber}`
    if (link.url) {
      item.addEventListener('click', () => {
        menu.remove()
        window.open(link.url, '_blank', 'noopener')
      })
    } else {
      item.disabled = true
      const note = document.createElement('span')
      note.className = 'rc-context-note'
      note.textContent = `Missing: ${link.missing.join(', ')}`
      item.appendChild(note)
    }
    menu.appendChild(item)
  }
  const rect = anchorEl.getBoundingClientRect()
  menu.style.top   = `${rect.bottom + 4}px`
  menu.style.right = `${window.innerWidth - rect.right}px`
  document.body.appendChild(menu)

  function close (e) { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close) } }
  setTimeout(() => document.addEventListener('click', close), 0)
}

function buildDownloadButton (visit, { delivered }) {
  const downloadBtn = document.createElement('button')
  downloadBtn.className   = 'rc-btn rc-btn--ghost'
  downloadBtn.textContent = 'Download'
  downloadBtn.addEventListener('click', e => {
    e.stopPropagation()
    showDownloadMenu(downloadBtn, visit, { delivered })
  })
  return downloadBtn
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

function buildStatusIcon (isPending) {
  const wrap = document.createElement('div')
  wrap.className = 'rc-status-icon'
  if (isPending) {
    wrap.textContent = '⏳'
    wrap.title = 'Pending send'
  } else {
    wrap.textContent = '✓'
    wrap.classList.add('rc-status-icon--sent')
    wrap.title = 'Sent'
  }
  return wrap
}

function showDownloadMenu (anchorEl, visit, { delivered }) {
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
      void downloadReport(visit, kind, { delivered })
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

async function downloadReport (visit, kind, { delivered }) {
  try {
    const { fileName, blob, missing } = await buildReportDownload(visit, kind, { delivered })
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
      const lines = missing.map(m => `${m.name} — ${m.waitingUpload ? 'still uploading (GPS is added on the server)' : m.needsConnection ? 'needs connection' : 'not available'}`)
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
  .rc-wrap .report-card { position:relative; z-index:2; }
  .rc-receipt-note { margin:0; padding:26px 18px 18px; background:var(--fo-paper); color:var(--fo-ink-soft); font-size:var(--text-sm); text-align:center; }
  .rc-slot { display:grid; grid-template-rows:0fr; transition:grid-template-rows .55s cubic-bezier(.3,.7,.2,1), margin .55s cubic-bezier(.3,.7,.2,1); margin:0 10px; }
  .rc-slot.open { grid-template-rows:1fr; margin:-14px 10px var(--space-2); }
  .rc-slot > div { overflow:hidden; }
  .rc-paper { transform:translateY(-100%); transition:transform .55s cubic-bezier(.3,.7,.2,1); }
  .rc-slot.open .rc-paper { transform:none; }
  @media (prefers-reduced-motion: reduce) { .rc-slot, .rc-paper { transition:none; } }

  .report-card { background:var(--fo-panel); box-shadow:var(--fo-shadow-raised); border-radius:var(--fo-radius); padding:var(--space-4); display:flex; flex-direction:column; gap:var(--space-2); }
  .rc-top { display:flex; justify-content:space-between; align-items:flex-start; gap:var(--space-3); }
  .rc-left { display:flex; flex-direction:column; gap:2px; flex:1; min-width:0; }
  .rc-address { font-size:var(--text-base); font-weight:800; color:var(--fo-ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .rc-meta { font-size:var(--text-sm); font-family:var(--fo-font-mono); color:var(--fo-ink-soft); }
  .rc-status-icon { font-size:18px; flex-shrink:0; }
  .rc-status-icon--sent { color: var(--fo-ok); }
  .rc-status { font-size:var(--text-sm); font-family:var(--fo-font-mono); }
  .rc-status--pending { color: var(--fo-accent); }
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
  .rc-context-item:disabled { color:var(--fo-ink-soft); cursor:default; }
  .rc-context-note { display:block; margin:2px 0 0; padding:0 var(--space-4); font-size:var(--text-xs); color:var(--fo-ink-soft); }
  .rc-context-item .rc-context-note { padding:0; }
`
