/**
 * src/components/job-card.js
 * Expandable job card for the My Calls list.
 *
 * States:
 *   collapsed   — address, builder, work type, time, status badge
 *   expanded    — + system quick info, builder contact, weigh-in ref, action buttons
 *   in_progress — expanded + "Open Workspace" as primary action
 *
 * Usage:
 *   import { JobCard } from '../components/job-card.js'
 *   const card = JobCard({ visit, onStart, onOpenWorkspace, onNavigate, onItemsLoaded })
 *   listEl.appendChild(card)
 */

import { api } from '../../../shared/api.js'
import { Badge, Tag } from './badge.js'

export function JobCard ({ visit, onStart, onOpenWorkspace, onNavigate, onItemsLoaded }) {
  let expanded  = false
  let fullVisit = null   // loaded on first expand
  let loading   = false

  const el = document.createElement('div')
  el.className = `job-card ${visit.is_deferred ? 'job-card--deferred' : ''}`
  el.dataset.visitId = visit.id

  render()

  function render () {
    el.innerHTML = ''

    // ── Header (always visible) ──────────────────────────
    const header = document.createElement('div')
    header.className = 'jc-header'

    const left = document.createElement('div')
    left.className = 'jc-header-left'

    const badgeEl = Badge(visit.is_deferred ? 'deferred' : visit.status)
    left.appendChild(badgeEl)

    const addr = document.createElement('p')
    addr.className   = 'jc-address'
    addr.textContent = visit.address?.street ?? '—'
    left.appendChild(addr)

    const meta = document.createElement('p')
    meta.className   = 'jc-meta'
    meta.textContent = `${visit.builder ?? '—'} · ${formatWorkType(visit.work_type)}`
    left.appendChild(meta)

    const right = document.createElement('div')
    right.className = 'jc-header-right'

    const time = document.createElement('span')
    time.className   = 'jc-time'
    time.textContent = formatTime(visit.scheduled_time)
    right.appendChild(time)

    const iconRow = document.createElement('div')
    iconRow.className = 'jc-header-icons'

    // Navigate button — opens the device's default maps app
    const navBtn = document.createElement('button')
    navBtn.className = 'jc-nav-btn'
    navBtn.innerHTML  = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>'
    navBtn.setAttribute('aria-label', 'Navigate to address')
    navBtn.addEventListener('click', e => {
      e.stopPropagation()
      const addrParts = [visit.address?.street, visit.address?.city].filter(Boolean)
      window.open('https://maps.google.com/maps?q=' + encodeURIComponent(addrParts.join(', ')), '_blank')
    })
    iconRow.appendChild(navBtn)

    // Three-dot menu button — reserved for low-frequency actions
    const menuBtn = document.createElement('button')
    menuBtn.className   = 'jc-menu-btn'
    menuBtn.innerHTML   = '···'
    menuBtn.setAttribute('aria-label', 'More options')
    menuBtn.addEventListener('click', e => {
      e.stopPropagation()
      showContextMenu(menuBtn, visit)
    })
    iconRow.appendChild(menuBtn)

    right.appendChild(iconRow)

    header.appendChild(left)
    header.appendChild(right)

    // Make header tappable to expand/collapse
    header.addEventListener('click', toggleExpand)
    el.appendChild(header)

    // ── Tags row ─────────────────────────────────────────
    const tags = buildTags(visit)
    if (tags.length) {
      const tagsRow = document.createElement('div')
      tagsRow.className = 'jc-tags'
      tags.forEach(t => tagsRow.appendChild(t))
      el.appendChild(tagsRow)
    }

    // ── Expanded content ──────────────────────────────────
    if (expanded) {
      const body = document.createElement('div')
      body.className = 'jc-body'

      if (loading) {
        const spinner = document.createElement('div')
        spinner.className   = 'jc-spinner'
        spinner.textContent = 'Loading…'
        body.appendChild(spinner)
      } else if (fullVisit) {
        body.appendChild(buildExpandedContent(fullVisit))
      }

      el.appendChild(body)

      // ── Action buttons ────────────────────────────────
      const actions = document.createElement('div')
      actions.className = 'jc-actions'

      if (visit.status === 'in_progress') {
        const wsBtn = document.createElement('button')
        wsBtn.className   = 'jc-btn jc-btn--primary'
        wsBtn.textContent = 'Open Workspace'
        wsBtn.addEventListener('click', e => {
          e.stopPropagation()
          sessionStorage.setItem('workspace:visitId', visit.id)
          onOpenWorkspace?.(visit.id)
        })
        actions.appendChild(wsBtn)
      } else if (visit.status === 'assigned' || visit.status === 'deferred') {
        const startBtn = document.createElement('button')
        startBtn.className   = 'jc-btn jc-btn--primary'
        startBtn.textContent = 'Start'
        startBtn.addEventListener('click', async e => {
          e.stopPropagation()
          startBtn.disabled    = true
          startBtn.textContent = 'Starting…'
          try {
            await api.post(`/visits/${visit.id}/start`)
            visit.status = 'in_progress'
            render()
          } catch (err) {
            startBtn.disabled    = false
            startBtn.textContent = 'Start'
            console.error('Start failed:', err)
          }
        })
        actions.appendChild(startBtn)
      }

      el.appendChild(actions)
    }
  }

  async function toggleExpand (e) {
    // Don't toggle if user tapped a button
    if (e.target.closest('button')) return

    expanded = !expanded

    if (expanded && !fullVisit) {
      loading = true
      render()
      try {
        fullVisit = await api.get(`/visits/${visit.id}`)
        // Expose loaded items on the shared visit object so My Calls can
        // aggregate them into the Load Sheet Summary without a second fetch.
        visit.items = fullVisit.items
        onItemsLoaded?.()
        // Also fetch weigh-in reference if address exists
        if (fullVisit.address_id) {
          try {
            fullVisit._weighIn = await api.get(`/addresses/${fullVisit.address_id}/weigh-in`)
          } catch (_) { /* no prior weigh-in — that's fine */ }
        }
      } catch (err) {
        console.error('Failed to load visit detail:', err)
      } finally {
        loading = false
      }
    }

    render()
  }

  function buildExpandedContent (v) {
    const wrap = document.createElement('div')
    wrap.className = 'jc-detail'

    // Systems quick info
    if (v.systems?.length) {
      const section = document.createElement('div')
      section.className = 'jc-section'

      v.systems.forEach((sys, i) => {
        const row = document.createElement('div')
        row.className = 'jc-detail-group'

        if (v.systems.length > 1) {
          const label = document.createElement('p')
          label.className   = 'jc-section-label'
          label.textContent = `System ${i + 1}`
          row.appendChild(label)
        }

        row.appendChild(detailRow('Indoor',  sys.indoor_model  ?? '—', 'jc-detail-value--chip'))
        row.appendChild(detailRow('Outdoor', sys.outdoor_model ?? '—', 'jc-detail-value--chip'))
        if (sys.refrigerant) {
          row.appendChild(detailRow('Refrigerant', sys.refrigerant))
        }
        section.appendChild(row)
      })

      wrap.appendChild(section)
    }

    // Order number
    if (v.order_number) {
      wrap.appendChild(detailRow('Order #', v.order_number))
    }

    // Builder contact
    if (v.builder_contact_name || v.builder_contact_phone) {
      const contactRow = document.createElement('div')
      contactRow.className = 'jc-detail-row'

      const lbl = document.createElement('span')
      lbl.className   = 'jc-detail-label'
      lbl.textContent = 'Contact'

      const val = document.createElement('span')
      val.className = 'jc-detail-value'

      if (v.builder_contact_phone) {
        const link = document.createElement('a')
        link.href        = `tel:${v.builder_contact_phone}`
        link.className   = 'jc-contact-link'
        link.textContent = v.builder_contact_name ?? v.builder_contact_phone
        val.appendChild(link)
      } else {
        val.textContent = v.builder_contact_name ?? '—'
      }

      contactRow.appendChild(lbl)
      contactRow.appendChild(val)
      wrap.appendChild(contactRow)
    }

    // Company notes
    if (v.company_notes) {
      const notesSection = document.createElement('div')
      notesSection.className = 'jc-notes-ref'
      notesSection.textContent = v.company_notes
      wrap.appendChild(notesSection)
    }

    // Previous weigh-in reference (collapsed summary)
    if (v._weighIn && Object.keys(v._weighIn).length > 0) {
      const weighIn = document.createElement('div')
      weighIn.className = 'jc-weigh-ref'

      const label = document.createElement('p')
      label.className   = 'jc-section-label'
      label.textContent = 'Prior weigh-in on file'
      weighIn.appendChild(label)

      wrap.appendChild(weighIn)
    }

    return wrap
  }

  return el
}

