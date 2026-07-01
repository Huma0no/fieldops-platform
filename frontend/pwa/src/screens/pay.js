/**
 * src/screens/pay.js
 * F7 — Technician's own pay lines (read-only).
 * Accessible from Settings or Reports — own data only, never other technicians.
 */

import { api }                  from '../../../shared/api.js'
import { NavBar, navBarStyles } from '../components/nav-bar.js'

const STYLES_ID = 'styles-pay'

function injectStyles () {
  if (document.getElementById(STYLES_ID)) return
  const style = document.createElement('style')
  style.id = STYLES_ID
  style.textContent = navBarStyles + screenStyles
  document.head.appendChild(style)
}

export default async function mount (appEl) {
  injectStyles()
  appEl.innerHTML = ''

  const screen = document.createElement('div')
  screen.className = 'screen'
  screen.appendChild(buildHeader())

  const body = document.createElement('div')
  body.className = 'scroll-area'
  body.id = 'pay-body'
  screen.appendChild(body)

  screen.appendChild(NavBar({
    active: 'settings',
    onNavigate: route => window.dispatchEvent(new CustomEvent('app:navigate', { detail: { route } })),
  }))

  appEl.appendChild(screen)
  await loadPay(body)
}

async function loadPay (container) {
  container.innerHTML = '<p class="pay-loading">Loading…</p>'
  try {
    const data = await api.get('/pay/mine')
    renderPay(container, data ?? [])
  } catch (err) {
    container.innerHTML = '<p class="pay-loading">Could not load pay data.</p>'
    console.error('pay load failed:', err)
  }
}

function renderPay (container, lines) {
  container.innerHTML = ''

  if (!lines.length) {
    container.innerHTML = `
      <div class="empty-state">
        <p class="empty-title">No pay periods yet</p>
        <p class="empty-sub">Completed visits will appear here once a pay period is closed.</p>
      </div>
    `
    return
  }

  const list = document.createElement('div')
  list.className = 'pay-list'

  lines.forEach(line => {
    const card = document.createElement('div')
    card.className = `pay-card ${line.status === 'paid' ? 'pay-card--paid' : ''}`

    card.innerHTML = `
      <div class="pay-card-top">
        <div>
          <p class="pay-period">${formatRange(line.week_start, line.week_end)}</p>
          <p class="pay-status">${line.status}</p>
        </div>
        <div class="pay-amounts">
          <p class="pay-net">${formatPrice(line.net)}</p>
          <p class="pay-gross">Gross ${formatPrice(line.gross)}</p>
        </div>
      </div>
    `
    list.appendChild(card)
  })

  container.appendChild(list)
}

function buildHeader () {
  const header = document.createElement('div')
  header.className = 'screen-header'
  const left = document.createElement('div')
  left.style.display = 'flex'
  left.style.alignItems = 'center'
  left.style.gap = '12px'
  const back = document.createElement('button')
  back.className = 'pay-back-btn'
  back.textContent = '←'
  back.addEventListener('click', () =>
    window.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: '/settings' } }))
  )
  const title = document.createElement('h1')
  title.className = 'screen-title'
  title.textContent = 'My Pay'
  left.appendChild(back)
  left.appendChild(title)
  header.appendChild(left)
  return header
}

function formatRange (start, end) {
  if (!start || !end) return '—'
  const fmt = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${fmt(start)} – ${fmt(end)}`
}

function formatPrice (val) {
  if (val == null) return '—'
  return `$${Number(val).toFixed(2)}`
}

const screenStyles = `
  .screen { display:flex; flex-direction:column; height:100dvh; background:var(--surface-base); overflow:hidden; }
  .screen-header { display:flex; justify-content:space-between; align-items:center; padding:calc(var(--space-5) + env(safe-area-inset-top,0px)) var(--space-5) var(--space-3); background:var(--surface-1); border-bottom:0.5px solid var(--border-subtle); flex-shrink:0; }
  .screen-title { font-size:var(--text-lg); font-weight:500; color:var(--text-primary); letter-spacing:-0.01em; }
  .scroll-area { flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; }

  .pay-back-btn { background:none; border:none; color:var(--text-muted); font-size:20px; cursor:pointer; padding:var(--space-2); line-height:1; -webkit-tap-highlight-color:transparent; }
  .pay-loading  { font-size:var(--text-base); color:var(--text-muted); padding:var(--space-6) var(--space-5); }

  .pay-list { display:flex; flex-direction:column; gap:var(--space-2); padding:var(--space-3) var(--space-4) var(--space-6); }

  .pay-card { background:var(--surface-1); border-radius:var(--radius-lg); border:0.5px solid var(--border-subtle); padding:var(--space-4); }
  .pay-card--paid { border-color:rgba(34,197,94,0.25); }

  .pay-card-top { display:flex; justify-content:space-between; align-items:flex-start; gap:var(--space-3); }

  .pay-period { font-size:var(--text-base); font-weight:500; color:var(--text-primary); }
  .pay-status { font-size:var(--text-sm); color:var(--text-muted); margin-top:2px; text-transform:capitalize; }

  .pay-amounts { text-align:right; }
  .pay-net     { font-size:var(--text-lg); font-weight:500; color:var(--text-primary); }
  .pay-gross   { font-size:var(--text-sm); color:var(--text-muted); margin-top:2px; }

  .empty-state { display:flex; flex-direction:column; align-items:center; gap:var(--space-3); padding:var(--space-8) var(--space-6); text-align:center; }
  .empty-title { font-size:var(--text-base); font-weight:500; color:var(--text-muted); }
  .empty-sub   { font-size:var(--text-sm); color:var(--text-disabled); }
`
