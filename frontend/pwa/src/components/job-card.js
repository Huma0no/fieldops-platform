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
 *   const card = JobCard({ visit, onStart, onOpenWorkspace, onNavigate })
 *   listEl.appendChild(card)
 */

import { api } from '../../../shared/api.js'
import { Badge, Tag } from './badge.js'

export function JobCard ({ visit, onStart, onOpenWorkspace, onNavigate }) {
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

    // Three-dot menu button — reserved for low-frequency actions
    const menuBtn = document.createElement('button')
    menuBtn.className   = 'jc-menu-btn'
    menuBtn.innerHTML   = '···'
    menuBtn.setAttribute('aria-label', 'More options')
    menuBtn.addEventListener('click', e => {
      e.stopPropagation()
      showContextMenu(menuBtn, visit)
    })
    right.appendChild(menuBtn)

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

        row.appendChild(detailRow('Indoor',  sys.indoor_model  ?? '—'))
        row.appendChild(detailRow('Outdoor', sys.outdoor_model ?? '—'))
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
  // Remove any existing menu
  document.querySelector('.jc-context-menu')?.remove()

  const menu = document.createElement('div')
  menu.className = 'jc-context-menu'

  // Placeholder — actions added per phase
  const empty = document.createElement('p')
  empty.className   = 'jc-context-empty'
  empty.textContent = 'No actions available'
  menu.appendChild(empty)

  // Position near anchor
  const rect = anchorEl.getBoundingClientRect()
  menu.style.top   = `${rect.bottom + 4}px`
  menu.style.right = `${window.innerWidth - rect.right}px`

  document.body.appendChild(menu)

  // Close on outside click
  function close (e) {
    if (!menu.contains(e.target)) {
      menu.remove()
      document.removeEventListener('click', close)
    }
  }
  setTimeout(() => document.addEventListener('click', close), 0)
}

// ── Helpers ───────────────────────────────────────────────

function detailRow (label, value) {
  const row = document.createElement('div')
  row.className = 'jc-detail-row'

  const lbl = document.createElement('span')
  lbl.className   = 'jc-detail-label'
  lbl.textContent = label

  const val = document.createElement('span')
  val.className   = 'jc-detail-value'
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
    background: var(--surface-1);
    border-radius: var(--radius-lg);
    border: 0.5px solid var(--border-subtle);
    overflow: hidden;
    transition: border-color var(--dur-fast) var(--ease-out);
  }

  .job-card--deferred {
    border-color: var(--plasma-border);
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

  .jc-address {
    font-size: var(--text-base);
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .jc-meta {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .jc-time {
    font-size: var(--text-sm);
    color: var(--text-disabled);
  }

  .jc-menu-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 18px;
    cursor: pointer;
    padding: 0 2px;
    letter-spacing: 1px;
    line-height: 1;
    -webkit-tap-highlight-color: transparent;
  }

  .jc-tags {
    display: flex;
    gap: var(--space-2);
    padding: 0 var(--space-4) var(--space-3);
    flex-wrap: wrap;
  }

  .jc-body {
    padding: 0 var(--space-4) var(--space-3);
  }

  .jc-spinner {
    font-size: var(--text-sm);
    color: var(--text-muted);
    padding: var(--space-3) 0;
    text-align: center;
  }

  .jc-detail {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    background: var(--surface-2);
    border-radius: var(--radius-md);
    padding: var(--space-3) var(--space-3);
  }

  .jc-detail-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .jc-detail-group + .jc-detail-group {
    border-top: 0.5px solid var(--border-subtle);
    padding-top: var(--space-2);
    margin-top: var(--space-1);
  }

  .jc-section-label {
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--text-disabled);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: var(--space-1);
  }

  .jc-detail-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-3);
  }

  .jc-detail-label {
    font-size: var(--text-sm);
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .jc-detail-value {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    text-align: right;
  }

  .jc-contact-link {
    color: var(--color-signal);
    text-decoration: none;
    font-size: var(--text-sm);
  }

  .jc-notes-ref {
    font-size: var(--text-sm);
    color: var(--text-muted);
    font-style: italic;
    border-top: 0.5px solid var(--border-subtle);
    padding-top: var(--space-2);
    margin-top: var(--space-1);
  }

  .jc-weigh-ref {
    border-top: 0.5px solid var(--border-subtle);
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
    border-radius: var(--radius-md);
    font-size: var(--text-base);
    font-weight: 500;
    padding: var(--space-3) var(--space-4);
    cursor: pointer;
    transition: opacity var(--dur-fast) var(--ease-out);
    -webkit-tap-highlight-color: transparent;
  }

  .jc-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .jc-btn--primary {
    background: var(--color-signal);
    color: #fff;
  }

  .jc-btn--secondary {
    background: var(--surface-3);
    color: var(--text-secondary);
  }

  /* Context menu */
  .jc-context-menu {
    position: fixed;
    background: var(--surface-2);
    border: 0.5px solid var(--border-default);
    border-radius: var(--radius-md);
    padding: var(--space-2) 0;
    min-width: 160px;
    z-index: 100;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  }

  .jc-context-empty {
    font-size: var(--text-sm);
    color: var(--text-disabled);
    padding: var(--space-3) var(--space-4);
    text-align: center;
  }

  .jc-context-item {
    display: block;
    width: 100%;
    background: none;
    border: none;
    text-align: left;
    font-size: var(--text-base);
    color: var(--text-secondary);
    padding: var(--space-3) var(--space-4);
    cursor: pointer;
  }

  .jc-context-item:active {
    background: var(--surface-3);
  }

  .jc-context-item--destructive {
    color: var(--color-heat);
  }
`