// ── Context menu (··· button) ─────────────────────────────
// Empty at F1 — Transfer action added in F9.

function showContextMenu (anchorEl, visit) {
  document.querySelector('.jc-context-menu')?.remove()

  const menu = document.createElement('div')
  menu.className = 'jc-context-menu'

  // Transfer Visit action
  if (['assigned', 'in_progress'].includes(visit.status)) {
    const transferBtn = document.createElement('button')
    transferBtn.className   = 'jc-context-item'
    transferBtn.textContent = 'Transfer Visit'
    transferBtn.addEventListener('click', () => {
      menu.remove()
      sessionStorage.setItem('transfer:preselectedVisitId', visit.id)
      window.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: '/transfers' } }))
    })
    menu.appendChild(transferBtn)
  } else {
    const empty = document.createElement('p')
    empty.className   = 'jc-context-empty'
    empty.textContent = 'No actions available'
    menu.appendChild(empty)
  }

  const rect = anchorEl.getBoundingClientRect()
  menu.style.top   = `${rect.bottom + 4}px`
  menu.style.right = `${window.innerWidth - rect.right}px`

  document.body.appendChild(menu)

  function close (e) {
    if (!menu.contains(e.target)) {
      menu.remove()
      document.removeEventListener('click', close)
    }
  }
  setTimeout(() => document.addEventListener('click', close), 0)
}

