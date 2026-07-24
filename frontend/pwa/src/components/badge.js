/**
 * src/components/badge.js
 * Status badge — renders a small pill with semantic color per visit status.
 * Used in Job Cards and list rows throughout the PWA.
 *
 * Usage:
 *   import { Badge } from '../components/badge.js'
 *   card.appendChild(Badge('in_progress'))
 */

const CONFIG = {
  assigned: {
    label: 'Assigned',
    bg:    'var(--badge-assigned)',
    color: 'var(--badge-text-assigned)',
  },
  in_progress: {
    label: 'In Progress',
    bg:    'var(--badge-in-progress)',
    color: 'var(--badge-text-in-progress)',
  },
  deferred: {
    label: 'Deferred',
    bg:    'var(--badge-deferred)',
    color: 'var(--badge-text-deferred)',
  },
  temporarily: {
    label: 'Temporarily',
    bg:    'var(--plasma-tint)',
    color: 'var(--color-plasma)',
  },
  completed: {
    label: 'Completed',
    bg:    'var(--badge-completed)',
    color: 'var(--badge-text-completed)',
  },
}

export function Badge (status) {
  const modifier = CONFIG[status] ? status : 'default'
  const cfg = CONFIG[status] ?? { label: status }
  const el  = document.createElement('span')
  el.className   = `badge badge--${modifier}`
  el.textContent = cfg.label
  return el
}

const TAG_VARIANTS = ['default', 'signal', 'plasma', 'heat']

export function Tag (label, variant = 'default') {
  const v  = TAG_VARIANTS.includes(variant) ? variant : 'default'
  const el = document.createElement('span')
  el.className   = `tag tag--${v}`
  el.textContent = label
  return el
}

export const badgeStyles = `
  .badge {
    display: inline-block;
    font-size: var(--text-xs);
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    white-space: nowrap;
  }
  .badge--assigned    { background: var(--badge-assigned);    color: var(--badge-text-assigned); }
  .badge--in_progress { background: var(--badge-in-progress); color: var(--badge-text-in-progress); }
  .badge--deferred    { background: var(--badge-deferred);    color: var(--badge-text-deferred); }
  .badge--temporarily { background: var(--plasma-tint);       color: var(--color-plasma); }
  .badge--completed   { background: var(--badge-completed);   color: var(--badge-text-completed); }
  .badge--default     { background: var(--surface-3);         color: var(--text-muted); }

  .tag {
    display: inline-block;
    font-size: var(--text-xs);
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    white-space: nowrap;
    border: 0.5px solid;
  }
  .tag--default { background: var(--surface-3);   color: var(--text-muted);   border-color: var(--border-subtle); }
  .tag--signal  { background: var(--signal-tint); color: var(--color-signal); border-color: var(--signal-border); }
  .tag--plasma  { background: var(--plasma-tint); color: var(--color-plasma); border-color: var(--plasma-border); }
  .tag--heat    { background: var(--heat-tint);   color: var(--color-heat);   border-color: var(--heat-border); }
`
