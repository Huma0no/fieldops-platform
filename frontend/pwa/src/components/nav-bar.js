/**
 * src/components/nav-bar.js
 * Bottom navigation bar — persistent across all main screens.
 * Per /docs/fieldops/NAVIGATION.md v2.0: Lobby, My Calls, Reports, Chat, Calc, Menu.
 *
 * Usage:
 *   import { NavBar } from '../components/nav-bar.js'
 *   const nav = NavBar({ active: 'my-calls', onNavigate: (route) => navigate(route) })
 *   appEl.appendChild(nav)
 */

import { api } from '../../../shared/api.js'
import { CalcPanel, calcPanelStyles } from './calc-panel.js'
import { MenuSheet, menuSheetStyles } from './menu-sheet.js'
import { computeMenuBadgeCount } from '../lib/menu-badge.mjs'

const STYLES_ID = 'styles-nav-bar-overlays'
function injectOverlayStyles () {
  if (document.getElementById(STYLES_ID)) return
  const style = document.createElement('style')
  style.id = STYLES_ID
  style.textContent = calcPanelStyles + menuSheetStyles
  document.head.appendChild(style)
}

const TABS = [
  {
    id:    'lobby',
    label: 'Lobby',
    route: '/lobby',
    icon:  `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <circle cx="12" cy="12" r="9"/>
              <polyline points="12 8 12 12 14 14"/>
            </svg>`,
  },
  {
    id:    'my-calls',
    label: 'My Calls',
    route: '/',
    icon:  `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <rect x="3" y="4" width="18" height="16" rx="2"/>
              <line x1="3" y1="9" x2="21" y2="9"/>
              <line x1="8" y1="14" x2="13" y2="14"/>
              <line x1="8" y1="17" x2="11" y2="17"/>
            </svg>`,
  },
  {
    id:    'reports',
    label: 'Reports',
    route: '/reports',
    icon:  `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="8" y1="13" x2="16" y2="13"/>
              <line x1="8" y1="17" x2="13" y2="17"/>
            </svg>`,
  },
  {
    id:    'chat',
    label: 'Chat',
    route: '/chat',
    icon:  `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>`,
  },
  {
    id:    'calc',
    label: 'Calc',
    icon:  `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <rect x="4" y="2" width="16" height="20" rx="2"/>
              <line x1="8" y1="7" x2="16" y2="7"/>
              <line x1="8" y1="12" x2="8" y2="12"/>
              <line x1="12" y1="12" x2="12" y2="12"/>
              <line x1="16" y1="12" x2="16" y2="12"/>
              <line x1="8" y1="16" x2="8" y2="16"/>
              <line x1="12" y1="16" x2="12" y2="16"/>
              <line x1="16" y1="16" x2="16" y2="16"/>
            </svg>`,
  },
  {
    id:    'menu',
    label: 'Menu',
    icon:  `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <line x1="4" y1="7" x2="20" y2="7"/>
              <line x1="4" y1="12" x2="20" y2="12"/>
              <line x1="4" y1="17" x2="20" y2="17"/>
            </svg>`,
  },
]

export function NavBar ({ active, onNavigate, unreadChat = 0 }) {
  injectOverlayStyles()

  const nav = document.createElement('nav')
  nav.className = 'nav-bar'

  TABS.forEach(tab => {
    const btn      = document.createElement('button')
    const isActive = tab.id === active
    btn.className  = `nav-tab ${isActive ? 'nav-tab--active' : ''}`
    btn.setAttribute('aria-label', tab.label)

    btn.innerHTML = `
      <span class="nav-icon">${tab.icon}</span>
      <span class="nav-label">${tab.label}</span>
      ${tab.id === 'chat' && unreadChat > 0
        ? `<span class="nav-badge">${unreadChat > 9 ? '9+' : unreadChat}</span>`
        : ''}
    `

    btn.addEventListener('click', () => {
      if (tab.id === 'calc') {
        const overlayEl = CalcPanel({ onClose: () => overlayEl.remove() })
        document.body.appendChild(overlayEl)
        return
      }
      if (tab.id === 'menu') {
        const overlayEl = MenuSheet({ onNavigate, onClose: () => overlayEl.remove() })
        document.body.appendChild(overlayEl)
        return
      }
      if (!isActive) onNavigate(tab.route)
    })

    nav.appendChild(btn)
  })

  loadMenuBadge(nav)

  return nav
}

async function loadMenuBadge (navEl) {
  try {
    const pending = await api.get('/transfers/pending/mine')
    const count = computeMenuBadgeCount([pending?.length ?? 0])
    updateMenuBadge(navEl, count)
  } catch (_) {
    // Offline or fetch failed — no badge shown, next mount retries.
  }
}

function updateMenuBadge (navEl, count) {
  const menuTab = navEl.querySelector('[aria-label="Menu"]')
  if (!menuTab) return
  let badge = menuTab.querySelector('.nav-badge')
  if (count > 0) {
    if (!badge) {
      badge = document.createElement('span')
      badge.className = 'nav-badge'
      menuTab.appendChild(badge)
    }
    badge.textContent = count > 9 ? '9+' : count
  } else {
    badge?.remove()
  }
}

// Update unread badge without re-rendering the whole nav
export function updateChatBadge (navEl, count) {
  const chatTab = navEl.querySelector('[aria-label="Chat"]')
  if (!chatTab) return
  let badge = chatTab.querySelector('.nav-badge')
  if (count > 0) {
    if (!badge) {
      badge = document.createElement('span')
      badge.className = 'nav-badge'
      chatTab.appendChild(badge)
    }
    badge.textContent = count > 9 ? '9+' : count
  } else {
    badge?.remove()
  }
}

export const navBarStyles = `
  .nav-bar {
    display: flex;
    background: var(--fo-panel);
    box-shadow: inset 0 1px 0 var(--fo-panel-hi), 0 -4px 9px var(--fo-panel-lo);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    position: relative;
    z-index: 6;
    flex-shrink: 0;
  }

  .nav-tab {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    height: 56px;
    padding: 10px 4px;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--fo-ink-soft);
    position: relative;
    transition: color 0.12s ease;
    -webkit-tap-highlight-color: transparent;
  }

  .nav-tab + .nav-tab::before {
    content: '';
    position: absolute;
    left: 0;
    top: 16px;
    bottom: 16px;
    width: 1px;
    background: var(--fo-panel-lo);
  }

  .nav-tab--active {
    color: var(--fo-accent-deep);
  }

  .nav-tab--active::after {
    content: '';
    position: absolute;
    top: 6px;
    left: 50%;
    transform: translateX(-50%);
    width: 14px;
    height: 2px;
    border-radius: 2px;
    background: var(--fo-accent-deep);
    box-shadow: var(--fo-shadow-inset);
  }

  .nav-tab:not(.nav-tab--active):active {
    color: var(--fo-accent-deep);
  }

  .nav-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
  }

  .nav-icon svg {
    stroke: currentColor;
  }

  .nav-label {
    font-family: var(--fo-font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.06em;
    white-space: nowrap;
  }

  .nav-badge {
    position: absolute;
    top: 6px;
    right: calc(50% - 18px);
    background: var(--fo-accent);
    color: var(--fo-panel-hi);
    font-family: var(--fo-font-mono);
    font-size: 9px;
    font-weight: 700;
    min-width: 16px;
    height: 16px;
    border-radius: 9px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 4px;
    box-shadow: var(--fo-shadow-subtle);
  }
`