// ── Helpers ───────────────────────────────────────────────

function detailRow (label, value, valueClass) {
  const row = document.createElement('div')
  row.className = 'jc-detail-row'

  const lbl = document.createElement('span')
  lbl.className   = 'jc-detail-label'
  lbl.textContent = label

  const val = document.createElement('span')
  val.className   = `jc-detail-value${valueClass ? ' ' + valueClass : ''}`
  val.textContent = value

  row.appendChild(lbl)
  row.appendChild(val)
  return row
}

function buildTags (visit) {
  const tags = []
  if (visit.is_a2l)          tags.push(Tag('A2L', 'signal'))
  if (visit.has_multiple_systems) tags.push(Tag('Multi-system', 'default'))
  if (visit.is_urgent)       tags.push(Tag('Urgent', 'heat'))
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
  } catch (_) {
    return '—'
  }
}

// ── Styles ────────────────────────────────────────────────

export const jobCardStyles = `
  .job-card {
    background: var(--fo-panel);
    border-radius: var(--fo-radius);
    border: none;
    overflow: hidden;
    box-shadow: var(--fo-shadow-raised);
    transition: box-shadow var(--dur-fast) var(--ease-out);
  }

  .job-card--deferred {
    border: 1px solid var(--fo-accent);
  }

  .jc-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: var(--space-4);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    gap: var(--space-3);
  }

  .jc-header-left {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    flex: 1;
    min-width: 0;
  }

  .jc-header-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-1);
    flex-shrink: 0;
  }

  .jc-header-left .badge {
    font-family: var(--fo-font-mono);
    border-radius: 20px;
    background: var(--fo-panel);
    color: var(--fo-ink-soft);
    box-shadow: var(--fo-shadow-subtle);
  }

  .jc-address {
    font-family: var(--fo-font-body);
    font-size: 16px;
    font-weight: 800;
    color: var(--fo-ink);
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .jc-meta {
    font-family: var(--fo-font-mono);
    font-size: 10px;
    letter-spacing: 0.03em;
    color: var(--fo-ink-soft);
  }

  .jc-time {
    font-family: var(--fo-font-mono);
    font-size: 10px;
    letter-spacing: 0.03em;
    color: var(--fo-ink-soft);
  }

  .jc-menu-btn {
    background: var(--fo-panel);
    border: none;
    color: var(--fo-ink-soft);
    font-size: 16px;
    cursor: pointer;
    width: 28px;
    height: 28px;
    border-radius: var(--fo-radius-sm);
    box-shadow: var(--fo-shadow-subtle);
    letter-spacing: 1px;
    line-height: 1;
    -webkit-tap-highlight-color: transparent;
  }

  .jc-header-icons {
    display: flex;
    gap: var(--space-1);
  }

  .jc-nav-btn {
    background: var(--fo-panel);
    border: none;
    color: var(--fo-accent-deep);
    cursor: pointer;
    width: 28px;
    height: 28px;
    border-radius: var(--fo-radius-sm);
    box-shadow: var(--fo-shadow-subtle);
    display: flex;
    align-items: center;
    justify-content: center;
    -webkit-tap-highlight-color: transparent;
  }

  .jc-tags {
    display: flex;
    gap: var(--space-2);
    padding: 0 var(--space-4) var(--space-3);
    flex-wrap: wrap;
  }

  .jc-tags .tag {
    font-family: var(--fo-font-mono);
    font-size: 8px;
    letter-spacing: 0.11em;
    padding: 2px 6px;
    border: none;
    border-radius: 20px;
    background: var(--fo-panel);
    color: var(--fo-ink-soft);
    box-shadow: var(--fo-shadow-subtle);
  }

  .jc-tags .tag--heat    { color: var(--fo-no); }
  .jc-tags .tag--signal  { color: var(--fo-ink-soft); }
  .jc-tags .tag--default { color: var(--fo-ink-soft); }

  .jc-body {
    padding: 0 var(--space-4) var(--space-3);
  }

  .jc-spinner {
    font-family: var(--fo-font-mono);
    font-size: 11px;
    color: var(--fo-ink-soft);
    padding: var(--space-3) 0;
    text-align: center;
  }

  .jc-detail {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    background: var(--fo-well);
    box-shadow: var(--fo-shadow-well);
    border-radius: var(--fo-radius-md);
    padding: var(--space-3) var(--space-3);
  }

  .jc-detail-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .jc-detail-group + .jc-detail-group {
    border-top: 0.5px solid var(--fo-panel-lo);
    padding-top: var(--space-2);
    margin-top: var(--space-1);
  }

  .jc-section-label {
    font-family: var(--fo-font-mono);
    font-size: 9px;
    font-weight: 600;
    color: var(--fo-ink-soft);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: var(--space-1);
  }

  .jc-detail-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-3);
  }

  .jc-detail-label {
    font-family: var(--fo-font-mono);
    font-size: 10px;
    letter-spacing: 0.03em;
    color: var(--fo-ink-soft);
    flex-shrink: 0;
  }

  .jc-detail-value {
    font-family: var(--fo-font-body);
    font-size: 12.5px;
    font-weight: 600;
    color: var(--fo-ink);
    text-align: right;
  }

  .jc-detail-value--chip {
    font-family: var(--fo-font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--fo-ink-soft);
    background: var(--fo-tile);
    box-shadow: var(--fo-shadow-subtle);
    border-radius: var(--fo-radius-sm);
    padding: 3px 9px;
  }

  .jc-contact-link {
    color: var(--fo-accent-deep);
    text-decoration: none;
    font-family: var(--fo-font-body);
    font-size: 12.5px;
    font-weight: 600;
  }

  .jc-notes-ref {
    font-family: var(--fo-font-body);
    font-size: 12px;
    color: var(--fo-ink-soft);
    font-style: italic;
    line-height: 1.5;
    padding-top: var(--space-2);
    margin-top: var(--space-1);
  }

  .jc-weigh-ref {
    padding-top: var(--space-2);
    margin-top: var(--space-1);
  }

  .jc-actions {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4) var(--space-4);
  }

  .jc-btn {
    flex: 1;
    border: none;
    border-radius: var(--fo-radius-sm);
    font-family: var(--fo-font-body);
    font-weight: 800;
    font-size: 14px;
    letter-spacing: 0.02em;
    padding: var(--space-3) var(--space-4);
    cursor: pointer;
    transition: transform 0.08s ease, opacity var(--dur-fast) var(--ease-out);
    -webkit-tap-highlight-color: transparent;
  }

  .jc-btn:active {
    transform: translateY(1px);
  }

  .jc-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .jc-btn--primary {
    background: var(--fo-panel);
    color: var(--fo-accent-deep);
    box-shadow: var(--fo-shadow-raised);
  }

  .jc-btn--primary:active {
    box-shadow: var(--fo-shadow-inset);
  }

  .jc-btn--secondary {
    background: var(--fo-well);
    color: var(--fo-ink-soft);
    box-shadow: var(--fo-shadow-well);
  }

  /* Context menu */
  .jc-context-menu {
    position: fixed;
    background: var(--fo-panel);
    border: none;
    border-radius: var(--fo-radius-md);
    padding: var(--space-2) 0;
    min-width: 160px;
    z-index: 100;
    box-shadow: var(--fo-shadow-card);
  }

  .jc-context-empty {
    font-family: var(--fo-font-mono);
    font-size: 10px;
    color: var(--fo-ink-soft);
    padding: var(--space-3) var(--space-4);
    text-align: center;
  }

  .jc-context-item {
    display: block;
    width: 100%;
    background: none;
    border: none;
    text-align: left;
    font-family: var(--fo-font-mono);
    font-size: 11px;
    color: var(--fo-ink);
    padding: var(--space-3) var(--space-4);
    cursor: pointer;
  }

  .jc-context-item:active {
    background: var(--fo-well);
  }

  .jc-context-item--destructive {
    color: var(--fo-no);
  }
`
