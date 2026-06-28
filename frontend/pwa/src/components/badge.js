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
  const cfg = CONFIG[status] ?? { label: status, bg: 'var(--surface-3)', color: 'var(--text-muted)' }
  const el  = document.createElement('span')
  el.className   = 'badge'
  el.textContent = cfg.label
  el.style.cssText = `
    display: inline-block;
    font-size: var(--text-xs);
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    background: ${cfg.bg};
    color: ${cfg.color};
    white-space: nowrap;
  `
  return el
}

export function Tag (label, variant = 'default') {
  const variants = {
    default: { bg: 'var(--surface-3)',    color: 'var(--text-muted)',    border: 'var(--border-subtle)' },
    signal:  { bg: 'var(--signal-tint)',  color: 'var(--color-signal)',  border: 'var(--signal-border)' },
    plasma:  { bg: 'var(--plasma-tint)',  color: 'var(--color-plasma)',  border: 'var(--plasma-border)' },
    heat:    { bg: 'var(--heat-tint)',    color: 'var(--color-heat)',    border: 'var(--heat-border)'   },
  }
  const v  = variants[variant] ?? variants.default
  const el = document.createElement('span')
  el.textContent = label
  el.style.cssText = `
    display: inline-block;
    font-size: var(--text-xs);
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    background: ${v.bg};
    color: ${v.color};
    border: 0.5px solid ${v.border};
    white-space: nowrap;
  `
  return el
}
